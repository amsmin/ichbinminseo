import { FilesetResolver, ImageSegmenter, type NormalizedLandmark } from '@mediapipe/tasks-vision'

type Point = { x: number; y: number }
type WorkerHand = Point & { hand: 'left' | 'right'; pose: 'pinch' | 'open' }
type HandState = Point & {
  pose: WorkerHand['pose']
  armed: boolean
  seenAt: number
}
type FaceBubble = { indices: [number, number, number]; weights: [number, number, number]; size: number; phase: number; sprite: number }
type BaseBubble = { u: number; v: number; size: number; phase: number; nx: number; ny: number; tx: number; ty: number }
type MaskState = { values: Float32Array; width: number; height: number; seenAt: number }
type RainDrop = { x: number; y: number; speed: number; drift: number; size: number }

const HAND_INTERVAL = 1000 / 22
const DRAW_INTERVAL = 1000 / 30
const SEGMENT_IDLE_INTERVAL = 190
const SEGMENT_GESTURE_INTERVAL = 420
const HAND_GRACE = 300
const FACE_GRACE = 500
const MASK_GRACE = 720
const WASH_DURATION = 1450
const MIN_RAIN_DURATION = 2700
const MAX_RAIN_DROPS = 140

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function hash(seed: number) {
  const value = Math.sin(seed * 127.1) * 43758.5453
  return value - Math.floor(value)
}

function sprite(diameter: number, tint: string) {
  const canvas = document.createElement('canvas')
  canvas.width = diameter
  canvas.height = diameter
  const context = canvas.getContext('2d')!
  const center = diameter * 0.5
  const radius = diameter * 0.44
  const fill = context.createRadialGradient(center * 0.73, center * 0.7, diameter * 0.03, center, center, radius)
  fill.addColorStop(0, 'rgba(255,255,255,.98)')
  fill.addColorStop(0.48, tint)
  fill.addColorStop(0.83, 'rgba(210,241,247,.84)')
  fill.addColorStop(1, 'rgba(194,231,243,0)')
  context.fillStyle = fill
  context.beginPath()
  context.arc(center, center, radius, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = 'rgba(255,255,255,.78)'
  context.lineWidth = Math.max(1, diameter * 0.025)
  context.beginPath()
  context.arc(center, center, radius * 0.79, -2.65, -0.65)
  context.stroke()
  return canvas
}

function waterDropSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = 24
  canvas.height = 38
  const context = canvas.getContext('2d')!
  const fill = context.createLinearGradient(5, 0, 18, 38)
  fill.addColorStop(0, 'rgba(238,254,255,.72)')
  fill.addColorStop(0.5, 'rgba(147,224,245,.78)')
  fill.addColorStop(1, 'rgba(231,251,255,.92)')
  context.fillStyle = fill
  context.beginPath()
  context.moveTo(12, 1)
  context.bezierCurveTo(10, 9, 2, 19, 2, 26)
  context.bezierCurveTo(2, 34, 7, 37, 12, 37)
  context.bezierCurveTo(18, 37, 22, 33, 22, 26)
  context.bezierCurveTo(22, 19, 14, 9, 12, 1)
  context.fill()
  context.strokeStyle = 'rgba(255,255,255,.85)'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(7, 24)
  context.quadraticCurveTo(6, 30, 9, 32)
  context.stroke()
  return canvas
}

export class ShampooScene {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly video: HTMLVideoElement
  private readonly segmentInput = document.createElement('canvas')
  private readonly segmentContext: CanvasRenderingContext2D
  private readonly handInput = document.createElement('canvas')
  private readonly handContext: CanvasRenderingContext2D
  private readonly maskCanvas = document.createElement('canvas')
  private readonly maskContext: CanvasRenderingContext2D
  private readonly sprites = [sprite(48, 'rgba(235,250,255,.95)'), sprite(64, 'rgba(221,245,251,.86)'), sprite(80, 'rgba(245,253,255,.92)')]
  private readonly dropSprite = waterDropSprite()
  private readonly hands = new Map<'left' | 'right', HandState>()
  private readonly smallBubbles: FaceBubble[] = []
  private readonly rainDrops: RainDrop[] = []
  private baseBubbles: BaseBubble[] = []
  private face: NormalizedLandmark[] | null = null
  private faceSeenAt = 0
  private mask: MaskState | null = null
  private segmenter: ImageSegmenter | null = null
  private worker: Worker | null = null
  private workerReady = false
  private workerBusy = false
  private loadingError: string | null = null
  private active = false
  private generation = 0
  private width = 0
  private height = 0
  private lastHandAt = 0
  private lastSegmentAt = 0
  private lastDrawAt = 0
  private lastRainAt = 0
  private rainUntil = 0
  private washStartedAt = 0
  private foamWashed = false
  private leverHeld = false

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    const context = canvas.getContext('2d')
    const segmentContext = this.segmentInput.getContext('2d', { alpha: false })
    const handContext = this.handInput.getContext('2d', { alpha: false })
    const maskContext = this.maskCanvas.getContext('2d')
    if (!context || !segmentContext || !handContext || !maskContext) throw new Error('Shampoo canvas is unavailable.')
    this.canvas = canvas
    this.context = context
    this.video = video
    this.segmentContext = segmentContext
    this.handContext = handContext
    this.maskContext = maskContext
  }

  get hasValidMask() {
    return Boolean(this.mask && performance.now() - this.mask.seenAt <= MASK_GRACE)
  }

  get isHandReady() {
    return this.workerReady
  }

  get error() {
    return this.loadingError
  }

  get isGesturing() {
    return Array.from(this.hands.values()).some((hand) => hand.armed && hand.pose === 'pinch')
  }

  get isRinsing() {
    return performance.now() < this.rainUntil
  }

  get isWashed() {
    return this.foamWashed
  }

  rinse(now = performance.now()) {
    if (!this.active) return
    if (this.baseBubbles.length > 0 || this.smallBubbles.length > 0) {
      this.foamWashed = true
      this.washStartedAt = now
    }
    this.rainUntil = Math.max(this.rainUntil, now + MIN_RAIN_DURATION)
    this.lastRainAt = now
    this.hands.clear()
    this.canvas.classList.add('is-ready')
  }

  setLeverHeld(held: boolean) {
    this.leverHeld = held && this.active
  }

  activate() {
    this.deactivate()
    this.active = true
    const generation = ++this.generation
    try {
      const worker = new Worker(new URL('./shampoo-hand.worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      worker.onmessage = (event: MessageEvent<{ type: string; hands?: WorkerHand[]; timestamp?: number; message?: string }>) => {
        if (!this.active || generation !== this.generation) return
        if (event.data.type === 'ready') this.workerReady = true
        if (event.data.type === 'hands') {
          this.workerBusy = false
          this.onHands(event.data.hands ?? [], event.data.timestamp ?? performance.now())
        }
        if (event.data.type === 'error') {
          this.workerBusy = false
          if (!this.workerReady) this.loadingError = '손 인식 모델을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'
          console.warn('Shampoo hand worker:', event.data.message)
        }
      }
      worker.onerror = (error) => {
        this.workerBusy = false
        this.workerReady = false
        this.loadingError = '손 인식 Worker를 시작하지 못했습니다. 페이지를 새로고침해 주세요.'
        console.warn('Shampoo hand worker failed.', error)
      }
    } catch (error) {
      this.loadingError = '손 인식 Worker를 시작하지 못했습니다. 페이지를 새로고침해 주세요.'
      console.warn('Shampoo hand worker could not start.', error)
    }
    void this.loadSegmenter(generation)
  }

  deactivate() {
    this.active = false
    this.generation += 1
    this.worker?.postMessage({ type: 'dispose' })
    this.worker?.terminate()
    this.worker = null
    this.workerReady = false
    this.workerBusy = false
    this.loadingError = null
    this.segmenter?.close()
    this.segmenter = null
    this.face = null
    this.mask = null
    this.hands.clear()
    this.smallBubbles.length = 0
    this.rainDrops.length = 0
    this.baseBubbles = []
    this.lastHandAt = 0
    this.lastSegmentAt = 0
    this.lastDrawAt = 0
    this.lastRainAt = 0
    this.rainUntil = 0
    this.washStartedAt = 0
    this.foamWashed = false
    this.leverHeld = false
    this.context.clearRect(0, 0, this.width, this.height)
    this.canvas.classList.remove('is-ready')
  }

  setFace(landmarks: NormalizedLandmark[] | null, now: number) {
    if (!this.active || !landmarks?.[10] || !landmarks[152]) return
    this.face = landmarks
    this.faceSeenAt = now
  }

  private async loadSegmenter(generation: number) {
    try {
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm')
      if (!this.active || generation !== this.generation) return
      const created = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate: 'CPU' },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
      if (!this.active || generation !== this.generation) {
        created.close()
        return
      }
      this.segmenter = created
    } catch (error) {
      if (this.active && generation === this.generation) {
        this.loadingError = 'HumanSeg 모델을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'
        console.error('HumanSeg selfie model could not load.', error)
      }
    }
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5, 2560 / Math.max(1, rect.width, rect.height)))
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
  }

  private project(u: number, v: number, width = this.width, height = this.height): Point {
    const scale = Math.max(width / this.video.videoWidth, height / this.video.videoHeight)
    return {
      x: width * 0.5 + (0.5 - u) * this.video.videoWidth * scale,
      y: height * 0.5 + (v - 0.5) * this.video.videoHeight * scale,
    }
  }

  private faceFresh(now: number) {
    return Boolean(this.face && now - this.faceSeenAt <= FACE_GRACE)
  }

  private foreheadY(u: number, face: NormalizedLandmark[]) {
    const center = face[10]
    const left = face[67]
    const right = face[297]
    const slope = left && right ? (right.y - left.y) / (right.x - left.x || 0.001) : 0
    const faceHeight = Math.abs(face[152].y - center.y)
    return center.y + slope * (u - center.x) + faceHeight * 0.035
  }

  private sample(mask: MaskState, u: number, v: number) {
    const x = clamp(Math.round(u * (mask.width - 1)), 0, mask.width - 1)
    const y = clamp(Math.round(v * (mask.height - 1)), 0, mask.height - 1)
    return mask.values[y * mask.width + x]
  }

  private headWindow(u: number, face: NormalizedLandmark[]) {
    const left = face[234]
    const right = face[454]
    if (!left || !right) return false
    const center = (left.x + right.x) * 0.5
    return Math.abs(u - center) <= Math.abs(right.x - left.x) * 1.25
  }

  private scalpPoint(u: number, v: number, now: number) {
    if (!this.faceFresh(now) || !this.face || !this.mask || now - this.mask.seenAt > MASK_GRACE) return false
    return this.headWindow(u, this.face) && v <= this.foreheadY(u, this.face) + 0.025
      && this.sample(this.mask, u, v) >= 0.52
  }

  private facePoint(u: number, v: number, now: number) {
    if (!this.faceFresh(now) || !this.face) return false
    const left = this.face[234]
    const right = this.face[454]
    const top = this.face[10]
    const chin = this.face[152]
    const cx = (left.x + right.x) * 0.5
    const cy = (top.y + chin.y) * 0.5
    const rx = Math.max(0.001, Math.abs(right.x - left.x) * 0.58)
    const ry = Math.max(0.001, Math.abs(chin.y - top.y) * 0.55)
    return ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1
  }

  private canStart(u: number, v: number, now: number) {
    return this.hasValidMask && (this.facePoint(u, v, now) || this.scalpPoint(u, v, now))
  }

  private processMask(values: Float32Array, width: number, height: number, now: number) {
    const face = this.face
    if (!face || !this.faceFresh(now) || values.length !== width * height) return
    const candidate: MaskState = { values, width, height, seenAt: now }
    if (!Number.isFinite(this.sample(candidate, face[1].x, face[1].y)) || this.sample(candidate, face[1].x, face[1].y) < 0.4) return
    const faceWidthInPixels = Math.abs(face[234].x - face[454].x) * width
    const minX = clamp(Math.floor(Math.min(face[234].x, face[454].x) * width - faceWidthInPixels * 0.75), 0, width - 1)
    const maxX = clamp(Math.ceil(Math.max(face[234].x, face[454].x) * width + faceWidthInPixels * 0.75), 0, width - 1)
    const maxY = clamp(Math.ceil((this.foreheadY(face[10].x, face) + 0.04) * height), 0, height - 1)
    if (this.foamWashed) {
      let validPixels = 0
      for (let y = 2; y < maxY; y += 3) {
        for (let x = minX; x <= maxX; x += 3) {
          const u = x / width
          if (this.headWindow(u, face) && y / height <= this.foreheadY(u, face) && values[y * width + x] > 0.55) validPixels += 1
        }
      }
      if (validPixels >= 3) this.mask = candidate
      return
    }
    const edges: { x: number; y: number; nx: number; ny: number }[] = []
    const image = this.maskContext.createImageData(width, height)
    let validPixels = 0
    for (let y = 1; y < maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const u = x / width
        const v = y / height
        if (!this.headWindow(u, face)) continue
        const cutoff = this.foreheadY(u, face)
        if (v > cutoff + 0.012) continue
        const index = y * width + x
        const confidence = values[index]
        const coverage = clamp((confidence - 0.38) / 0.3, 0, 1)
        const lineFade = clamp((cutoff + 0.012 - v) * height / 6, 0, 1)
        const alpha = Math.round(coverage * lineFade * 172)
        if (alpha <= 0) continue
        validPixels += confidence > 0.55 ? 1 : 0
        const pixel = index * 4
        image.data[pixel] = 234
        image.data[pixel + 1] = 248
        image.data[pixel + 2] = 253
        image.data[pixel + 3] = alpha
        if (confidence > 0.55 && x > 0 && x < width - 1 && y < height - 1 && (x + y) % 2 === 0) {
          const gx = values[index + 1] - values[index - 1]
          const gy = values[index + width] - values[index - width]
          if (Math.abs(gx) + Math.abs(gy) > 0.12) {
            const length = Math.max(0.001, Math.hypot(gx, gy))
            edges.push({ x, y, nx: -gx / length, ny: -gy / length })
          }
        }
      }
    }
    if (validPixels < 24) return
    this.mask = candidate
    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width
      this.maskCanvas.height = height
    }
    this.maskContext.putImageData(image, 0, 0)
    const faceWidth = Math.abs(face[454].x - face[234].x) * width
    const spacing = clamp(faceWidth / 16, 4.5, 8)
    const bubbles: BaseBubble[] = []
    for (let y = 2; y < maxY; y += spacing) {
      for (let x = minX; x <= maxX; x += spacing) {
        const seed = Math.round(x * 41 + y * 97)
        const px = x + (hash(seed) - 0.5) * spacing * 0.48
        const py = y + (hash(seed + 1) - 0.5) * spacing * 0.48
        const u = px / width
        const v = py / height
        if (!this.headWindow(u, face) || v > this.foreheadY(u, face) - 0.002 || this.sample(candidate, u, v) < 0.52) continue
        let closest = Infinity
        let nx = 0
        let ny = -1
        for (const edge of edges) {
          const distance = (edge.x - px) ** 2 + (edge.y - py) ** 2
          if (distance < closest) {
            closest = distance
            nx = edge.nx
            ny = edge.ny
          }
        }
        const edgeBubble = closest < spacing * spacing * 1.7 && hash(seed + 2) > 0.47
        const overshoot = edgeBubble ? spacing * (0.25 + hash(seed + 3) * 0.52) : 0
        bubbles.push({
          u: (px + nx * overshoot) / width,
          v: (py + ny * overshoot) / height,
          size: 8 + hash(seed + 4) * 10,
          phase: hash(seed + 5) * Math.PI * 2,
          nx, ny, tx: -ny, ty: nx,
        })
      }
    }
    this.baseBubbles = bubbles
    this.canvas.classList.add('is-ready')
  }

  private segment(now: number) {
    if (!this.segmenter || !this.faceFresh(now) || !this.video.videoWidth) return
    const interval = this.isGesturing || this.isRinsing || this.foamWashed ? SEGMENT_GESTURE_INTERVAL : SEGMENT_IDLE_INTERVAL
    if (now - this.lastSegmentAt < interval) return
    this.lastSegmentAt = now
    const width = 320
    const height = Math.max(1, Math.round(width * this.video.videoHeight / this.video.videoWidth))
    if (this.segmentInput.width !== width || this.segmentInput.height !== height) {
      this.segmentInput.width = width
      this.segmentInput.height = height
    }
    this.segmentContext.drawImage(this.video, 0, 0, width, height)
    try {
      this.segmenter.segmentForVideo(this.segmentInput, now, (result) => {
        const mask = result.confidenceMasks?.[0]
        if (!mask) return
        const values = new Float32Array(mask.getAsFloat32Array())
        this.processMask(values, mask.width, mask.height, now)
      })
    } catch (error) {
      console.warn('Shampoo segmentation frame skipped.', error)
    }
  }

  private sendHandFrame(now: number) {
    if (!this.worker || !this.workerReady || this.workerBusy || !this.video.videoWidth || now - this.lastHandAt < HAND_INTERVAL) return
    this.workerBusy = true
    this.lastHandAt = now
    const generation = this.generation
    const width = 512
    const height = Math.max(1, Math.round(width * this.video.videoHeight / this.video.videoWidth))
    if (this.handInput.width !== width || this.handInput.height !== height) {
      this.handInput.width = width
      this.handInput.height = height
    }
    this.handContext.drawImage(this.video, 0, 0, width, height)
    void createImageBitmap(this.handInput).then((bitmap) => {
      if (!this.active || generation !== this.generation || !this.worker) {
        bitmap.close()
        return
      }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap])
    }).catch((error) => {
      this.workerBusy = false
      console.warn('Shampoo hand frame could not be sent.', error)
    })
  }

  private anchor(u: number, v: number): FaceBubble | null {
    const face = this.face
    if (!face) return null
    const nearest: { index: number; distance: number }[] = []
    for (let index = 0; index < Math.min(468, face.length); index += 1) {
      const point = face[index]
      const distance = (point.x - u) ** 2 + (point.y - v) ** 2
      if (nearest.length < 10 || distance < nearest[nearest.length - 1].distance) {
        nearest.push({ index, distance })
        nearest.sort((a, b) => a.distance - b.distance)
        if (nearest.length > 10) nearest.pop()
      }
    }
    let best: FaceBubble | null = null
    let bestScore = Infinity
    for (let a = 0; a < nearest.length - 2; a += 1) {
      for (let b = a + 1; b < nearest.length - 1; b += 1) {
        for (let c = b + 1; c < nearest.length; c += 1) {
          const ia = nearest[a].index
          const ib = nearest[b].index
          const ic = nearest[c].index
          const p = face[ia], q = face[ib], r = face[ic]
          const determinant = (q.y - r.y) * (p.x - r.x) + (r.x - q.x) * (p.y - r.y)
          if (Math.abs(determinant) < 0.000002) continue
          const wa = ((q.y - r.y) * (u - r.x) + (r.x - q.x) * (v - r.y)) / determinant
          const wb = ((r.y - p.y) * (u - r.x) + (p.x - r.x) * (v - r.y)) / determinant
          const wc = 1 - wa - wb
          const outside = Math.max(0, -wa) + Math.max(0, -wb) + Math.max(0, -wc)
          const score = outside * 3 + nearest[a].distance + nearest[b].distance + nearest[c].distance
          if (score < bestScore) {
            bestScore = score
            best = { indices: [ia, ib, ic], weights: [wa, wb, wc], size: 0, phase: 0, sprite: 0 }
          }
        }
      }
    }
    return best
  }

  private addSmall(u: number, v: number, now: number) {
    if (!this.faceFresh(now)) return
    const bubble = this.anchor(u, v)
    if (!bubble) return
    const seed = this.smallBubbles.length + 11
    bubble.size = 3.5 + hash(seed) * 4.5
    bubble.phase = hash(seed + 1) * Math.PI * 2
    bubble.sprite = seed % this.sprites.length
    this.smallBubbles.push(bubble)
  }

  private onHands(hands: WorkerHand[], now: number) {
    if (now < this.rainUntil) return
    for (const hand of hands) {
      const previous = this.hands.get(hand.hand)
      const current = this.project(hand.x, hand.y, window.innerWidth, window.innerHeight)
      if (hand.pose !== 'pinch') {
        this.hands.set(hand.hand, { ...current, pose: 'open', armed: false, seenAt: now })
        continue
      }
      const continuing = Boolean(previous?.armed && previous.pose === 'pinch' && now - previous.seenAt <= HAND_GRACE)
      const armed = continuing || this.canStart(hand.x, hand.y, now)
      if (armed) {
        const start = continuing ? previous! : null
        const distance = start ? Math.hypot(current.x - start.x, current.y - start.y) : 0
        const steps = Math.max(1, Math.ceil(distance / 5))
        for (let step = 1; step <= steps; step += 1) {
          const fraction = step / steps
          const point = start
            ? this.unproject(start.x + (current.x - start.x) * fraction, start.y + (current.y - start.y) * fraction)
            : hand
          this.addSmall(point.x, point.y, now)
        }
      }
      this.hands.set(hand.hand, { ...current, pose: hand.pose, armed, seenAt: now })
    }
    const seen = new Set(hands.map((hand) => hand.hand))
    this.hands.forEach((hand, key) => {
      if (!seen.has(key) && now - hand.seenAt > HAND_GRACE) this.hands.delete(key)
    })
  }

  private unproject(x: number, y: number): Point {
    const width = window.innerWidth
    const height = window.innerHeight
    const scale = Math.max(width / this.video.videoWidth, height / this.video.videoHeight)
    return {
      x: 0.5 - (x - width * 0.5) / (this.video.videoWidth * scale),
      y: 0.5 + (y - height * 0.5) / (this.video.videoHeight * scale),
    }
  }

  private drawRain(now: number) {
    const raining = now < this.rainUntil
    const delta = clamp((now - this.lastRainAt) / 1000, 0, 0.06)
    this.lastRainAt = now
    const cssScale = this.width / Math.max(1, window.innerWidth)
    if (raining) {
      const count = Math.min(8, Math.max(2, Math.round(this.width / 360)))
      for (let index = 0; index < count && this.rainDrops.length < MAX_RAIN_DROPS; index += 1) {
        const seed = Math.round(now) + index * 79
        this.rainDrops.push({
          x: hash(seed) * this.width,
          y: -(12 + hash(seed + 1) * 52) * cssScale,
          speed: this.height * (0.72 + hash(seed + 2) * 0.7),
          drift: (hash(seed + 3) - 0.5) * 36 * cssScale,
          size: (4 + hash(seed + 4) * 5) * cssScale,
        })
      }
    }
    for (let index = this.rainDrops.length - 1; index >= 0; index -= 1) {
      const drop = this.rainDrops[index]
      drop.x += drop.drift * delta
      drop.y += drop.speed * delta
      if (drop.y > this.height + 40 * cssScale) {
        this.rainDrops.splice(index, 1)
        continue
      }
      this.context.drawImage(this.dropSprite, drop.x - drop.size, drop.y - drop.size * 1.6, drop.size * 2, drop.size * 3.2)
    }
  }

  private draw(now: number) {
    this.resize()
    const context = this.context
    context.clearRect(0, 0, this.width, this.height)
    const washing = this.washStartedAt > 0 && now - this.washStartedAt < WASH_DURATION
    const showBase = !this.foamWashed || washing
    const showFoam = Boolean(this.mask && now - this.mask.seenAt <= MASK_GRACE && this.faceFresh(now) && this.face && (showBase || this.smallBubbles.length > 0))
    if (showFoam && this.face) {
      const cssScale = this.width / Math.max(1, window.innerWidth)
      const scale = Math.max(this.width / this.video.videoWidth, this.height / this.video.videoHeight)
      const drawWidth = this.video.videoWidth * scale
      const drawHeight = this.video.videoHeight * scale
      context.save()
      if (washing) {
        const wipeY = clamp((now - this.washStartedAt) / WASH_DURATION, 0, 1) * this.height
        context.beginPath()
        context.rect(0, wipeY, this.width, this.height - wipeY)
        context.clip()
      }
      if (showBase) {
        context.save()
        context.translate(this.width, 0)
        context.scale(-1, 1)
        context.drawImage(this.maskCanvas, (this.width - drawWidth) * 0.5, (this.height - drawHeight) * 0.5, drawWidth, drawHeight)
        context.restore()

        for (let index = 0; index < this.baseBubbles.length; index += 1) {
          const bubble = this.baseBubbles[index]
          const point = this.project(bubble.u, bubble.v)
          const tangent = Math.sin(now * 0.0015 + bubble.phase) * 1.15 * cssScale
          const normal = Math.cos(now * 0.0011 + bubble.phase) * 0.6 * cssScale
          const x = point.x - bubble.tx * tangent - bubble.nx * normal
          const y = point.y + bubble.ty * tangent + bubble.ny * normal
          const size = bubble.size * cssScale
          context.drawImage(this.sprites[index % this.sprites.length], x - size, y - size, size * 2, size * 2)
        }
      }
      for (const bubble of this.smallBubbles) {
        const [a, b, c] = bubble.indices
        if (!this.face[a] || !this.face[b] || !this.face[c]) continue
        const [wa, wb, wc] = bubble.weights
        const u = this.face[a].x * wa + this.face[b].x * wb + this.face[c].x * wc
        const v = this.face[a].y * wa + this.face[b].y * wb + this.face[c].y * wc
        const point = this.project(u, v)
        const size = bubble.size * cssScale * (1 + Math.sin(now * 0.002 + bubble.phase) * 0.035)
        context.drawImage(this.sprites[bubble.sprite], point.x - size, point.y - size, size * 2, size * 2)
      }
      context.restore()
    }
    this.drawRain(now)
    this.canvas.classList.toggle('is-ready', showFoam || this.rainDrops.length > 0)
  }

  render(now: number, force = false) {
    if (!this.active) return
    if (this.leverHeld && this.rainUntil > 0) this.rainUntil = Math.max(this.rainUntil, now + 200)
    if (this.video.videoWidth && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      if (now >= this.rainUntil) this.sendHandFrame(now)
      this.segment(now)
    }
    this.hands.forEach((hand, key) => {
      if (now - hand.seenAt > HAND_GRACE) this.hands.delete(key)
    })
    if (this.washStartedAt > 0 && now - this.washStartedAt >= WASH_DURATION) {
      this.washStartedAt = 0
      this.baseBubbles = []
      this.smallBubbles.length = 0
      this.maskContext.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height)
    }
    if (!force && now - this.lastDrawAt < DRAW_INTERVAL) return
    this.lastDrawAt = now
    this.draw(now)
  }

  drawCapture(context: CanvasRenderingContext2D, width: number, height: number) {
    if (this.canvas.classList.contains('is-ready')) context.drawImage(this.canvas, 0, 0, width, height)
  }
}
