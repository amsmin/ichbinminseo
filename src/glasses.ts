import type { FaceLandmarkerResult, HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'

type Point = { x: number; y: number }
type GlassesPose = Point & { span: number; angle: number }
type HandName = 'left' | 'right'
type PointingState = { startTip: Point; startedAt: number; seenAt: number; triggered: boolean }
type PinchState = { active: boolean; seenAt: number }

const FACE_GRACE = 520
const HAND_GRACE = 260
const DRAW_INTERVAL = 1000 / 30
const HOP_DURATION = 610
const GRAB_WINDOW = 1600
const PINCH_RELEASE_GRACE = 140
const FOG_BUILD = 540
const FOG_HOLD = 320
const FOG_CLEAR = 620
const SPARKLE_DURATION = 720
const SPARKLE_START = FOG_BUILD + FOG_HOLD + FOG_CLEAR * 0.68
const GLASSES_WIDTH_SCALE = 1.5
const GLASSES_ASPECT_RATIO = 570 / 1500

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function landmarkDistance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}

function pointingUp(landmarks: NormalizedLandmark[]) {
  const wrist = landmarks[0]
  const indexTip = landmarks[8]
  const indexPip = landmarks[6]
  const indexBase = landmarks[5]
  const middleBase = landmarks[9]
  const middleTip = landmarks[12]
  const ringTip = landmarks[16]
  const pinkyTip = landmarks[20]
  if (!wrist || !indexTip || !indexPip || !indexBase || !middleBase || !middleTip || !ringTip || !pinkyTip) return false
  const handScale = Math.max(0.001, landmarkDistance(wrist, middleBase))
  const extended = landmarkDistance(indexTip, wrist) > landmarkDistance(indexPip, wrist) * 1.08
    && landmarkDistance(indexTip, indexBase) > landmarkDistance(indexPip, indexBase) * 1.16
  const upright = indexTip.y < indexPip.y - handScale * 0.06
    && indexPip.y < indexBase.y - handScale * 0.02
  const middleDown = middleTip.y > indexTip.y + handScale * 0.18
  const sideDown = ringTip.y > indexTip.y + handScale * 0.26
    || pinkyTip.y > indexTip.y + handScale * 0.26
  return extended && upright && middleDown && sideDown
}

function pinching(landmarks: NormalizedLandmark[], wasPinching: boolean) {
  const wrist = landmarks[0]
  const middleBase = landmarks[9]
  const thumb = landmarks[4]
  const index = landmarks[8]
  if (!wrist || !middleBase || !thumb || !index) return false
  const handScale = Math.max(0.001, landmarkDistance(wrist, middleBase))
  const pinchDistance = Math.hypot(thumb.x - index.x, thumb.y - index.y) / handScale
  return pinchDistance < (wasPinching ? 0.62 : 0.48)
}

export class GlassesScene {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly video: HTMLVideoElement
  private readonly glassesImage: HTMLImageElement
  private readonly pointingHands = new Map<HandName, PointingState>()
  private readonly pinchHands = new Map<HandName, PinchState>()
  private active = false
  private width = 0
  private height = 0
  private facePose: GlassesPose | null = null
  private landmark6: Point | null = null
  private landmark168: Point | null = null
  private faceSeenAt = 0
  private pose: GlassesPose | null = null
  private mode: 'attached' | 'held' | 'flying' | 'gone' = 'attached'
  private squintStartedAt = 0
  private squintArmedUntil = 0
  private jawOpenStartedAt = 0
  private jawOpenLatched = false
  private fogAt = -Infinity
  private bounceAt = -Infinity
  private lastDrawAt = 0
  private lastRenderAt = 0
  private heldBy: HandName | null = null
  private heldSeenAt = 0
  private grabOffset: Point = { x: 0, y: 0 }
  private grabTarget: Point = { x: 0, y: 0 }
  private handVelocity: Point = { x: 0, y: 0 }
  private flightVelocity: Point = { x: 0, y: 0 }
  private spin = 0
  private flightAt = 0
  private goneAt = 0

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Glasses canvas is unavailable.')
    this.canvas = canvas
    this.context = context
    this.video = video
    this.glassesImage = new Image()
    this.glassesImage.decoding = 'async'
    this.glassesImage.src = '/glasses-silver.png'
  }

  get hasFace() {
    return Boolean(this.facePose && performance.now() - this.faceSeenAt <= FACE_GRACE)
  }

  get canGrab() {
    return this.mode === 'attached' && performance.now() < this.squintArmedUntil
  }

  get isHolding() {
    return this.mode === 'held'
  }

  get isFlying() {
    return this.mode === 'flying'
  }

  get isBouncing() {
    return this.mode === 'attached' && performance.now() - this.bounceAt < HOP_DURATION
  }

  get isFogging() {
    return this.fogAmount(performance.now()) > 0.1
  }

  get isSparkling() {
    return this.sparkleAmount(performance.now()) > 0.1
  }

  activate() {
    this.deactivate()
    this.active = true
  }

  deactivate() {
    this.active = false
    this.facePose = null
    this.landmark6 = null
    this.landmark168 = null
    this.faceSeenAt = 0
    this.pose = null
    this.mode = 'attached'
    this.squintStartedAt = 0
    this.squintArmedUntil = 0
    this.jawOpenStartedAt = 0
    this.jawOpenLatched = false
    this.fogAt = -Infinity
    this.bounceAt = -Infinity
    this.lastDrawAt = 0
    this.lastRenderAt = 0
    this.heldBy = null
    this.heldSeenAt = 0
    this.pointingHands.clear()
    this.pinchHands.clear()
    this.context.clearRect(0, 0, this.width, this.height)
    this.canvas.classList.remove('is-ready')
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.7, 2560 / Math.max(1, rect.width, rect.height)))
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
  }

  private project(point: Point): Point {
    const scale = Math.max(this.width / this.video.videoWidth, this.height / this.video.videoHeight)
    return {
      x: this.width * 0.5 + (0.5 - point.x) * this.video.videoWidth * scale,
      y: this.height * 0.5 + (point.y - 0.5) * this.video.videoHeight * scale,
    }
  }

  private isInsideGrabArea(point: Point) {
    if (!this.pose) return false
    const offsetX = point.x - this.pose.x
    const offsetY = point.y - this.pose.y
    const cosine = Math.cos(this.pose.angle)
    const sine = Math.sin(this.pose.angle)
    const localX = offsetX * cosine + offsetY * sine
    const localY = -offsetX * sine + offsetY * cosine
    const width = this.pose.span * GLASSES_WIDTH_SCALE
    const height = width * GLASSES_ASPECT_RATIO
    return Math.abs(localX) <= width * 0.58 && Math.abs(localY) <= height * 0.82
  }

  onFace(result: FaceLandmarkerResult, now: number) {
    if (!this.active || !this.video.videoWidth) return
    const face = result.faceLandmarks[0]
    if (!face?.[33] || !face[263] || !face[6] || !face[168] || !face[133] || !face[362]) return
    this.resize()
    const eyeA = this.project({ x: (face[33].x + face[133].x) * 0.5, y: (face[33].y + face[133].y) * 0.5 })
    const eyeB = this.project({ x: (face[263].x + face[362].x) * 0.5, y: (face[263].y + face[362].y) * 0.5 })
    const outerA = this.project(face[33])
    const outerB = this.project(face[263])
    const left = eyeA.x < eyeB.x ? eyeA : eyeB
    const right = eyeA.x < eyeB.x ? eyeB : eyeA
    const next: GlassesPose = {
      x: (left.x + right.x) * 0.5,
      y: (left.y + right.y) * 0.5,
      span: Math.max(35, distance(outerA, outerB)),
      angle: Math.atan2(right.y - left.y, right.x - left.x),
    }
    this.facePose = next
    this.landmark6 = this.project(face[6])
    this.landmark168 = this.project(face[168])
    this.faceSeenAt = now
    if (!this.pose && this.mode === 'attached') this.pose = { ...next }

    const categories = result.faceBlendshapes[0]?.categories ?? []
    const leftSquint = categories.find((item) => item.categoryName === 'eyeSquintLeft')?.score ?? 0
    const rightSquint = categories.find((item) => item.categoryName === 'eyeSquintRight')?.score ?? 0
    const squinting = leftSquint >= 0.14 && rightSquint >= 0.14 && (leftSquint + rightSquint) * 0.5 >= 0.22
    if (squinting) {
      if (!this.squintStartedAt) this.squintStartedAt = now
      if (now - this.squintStartedAt >= 120) this.squintArmedUntil = now + GRAB_WINDOW
    } else {
      this.squintStartedAt = 0
    }

    const jawOpen = categories.find((item) => item.categoryName === 'jawOpen')?.score ?? 0
    if (this.mode === 'held' && jawOpen >= 0.35) {
      if (!this.jawOpenLatched) {
        if (!this.jawOpenStartedAt) this.jawOpenStartedAt = now
        if (now - this.jawOpenStartedAt >= 100) {
          this.fogAt = now
          this.jawOpenLatched = true
        }
      }
    } else if (jawOpen < 0.22 || this.mode !== 'held') {
      this.jawOpenStartedAt = 0
      this.jawOpenLatched = false
    }
  }

  onHands(result: HandLandmarkerResult, now: number) {
    if (!this.active || !this.video.videoWidth) return
    this.resize()
    const seen = new Set<HandName>()
    result.landmarks.forEach((landmarks, index) => {
      const rawLabel = result.handedness[index]?.[0]?.categoryName?.toLowerCase()
      const hand: HandName = rawLabel === 'left' ? 'right' : 'left'
      const thumb = landmarks[4]
      const indexTip = landmarks[8]
      if (!thumb || !indexTip) return
      seen.add(hand)
      const tip = this.project(indexTip)
      const pinch = pinching(landmarks, this.pinchHands.get(hand)?.active ?? false)
      this.pinchHands.set(hand, { active: pinch, seenAt: now })
      const midpoint = this.project({ x: (thumb.x + indexTip.x) * 0.5, y: (thumb.y + indexTip.y) * 0.5 })

      if (this.mode === 'attached' && this.landmark6 && this.landmark168 && now - this.faceSeenAt <= FACE_GRACE) {
        if (!pointingUp(landmarks) || pinch) {
          this.pointingHands.delete(hand)
        } else {
          const start = this.landmark6
          const end = this.landmark168
          const axis = { x: end.x - start.x, y: end.y - start.y }
          const axisLength = Math.max(1, Math.hypot(axis.x, axis.y))
          const fromStart = { x: tip.x - start.x, y: tip.y - start.y }
          const progress = (fromStart.x * axis.x + fromStart.y * axis.y) / (axisLength * axisLength)
          const lateral = Math.abs(fromStart.x * axis.y - fromStart.y * axis.x) / axisLength
          const corridor = Math.max(32, (this.facePose?.span ?? 0) * 0.22)
          const nearStart = distance(tip, start) <= corridor && progress <= 0.45
          const previous = this.pointingHands.get(hand)
          if (!previous || now - previous.seenAt > HAND_GRACE || now - previous.startedAt > 1300) {
            if (nearStart) this.pointingHands.set(hand, { startTip: tip, startedAt: now, seenAt: now, triggered: false })
            else this.pointingHands.delete(hand)
          } else {
            previous.seenAt = now
            const travel = { x: tip.x - previous.startTip.x, y: tip.y - previous.startTip.y }
            const upwardTravel = (travel.x * axis.x + travel.y * axis.y) / axisLength
            const reachedEnd = progress >= 0.7 && lateral <= corridor
              && distance(tip, end) <= corridor * 1.15
            if (!previous.triggered && reachedEnd && upwardTravel >= Math.max(12, axisLength * 0.65)
              && now - previous.startedAt >= 55 && now - this.bounceAt > 850) {
              this.bounceAt = now
              previous.triggered = true
            }
          }
        }
      }

      if (this.mode === 'attached' && this.pose && pinch && now < this.squintArmedUntil
        && this.isInsideGrabArea(midpoint)) {
        this.mode = 'held'
        this.heldBy = hand
        this.heldSeenAt = now
        this.grabOffset = { x: this.pose.x - midpoint.x, y: this.pose.y - midpoint.y }
        this.grabTarget = { x: this.pose.x, y: this.pose.y }
        this.handVelocity = { x: 0, y: 0 }
        this.squintArmedUntil = 0
        this.jawOpenStartedAt = 0
        this.jawOpenLatched = false
        this.fogAt = -Infinity
        this.pointingHands.clear()
      } else if (this.mode === 'held' && this.heldBy === hand) {
        if (!pinch) {
          if (now - this.heldSeenAt > PINCH_RELEASE_GRACE) this.release(now)
        } else {
          const target = { x: midpoint.x + this.grabOffset.x, y: midpoint.y + this.grabOffset.y }
          const elapsed = clamp((now - this.heldSeenAt) / 1000, 0.016, 0.2)
          const vx = (target.x - this.grabTarget.x) / elapsed
          const vy = (target.y - this.grabTarget.y) / elapsed
          this.handVelocity.x = this.handVelocity.x * 0.35 + vx * 0.65
          this.handVelocity.y = this.handVelocity.y * 0.35 + vy * 0.65
          this.grabTarget = target
          this.heldSeenAt = now
        }
      }
    })
    this.pointingHands.forEach((state, hand) => {
      if (!seen.has(hand) && now - state.seenAt > HAND_GRACE) this.pointingHands.delete(hand)
    })
    this.pinchHands.forEach((state, hand) => {
      if (!seen.has(hand) && now - state.seenAt > HAND_GRACE) this.pinchHands.delete(hand)
    })
  }

  private release(now: number) {
    if (this.mode !== 'held' || !this.pose) return
    this.mode = 'flying'
    this.heldBy = null
    this.jawOpenStartedAt = 0
    this.jawOpenLatched = false
    this.flightAt = now
    const speed = Math.hypot(this.handVelocity.x, this.handVelocity.y)
    const direction = this.pose.x >= (this.facePose?.x ?? this.width * 0.5) ? 1 : -1
    const minimumSpeed = Math.max(1450, this.width * 1.35)
    if (speed >= 220) {
      const vx = this.handVelocity.x * 2.55
      const vy = this.handVelocity.y * 2.35 - Math.max(160, this.height * 0.12)
      const boost = Math.max(1, minimumSpeed / Math.max(1, Math.hypot(vx, vy)))
      this.flightVelocity = { x: clamp(vx * boost, -4200, 4200), y: clamp(vy * boost, -4200, 4200) }
    } else {
      this.flightVelocity = { x: direction * minimumSpeed, y: -Math.max(320, this.height * 0.4) }
    }
    this.spin = clamp(this.flightVelocity.x * 0.0038, -8, 8)
  }

  private fogAmount(now: number) {
    const elapsed = now - this.fogAt
    if (elapsed < 0 || elapsed >= FOG_BUILD + FOG_HOLD + FOG_CLEAR) return 0
    if (elapsed < FOG_BUILD) return 0.86 * Math.sin((elapsed / FOG_BUILD) * Math.PI * 0.5)
    if (elapsed < FOG_BUILD + FOG_HOLD) return 0.86
    const clear = (elapsed - FOG_BUILD - FOG_HOLD) / FOG_CLEAR
    return 0.86 * (1 - clear * clear * (3 - 2 * clear))
  }

  private sparkleAmount(now: number) {
    const progress = (now - this.fogAt - SPARKLE_START) / SPARKLE_DURATION
    return progress >= 0 && progress < 1 ? Math.sin(progress * Math.PI) : 0
  }

  private drawFog(context: CanvasRenderingContext2D, width: number, opacity: number) {
    const radius = width * 0.169
    for (const side of [-1, 1]) {
      const centerX = side * width * 0.263
      context.save()
      context.beginPath()
      context.arc(centerX, 0, radius, 0, Math.PI * 2)
      context.clip()
      const mist = context.createRadialGradient(centerX - radius * 0.28, -radius * 0.28, radius * 0.04,
        centerX, 0, radius * 1.12)
      mist.addColorStop(0, `rgba(248,252,255,${opacity * 0.94})`)
      mist.addColorStop(0.7, `rgba(226,239,244,${opacity * 0.8})`)
      mist.addColorStop(1, `rgba(218,233,240,${opacity * 0.32})`)
      context.fillStyle = mist
      context.fillRect(centerX - radius, -radius, radius * 2, radius * 2)
      context.fillStyle = `rgba(255,255,255,${opacity * 0.37})`
      for (let i = 0; i < 10; i += 1) {
        const angle = i * 2.39996 + side * 0.4
        const offset = radius * (0.18 + (i % 4) * 0.17)
        context.beginPath()
        context.arc(centerX + Math.cos(angle) * offset, Math.sin(angle) * offset,
          radius * (0.016 + (i % 3) * 0.008), 0, Math.PI * 2)
        context.fill()
      }
      context.restore()
    }
  }

  private drawSparkles(context: CanvasRenderingContext2D, width: number, strength: number, now: number) {
    const progress = (now - this.fogAt - SPARKLE_START) / SPARKLE_DURATION
    const glints = [
      { x: -0.305, y: -0.11, delay: 0 },
      { x: 0.285, y: -0.075, delay: 0.18 },
      { x: -0.19, y: 0.065, delay: 0.36 },
    ]
    context.save()
    context.lineCap = 'round'
    context.strokeStyle = `rgba(255,255,255,${strength * 0.94})`
    context.lineWidth = Math.max(1, width * 0.006)
    context.shadowColor = 'rgba(236,252,255,.95)'
    context.shadowBlur = width * 0.045
    for (const glint of glints) {
      const pulse = Math.max(0, 1 - Math.abs(progress - glint.delay - 0.23) / 0.27)
      if (pulse <= 0) continue
      const size = width * 0.047 * pulse
      const x = width * glint.x
      const y = width * glint.y
      context.beginPath()
      context.moveTo(x - size, y)
      context.lineTo(x + size, y)
      context.moveTo(x, y - size)
      context.lineTo(x, y + size)
      context.moveTo(x - size * 0.43, y - size * 0.43)
      context.lineTo(x + size * 0.43, y + size * 0.43)
      context.stroke()
    }
    context.restore()
  }

  private drawFrame(pose: GlassesPose, now: number) {
    const context = this.context
    const hopTime = (now - this.bounceAt) / HOP_DURATION
    const hop = this.mode === 'attached' && hopTime >= 0 && hopTime < 1
      ? -Math.sin(Math.PI * hopTime) * Math.min(this.width / window.innerWidth * 23, pose.span * 0.18)
      : 0
    context.save()
    context.translate(pose.x, pose.y + hop)
    context.rotate(pose.angle)
    const width = pose.span * GLASSES_WIDTH_SCALE
    const height = width * GLASSES_ASPECT_RATIO
    const fog = this.fogAmount(now)
    if (fog > 0) this.drawFog(context, width, fog)
    context.shadowColor = this.canGrab ? 'rgba(255,220,148,.55)' : 'rgba(8,26,32,.25)'
    context.shadowBlur = this.canGrab ? 14 : 4
    context.drawImage(this.glassesImage, 80, 200, 1500, 570,
      -width * 0.5, -height * 0.5, width, height)
    const sparkle = this.sparkleAmount(now)
    if (sparkle > 0) this.drawSparkles(context, width, sparkle, now)
    context.restore()
  }

  render(now: number, force = false) {
    if (!this.active) return
    this.resize()
    const delta = clamp((now - (this.lastRenderAt || now)) / 1000, 0, 0.05)
    this.lastRenderAt = now
    if (this.mode === 'held' && now - this.heldSeenAt > HAND_GRACE) this.release(now)
    if (this.mode === 'attached' && this.facePose && this.pose) {
      this.pose.x += (this.facePose.x - this.pose.x) * 0.52
      this.pose.y += (this.facePose.y - this.pose.y) * 0.52
      this.pose.span += (this.facePose.span - this.pose.span) * 0.4
      const angleDelta = Math.atan2(Math.sin(this.facePose.angle - this.pose.angle), Math.cos(this.facePose.angle - this.pose.angle))
      this.pose.angle += angleDelta * 0.45
    } else if (this.mode === 'held' && this.pose) {
      this.pose.x += (this.grabTarget.x - this.pose.x) * 0.65
      this.pose.y += (this.grabTarget.y - this.pose.y) * 0.65
    } else if (this.mode === 'flying' && this.pose) {
      this.pose.x += this.flightVelocity.x * delta
      this.pose.y += this.flightVelocity.y * delta
      this.flightVelocity.y += this.height * 0.7 * delta
      this.pose.angle += this.spin * delta
      const margin = this.pose.span * 0.85
      if (this.pose.x < -margin || this.pose.x > this.width + margin
        || this.pose.y < -margin || this.pose.y > this.height + margin || now - this.flightAt > 4000) {
        this.mode = 'gone'
        this.goneAt = now
      }
    } else if (this.mode === 'gone' && this.facePose && now - this.faceSeenAt <= FACE_GRACE && now - this.goneAt > 1050) {
      this.mode = 'attached'
      this.pose = { ...this.facePose }
      this.pointingHands.clear()
    }
    if (!force && now - this.lastDrawAt < DRAW_INTERVAL) return
    this.lastDrawAt = now
    this.context.clearRect(0, 0, this.width, this.height)
    const visible = Boolean(this.glassesImage.naturalWidth && this.pose && this.mode !== 'gone'
      && (this.mode !== 'attached' || now - this.faceSeenAt <= FACE_GRACE))
    if (visible && this.pose) {
      if (this.mode === 'flying') {
        for (let step = 2; step >= 1; step -= 1) {
          this.context.save()
          this.context.globalAlpha = step === 2 ? 0.08 : 0.16
          this.drawFrame({ ...this.pose,
            x: this.pose.x - this.flightVelocity.x * 0.026 * step,
            y: this.pose.y - this.flightVelocity.y * 0.026 * step,
            angle: this.pose.angle - this.spin * 0.026 * step,
          }, now)
          this.context.restore()
        }
      }
      this.drawFrame(this.pose, now)
    }
    this.canvas.classList.toggle('is-ready', visible)
  }

  drawCapture(context: CanvasRenderingContext2D, width: number, height: number) {
    if (this.canvas.classList.contains('is-ready')) context.drawImage(this.canvas, 0, 0, width, height)
  }
}
