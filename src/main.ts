import './style.css'
import { ShampooScene } from './shampoo'
import { GlassesScene } from './glasses'
import { assetUrl } from './asset-url'
import type { ForestScene } from './forest'
import type { RumblingScene } from './rumbling'
import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

type Lemon = {
  id: number
  x: number
  y: number
  size: number
  rotation: number
  phase: number
  drift: number
  maxJuice: number
  juice: number
  element: HTMLDivElement
  held: boolean
  squeezed: boolean
  fallVelocity: number
  lastDropAt: number
}

type HandPoint = {
  x: number
  y: number
  isFist: boolean
  strength: number
  seenAt: number
}

type MouthPoint = {
  x: number
  y: number
  isRound: boolean
  openness: number
  seenAt: number
}

type FingertipPoint = {
  x: number
  y: number
  vx: number
  vy: number
  pulseAt: number
  energy: number
  seenAt: number
}

type TrackedFingertip = FingertipPoint & {
  hand: 'left' | 'right'
  finger: number
}

type WaterRipple = {
  x: number
  y: number
  bornAt: number
  energy: number
}

type PinchPoint = {
  hand: 'left' | 'right'
  x: number
  y: number
  vx: number
  vy: number
  isPinching: boolean
  seenAt: number
}

type Balloon = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  stringLength: number
  color: string
  shine: string
  phase: number
  heldBy: 'left' | 'right' | null
  cameraScale: number
  cameraMotionStartedAt: number | null
  mouthCooldownUntil: number
}

type BalloonFragment = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  spin: number
  color: string
  life: number
}

type Experience = 'lemonade' | 'watertouch' | 'balloon' | 'shiro' | 'impine' | 'rubber' | 'shampoo' | 'glasses' | 'forest' | 'rumbling'

type ImpineFacePoints = {
  leftEyeX: number
  leftEyeY: number
  rightCheekX: number
  rightCheekY: number
  seenAt: number
}

type RubberFaceState = {
  landmarks: NormalizedLandmark[]
  seenAt: number
}

type RubberWarp = {
  hand: 'left' | 'right'
  anchorX: number
  anchorY: number
  startX: number
  startY: number
  headX: number
  headY: number
  x: number
  y: number
  vx: number
  vy: number
  active: boolean
  releasedAt: number | null
}

type GunGesture = {
  isActive: boolean
  seenAt: number
}

type FeedHandPoint = HandPoint & {
  hand: 'left' | 'right'
  feedPose: 'fist' | 'open' | 'gun' | 'other'
}

type BoneFlight = {
  fromX: number
  fromY: number
  startedAt: number
  duration: number
  deliveredAt: number | null
  spin: number
}

const FINGERTIP_INDICES = [4, 8, 12, 16, 20]
const MAX_FINGERTIPS = 10
const FINGERTIP_TIMEOUT = 360
const MAX_WATER_RIPPLES = 28
const RIPPLE_LIFETIME = 1550
const RIPPLE_SPAWN_INTERVAL = 88
const BALLOON_FRAME_INTERVAL = 1000 / 30
const SHIRO_FRAME_INTERVAL = 1000 / 30
const PINCH_TIMEOUT = 260
const GUN_GESTURE_TIMEOUT = 280
const EFFECT_FRAME_INTERVAL = 1000 / 30
const RUBBER_FRAME_INTERVAL = 1000 / 30
const RUBBER_FACE_TIMEOUT = 440
const MAX_RENDER_DIMENSION = 3456

function retinaPixelRatio(width: number, height: number) {
  const deviceRatio = Math.min(window.devicePixelRatio || 1, 2)
  const longestEdge = Math.max(width, height, 1)
  return Math.max(1, Math.min(deviceRatio, MAX_RENDER_DIMENSION / longestEdge))
}

const WATER_VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const WATER_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uVideo;
uniform vec2 uViewport;
uniform vec2 uVideoSize;
uniform float uTime;
uniform vec4 uFingers[10];
uniform vec4 uVelocities[10];
uniform vec4 uRipples[28];

in vec2 vUv;
out vec4 outColor;

vec2 coverUv(vec2 uv) {
  float viewportAspect = uViewport.x / uViewport.y;
  float videoAspect = uVideoSize.x / uVideoSize.y;
  if (videoAspect > viewportAspect) {
    uv.x = (uv.x - 0.5) * viewportAspect / videoAspect + 0.5;
  } else {
    uv.y = (uv.y - 0.5) * videoAspect / viewportAspect + 0.5;
  }
  // The camera preview is mirrored for a natural selfie interaction.
  uv.x = 1.0 - uv.x;
  return uv;
}

void main() {
  vec2 uv = vUv;
  vec2 distortion = vec2(0.0);
  float screenAspect = uViewport.x / uViewport.y;

  for (int i = 0; i < 10; i++) {
    vec4 finger = uFingers[i];
    vec2 point = finger.xy;
    vec2 delta = uv - point;
    delta.x *= screenAspect;
    float distanceToFinger = length(delta);
    float age = max(0.0, uTime - finger.z);
    float rippleActivity = step(0.0, finger.w) * exp(-age * 1.75);
    vec2 direction = delta / max(distanceToFinger, 0.0001);
    direction.x /= screenAspect;
    float ring = sin(distanceToFinger * 96.0 - age * 15.0) * exp(-distanceToFinger * 8.5) * rippleActivity;
    float touch = sin(distanceToFinger * 54.0 - uTime * 7.0) * exp(-distanceToFinger * 20.0) * (0.44 + rippleActivity * 0.56);
    float velocityMagnitude = length(uVelocities[i].xy);
    vec2 movement = uVelocities[i].xy / max(velocityMagnitude, 0.0001);
    vec2 sideways = vec2(-movement.y, movement.x);
    float along = dot(delta, movement);
    float across = dot(delta, sideways);
    float behind = max(-along, 0.0);
    float wake = exp(-across * across * 190.0) * exp(-behind * 9.0) * step(along, 0.0) * velocityMagnitude;
    float splitDirection = sign(across);

    distortion += direction * (ring * finger.w * 0.022 + touch * 0.011);
    distortion += sideways * splitDirection * wake * 0.020;
  }

  // Moving fingertips leave short-lived expanding rings behind them.
  for (int i = 0; i < 28; i++) {
    vec4 ripple = uRipples[i];
    float rippleAge = uTime - ripple.z;
    float isAlive = step(0.0, ripple.w) * step(rippleAge, 1.55);
    vec2 delta = uv - ripple.xy;
    delta.x *= screenAspect;
    float distanceToRipple = length(delta);
    float radius = 0.018 + rippleAge * 0.20;
    float envelope = exp(-abs(distanceToRipple - radius) * 38.0);
    float band = sin((distanceToRipple - radius) * 105.0) * envelope;
    float secondaryBand = sin((distanceToRipple - radius * 0.68) * 122.0) * exp(-abs(distanceToRipple - radius * 0.68) * 52.0) * 0.38;
    float ageFade = max(0.0, 1.0 - rippleAge / 1.55);
    vec2 direction = delta / max(distanceToRipple, 0.0001);
    direction.x /= screenAspect;
    distortion += direction * (band + secondaryBand) * ripple.w * isAlive * ageFade * 0.036;
  }

  vec2 sampleUv = coverUv(uv + distortion);
  vec3 color = texture(uVideo, sampleUv).rgb;
  outColor = vec4(color, 1.0);
}`

const WATER_VERTEX_SHADER_WEBGL1 = WATER_VERTEX_SHADER
  .replace('#version 300 es\n', '')
  .replace('in vec2 aPosition;', 'attribute vec2 aPosition;')
  .replace('out vec2 vUv;', 'varying vec2 vUv;')

const WATER_FRAGMENT_SHADER_WEBGL1 = WATER_FRAGMENT_SHADER
  .replace('#version 300 es\n', '')
  .replace('precision highp float;', 'precision mediump float;')
  .replace('in vec2 vUv;\nout vec4 outColor;', 'varying vec2 vUv;')
  .replace('texture(uVideo, sampleUv)', 'texture2D(uVideo, sampleUv)')
  .replace('outColor =', 'gl_FragColor =')

class WaterRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly texture: WebGLTexture
  private readonly positionBuffer: WebGLBuffer
  private readonly viewportLocation: WebGLUniformLocation | null
  private readonly videoSizeLocation: WebGLUniformLocation | null
  private readonly timeLocation: WebGLUniformLocation | null
  private readonly fingersLocation: WebGLUniformLocation | null
  private readonly velocitiesLocation: WebGLUniformLocation | null
  private readonly ripplesLocation: WebGLUniformLocation | null
  private readonly positionLocation: number
  private readonly fingerData = new Float32Array(MAX_FINGERTIPS * 4)
  private readonly velocityData = new Float32Array(MAX_FINGERTIPS * 4)
  private readonly rippleData = new Float32Array(MAX_WATER_RIPPLES * 4)
  private width = 0
  private height = 0
  private lastVideoTime = -1

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext | WebGL2RenderingContext, program: WebGLProgram, texture: WebGLTexture, positionBuffer: WebGLBuffer) {
    this.canvas = canvas
    this.gl = gl
    this.program = program
    this.texture = texture
    this.positionBuffer = positionBuffer
    this.viewportLocation = gl.getUniformLocation(program, 'uViewport')
    this.videoSizeLocation = gl.getUniformLocation(program, 'uVideoSize')
    this.timeLocation = gl.getUniformLocation(program, 'uTime')
    this.fingersLocation = gl.getUniformLocation(program, 'uFingers[0]')
    this.velocitiesLocation = gl.getUniformLocation(program, 'uVelocities[0]')
    this.ripplesLocation = gl.getUniformLocation(program, 'uRipples[0]')
    this.positionLocation = gl.getAttribLocation(program, 'aPosition')

    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'uVideo'), 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.enableVertexAttribArray(this.positionLocation)
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  static create(canvas: HTMLCanvasElement) {
    const contextOptions: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
    }
    const webgl2 = canvas.getContext('webgl2', contextOptions)
    const gl = webgl2 ?? canvas.getContext('webgl', contextOptions)
    if (!gl) return null
    const vertexSource = webgl2 ? WATER_VERTEX_SHADER : WATER_VERTEX_SHADER_WEBGL1
    const fragmentSource = webgl2 ? WATER_FRAGMENT_SHADER : WATER_FRAGMENT_SHADER_WEBGL1

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Could not create water shader.')
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader error.'
        gl.deleteShader(shader)
        throw new Error(info)
      }
      return shader
    }

    try {
      const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource)
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource)
      const program = gl.createProgram()
      const texture = gl.createTexture()
      const positionBuffer = gl.createBuffer()
      if (!program || !texture || !positionBuffer) throw new Error('Could not create water renderer.')
      gl.attachShader(program, vertexShader)
      gl.attachShader(program, fragmentShader)
      gl.linkProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Could not link water renderer.')
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      return new WaterRenderer(canvas, gl, program, texture, positionBuffer)
    } catch (error) {
      console.warn('Water renderer could not load.', error)
      return null
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const pixelRatio = retinaPixelRatio(rect.width, rect.height)
    const width = Math.max(1, Math.round(rect.width * pixelRatio))
    const height = Math.max(1, Math.round(rect.height * pixelRatio))
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    this.gl.viewport(0, 0, width, height)
  }

  render(video: HTMLVideoElement, fingers: FingertipPoint[], ripples: WaterRipple[], now: number) {
    if (!video.videoWidth || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    this.resize()
    const gl = this.gl
    const fingerData = this.fingerData
    const velocityData = this.velocityData
    const rippleData = this.rippleData
    fingerData.fill(-2)
    velocityData.fill(0)
    rippleData.fill(-2)
    for (let index = 0; index < Math.min(fingers.length, MAX_FINGERTIPS); index += 1) {
      const finger = fingers[index]
      fingerData[index * 4] = finger.x / window.innerWidth
      fingerData[index * 4 + 1] = 1 - finger.y / window.innerHeight
      fingerData[index * 4 + 2] = finger.pulseAt / 1000
      fingerData[index * 4 + 3] = finger.energy
      velocityData[index * 4] = finger.vx
      velocityData[index * 4 + 1] = -finger.vy
    }
    for (let index = 0; index < Math.min(ripples.length, MAX_WATER_RIPPLES); index += 1) {
      const ripple = ripples[index]
      rippleData[index * 4] = ripple.x / window.innerWidth
      rippleData[index * 4 + 1] = 1 - ripple.y / window.innerHeight
      rippleData[index * 4 + 2] = ripple.bornAt / 1000
      rippleData[index * 4 + 3] = ripple.energy
    }

    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (video.currentTime !== this.lastVideoTime) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      this.lastVideoTime = video.currentTime
      this.canvas.classList.add('is-ready')
      video.classList.add('is-water-source')
    }
    gl.uniform2f(this.viewportLocation, this.width, this.height)
    gl.uniform2f(this.videoSizeLocation, video.videoWidth, video.videoHeight)
    gl.uniform1f(this.timeLocation, now / 1000)
    gl.uniform4fv(this.fingersLocation, fingerData)
    gl.uniform4fv(this.velocitiesLocation, velocityData)
    gl.uniform4fv(this.ripplesLocation, rippleData)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteBuffer(this.positionBuffer)
    this.gl.deleteProgram(this.program)
  }

  activate() {
    this.lastVideoTime = -1
  }
}

class RippleOverlay {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private pixelRatio = 1

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create ripple overlay.')
    this.canvas = canvas
    this.context = context
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const pixelRatio = retinaPixelRatio(rect.width, rect.height)
    const width = Math.max(1, Math.round(rect.width * pixelRatio))
    const height = Math.max(1, Math.round(rect.height * pixelRatio))
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.pixelRatio = pixelRatio
    this.canvas.width = width
    this.canvas.height = height
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  private drawVideoCover(video: HTMLVideoElement, offsetX: number, offsetY: number, cssWidth: number, cssHeight: number) {
    const scale = Math.max(cssWidth / video.videoWidth, cssHeight / video.videoHeight)
    const drawWidth = video.videoWidth * scale
    const drawHeight = video.videoHeight * scale
    const drawX = (cssWidth - drawWidth) / 2
    const drawY = (cssHeight - drawHeight) / 2
    this.context.translate(cssWidth + offsetX, offsetY)
    this.context.scale(-1, 1)
    this.context.drawImage(video, drawX, drawY, drawWidth, drawHeight)
  }

  render(video: HTMLVideoElement, fingers: FingertipPoint[], ripples: WaterRipple[], now: number, useCameraFallback: boolean) {
    this.resize()
    const context = this.context
    const cssWidth = this.width / this.pixelRatio
    const cssHeight = this.height / this.pixelRatio
    context.clearRect(0, 0, cssWidth, cssHeight)

    if (useCameraFallback && video.videoWidth) {
      fingers.forEach((finger, index) => {
        const speed = Math.min(1, Math.hypot(finger.vx, finger.vy) * 5)
        const radius = 64 + speed * 48
        const phase = now * 0.011 + index * 0.8
        const offsetX = -finger.vx * 105 + Math.sin(phase) * 10
        const offsetY = -finger.vy * 105 + Math.cos(phase * 0.9) * 7
        context.save()
        context.beginPath()
        context.ellipse(finger.x, finger.y, radius, radius * 0.58, 0, 0, Math.PI * 2)
        context.clip()
        context.globalAlpha = 0.82
        this.drawVideoCover(video, offsetX, offsetY, cssWidth, cssHeight)
        context.restore()
      })
    }

    ripples.forEach((ripple) => {
      const age = Math.min(RIPPLE_LIFETIME / 1000, Math.max(0, (now - ripple.bornAt) / 1000))
      const fade = 1 - age / (RIPPLE_LIFETIME / 1000)
      const radius = 18 + age * 128
      context.save()
      context.globalCompositeOperation = 'screen'
      context.strokeStyle = `rgba(187, 241, 250, ${0.32 * fade * ripple.energy})`
      context.lineWidth = 0.8 + ripple.energy * 0.65
      context.beginPath()
      context.ellipse(ripple.x, ripple.y, radius, radius * 0.42, 0, 0, Math.PI * 2)
      context.stroke()
      context.restore()
    })

    fingers.forEach((finger) => {
      const age = Math.min(1.45, Math.max(0, (now - finger.pulseAt) / 1000))
      const motion = Math.min(1, Math.hypot(finger.vx, finger.vy) * 5)
      const strength = Math.min(1, finger.energy / 1.15)
      const x = finger.x
      const y = finger.y
      const outerRadius = 24 + age * (106 + motion * 38)
      const coreRadius = 11 + motion * 9
      const fade = 1 - age / 1.45

      context.save()
      context.globalCompositeOperation = 'screen'
      context.strokeStyle = `rgba(196, 244, 251, ${0.28 * fade * strength})`
      context.lineWidth = 0.9 + strength * 0.7
      context.beginPath()
      context.ellipse(x, y, outerRadius, outerRadius * 0.42, 0, 0, Math.PI * 2)
      context.stroke()

      context.strokeStyle = `rgba(220, 250, 255, ${0.16 * fade * strength})`
      context.lineWidth = 0.8
      context.beginPath()
      context.ellipse(x, y, Math.max(coreRadius + 8, outerRadius * 0.56), Math.max(coreRadius * 0.58, outerRadius * 0.23), 0, 0, Math.PI * 2)
      context.stroke()

      context.fillStyle = `rgba(224, 252, 255, ${0.045 + motion * 0.08})`
      context.beginPath()
      context.ellipse(x, y, coreRadius, coreRadius * 0.48, 0, 0, Math.PI * 2)
      context.fill()
      context.restore()
    })
  }
}

class WaterAudioEngine {
  private context: AudioContext | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private lastSplashAt = 0

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' })
      this.destination = this.context.createMediaStreamDestination()
      const sampleCount = Math.round(this.context.sampleRate * 0.28)
      this.noiseBuffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate)
      const channel = this.noiseBuffer.getChannelData(0)
      for (let index = 0; index < sampleCount; index += 1) {
        const envelope = Math.pow(1 - index / sampleCount, 2.2)
        channel[index] = (Math.random() * 2 - 1) * envelope
      }
    }
    if (this.context.state === 'suspended') await this.context.resume()
  }

  splash(x: number, energy: number, now: number) {
    if (!this.context || !this.destination || !this.noiseBuffer || this.context.state !== 'running') return
    if (now - this.lastSplashAt < 82) return
    this.lastSplashAt = now
    const context = this.context
    const start = context.currentTime
    const strength = Math.min(1, Math.max(0.28, energy / 1.15))
    const master = context.createGain()
    const panner = context.createStereoPanner()
    panner.pan.value = Math.max(-0.72, Math.min(0.72, x / window.innerWidth * 1.44 - 0.72))
    master.gain.value = 0.54
    master.connect(panner)
    panner.connect(context.destination)
    panner.connect(this.destination)

    const noise = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const noiseGain = context.createGain()
    noise.buffer = this.noiseBuffer
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(720 + strength * 1050, start)
    filter.Q.value = 0.7
    noiseGain.gain.setValueAtTime(0.0001, start)
    noiseGain.gain.exponentialRampToValueAtTime(0.14 + strength * 0.16, start + 0.008)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24)
    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(master)

    const drop = context.createOscillator()
    const dropGain = context.createGain()
    drop.type = 'sine'
    drop.frequency.setValueAtTime(155 + strength * 75, start)
    drop.frequency.exponentialRampToValueAtTime(62, start + 0.17)
    dropGain.gain.setValueAtTime(0.0001, start)
    dropGain.gain.exponentialRampToValueAtTime(0.1 + strength * 0.09, start + 0.012)
    dropGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
    drop.connect(dropGain)
    dropGain.connect(master)
    noise.start(start)
    drop.start(start)
    noise.stop(start + 0.28)
    drop.stop(start + 0.21)
  }

  balloonPop(x: number) {
    if (!this.context || !this.destination || !this.noiseBuffer || this.context.state !== 'running') return
    const context = this.context
    const start = context.currentTime
    const master = context.createGain()
    const panner = context.createStereoPanner()
    panner.pan.value = Math.max(-0.78, Math.min(0.78, x / window.innerWidth * 1.56 - 0.78))
    master.gain.value = 0.72
    master.connect(panner)
    panner.connect(context.destination)
    panner.connect(this.destination)

    const snap = context.createBufferSource()
    const highpass = context.createBiquadFilter()
    const snapGain = context.createGain()
    snap.buffer = this.noiseBuffer
    snap.playbackRate.value = 1.55 + Math.random() * 0.35
    highpass.type = 'highpass'
    highpass.frequency.value = 850
    snapGain.gain.setValueAtTime(0.34, start)
    snapGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.105)
    snap.connect(highpass)
    highpass.connect(snapGain)
    snapGain.connect(master)

    const body = context.createOscillator()
    const bodyGain = context.createGain()
    body.type = 'triangle'
    body.frequency.setValueAtTime(205 + Math.random() * 45, start)
    body.frequency.exponentialRampToValueAtTime(72, start + 0.09)
    bodyGain.gain.setValueAtTime(0.17, start)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11)
    body.connect(bodyGain)
    bodyGain.connect(master)
    snap.start(start)
    body.start(start)
    snap.stop(start + 0.13)
    body.stop(start + 0.12)
  }

  recordingTrack() {
    return this.destination?.stream.getAudioTracks()[0] ?? null
  }

  dispose() {
    void this.context?.close()
    this.context = null
    this.destination = null
    this.noiseBuffer = null
  }
}

class BalloonScene {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly onPop: (x: number) => void
  private readonly balloons: Balloon[] = []
  private readonly fragments: BalloonFragment[] = []
  private readonly previousPinches = new Map<string, boolean>()
  private width = 0
  private height = 0
  private lastFrameAt = 0
  private nextSpawnAt = 0
  private nextId = 0
  private mouthWasRound = false

  constructor(canvas: HTMLCanvasElement, onPop: (x: number) => void) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create balloon scene.')
    this.canvas = canvas
    this.context = context
    this.onPop = onPop
  }

  activate(now: number) {
    this.resize()
    this.lastFrameAt = now
    if (this.balloons.length === 0) {
      for (let index = 0; index < 7; index += 1) this.spawn(now, index)
    }
  }

  deactivate() {
    this.balloons.forEach((balloon) => { balloon.heldBy = null })
    this.previousPinches.clear()
    this.mouthWasRound = false
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const pixelRatio = retinaPixelRatio(rect.width, rect.height)
    const width = Math.max(1, Math.round(rect.width * pixelRatio))
    const height = Math.max(1, Math.round(rect.height * pixelRatio))
    if (width === this.canvas.width && height === this.canvas.height) return
    this.width = width / pixelRatio
    this.height = height / pixelRatio
    this.canvas.width = width
    this.canvas.height = height
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  private spawn(now: number, seed = 0) {
    const colors = ['#ff786e', '#ffd15a', '#65d4c5', '#76a9ff', '#c58cff', '#ff94c6']
    const radius = 41 + Math.random() * 27
    const x = radius + Math.random() * Math.max(1, this.width - radius * 2)
    const y = seed > 0 ? this.height * (0.18 + (seed % 4) * 0.19) : this.height + radius * 2
    this.balloons.push({
      id: this.nextId,
      x,
      y,
      vx: (Math.random() - 0.5) * 13,
      vy: -(14 + Math.random() * 14),
      radius,
      stringLength: 76 + radius * 0.78,
      color: colors[this.nextId % colors.length],
      shine: 'rgba(255,255,255,.58)',
      phase: Math.random() * Math.PI * 2,
      heldBy: null,
      cameraScale: 1,
      cameraMotionStartedAt: null,
      mouthCooldownUntil: 0,
    })
    this.nextId += 1
    this.nextSpawnAt = now + 1250 + Math.random() * 900
  }

  private stringPoints(balloon: Balloon, pinches: PinchPoint[]) {
    const start = { x: balloon.x, y: balloon.y + balloon.radius * 0.82 }
    if (balloon.heldBy) {
      const pinch = pinches.find((point) => point.hand === balloon.heldBy && point.isPinching)
      if (pinch) return { start, end: { x: pinch.x, y: pinch.y } }
    }
    return { start, end: { x: start.x, y: start.y + balloon.stringLength } }
  }

  private pointToSegmentDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const position = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
      : 0
    return Math.hypot(point.x - (start.x + dx * position), point.y - (start.y + dy * position))
  }

  private grabNearestString(pinch: PinchPoint, pinches: PinchPoint[]) {
    let nearestBalloon: Balloon | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const balloon of this.balloons) {
      if (balloon.heldBy !== null) continue
      const points = this.stringPoints(balloon, pinches)
      const distance = this.pointToSegmentDistance(pinch, points.start, points.end)
      if (distance < nearestDistance) {
        nearestBalloon = balloon
        nearestDistance = distance
      }
    }
    if (nearestBalloon && nearestDistance < 30) nearestBalloon.heldBy = pinch.hand
  }

  private pop(index: number) {
    const balloon = this.balloons[index]
    this.onPop(balloon.x)
    for (let fragmentIndex = 0; fragmentIndex < 11; fragmentIndex += 1) {
      const angle = fragmentIndex / 11 * Math.PI * 2 + Math.random() * 0.34
      const speed = 75 + Math.random() * 115
      this.fragments.push({
        x: balloon.x,
        y: balloon.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 26,
        size: 6 + Math.random() * 8,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 8,
        color: balloon.color,
        life: 0.72 + Math.random() * 0.42,
      })
    }
    this.balloons.splice(index, 1)
  }

  private updateGrabs(pinches: PinchPoint[]) {
    const activeHands = new Set(pinches.filter((pinch) => pinch.isPinching).map((pinch) => pinch.hand))
    this.balloons.forEach((balloon) => {
      if (balloon.heldBy && !activeHands.has(balloon.heldBy)) balloon.heldBy = null
    })
    pinches.forEach((pinch) => {
      const wasPinching = this.previousPinches.get(pinch.hand) ?? false
      const isHolding = this.balloons.some((balloon) => balloon.heldBy === pinch.hand)
      if (pinch.isPinching && (!wasPinching || !isHolding)) this.grabNearestString(pinch, pinches)
      this.previousPinches.set(pinch.hand, pinch.isPinching)
    })
    ;(['left', 'right'] as const).forEach((hand) => {
      if (!pinches.some((pinch) => pinch.hand === hand)) this.previousPinches.set(hand, false)
    })
  }

  private updatePhysics(delta: number, now: number, pinches: PinchPoint[]) {
    if (now >= this.nextSpawnAt && this.balloons.length < 10) this.spawn(now)
    this.balloons.forEach((balloon) => {
      balloon.phase += delta * 1.15
      const pinch = balloon.heldBy
        ? pinches.find((point) => point.hand === balloon.heldBy && point.isPinching)
        : null
      balloon.vy -= 14 * delta
      balloon.vx += Math.sin(balloon.phase) * 5.5 * delta
      balloon.vx *= Math.pow(0.985, delta * 60)
      balloon.vy *= Math.pow(0.991, delta * 60)
      if (pinch) {
        balloon.vx += pinch.vx * this.width * delta * 2.8
        balloon.vy += pinch.vy * this.height * delta * 2.8
      }
      balloon.x += balloon.vx * delta
      balloon.y += balloon.vy * delta

      if (pinch) {
        const attachX = balloon.x
        const attachY = balloon.y + balloon.radius * 0.82
        let dx = attachX - pinch.x
        let dy = attachY - pinch.y
        let distance = Math.hypot(dx, dy)
        if (distance < 0.001) {
          dx = 0
          dy = -1
          distance = 1
        }
        const constrainedX = pinch.x + dx / distance * balloon.stringLength
        const constrainedY = pinch.y + dy / distance * balloon.stringLength
        const correctionX = constrainedX - attachX
        const correctionY = constrainedY - attachY
        balloon.x += correctionX
        balloon.y += correctionY
        balloon.vx += correctionX / Math.max(delta, 0.016) * 0.08
        balloon.vy += correctionY / Math.max(delta, 0.016) * 0.08
      }

      if (!pinch) {
        const edge = balloon.radius * 0.72
        if (balloon.x < edge) {
          balloon.x = edge
          balloon.vx = Math.abs(balloon.vx) * 0.45
        } else if (balloon.x > this.width - edge) {
          balloon.x = this.width - edge
          balloon.vx = -Math.abs(balloon.vx) * 0.45
        }
      }
    })

    for (let index = this.fragments.length - 1; index >= 0; index -= 1) {
      const fragment = this.fragments[index]
      fragment.life -= delta
      fragment.vy += 210 * delta
      fragment.x += fragment.vx * delta
      fragment.y += fragment.vy * delta
      fragment.rotation += fragment.spin * delta
      if (fragment.life <= 0) this.fragments.splice(index, 1)
    }
    for (let index = this.balloons.length - 1; index >= 0; index -= 1) {
      const balloon = this.balloons[index]
      if (!balloon.heldBy && balloon.y < -balloon.radius * 2.3) this.balloons.splice(index, 1)
    }
  }

  private detectPops(indexFingers: TrackedFingertip[]) {
    for (let balloonIndex = this.balloons.length - 1; balloonIndex >= 0; balloonIndex -= 1) {
      const balloon = this.balloons[balloonIndex]
      const touched = indexFingers.some((finger) => Math.hypot(finger.x - balloon.x, finger.y - balloon.y) < balloon.radius * 1.04)
      if (touched) this.pop(balloonIndex)
    }
  }

  private updateMouthInteraction(now: number, mouthPoint: MouthPoint | null) {
    const activeMouth = mouthPoint && now - mouthPoint.seenAt < 320 ? mouthPoint : null
    const mouthIsRound = activeMouth?.isRound ?? false
    if (mouthIsRound && !this.mouthWasRound && activeMouth) {
      const nearest = this.balloons
        .filter((balloon) => balloon.cameraMotionStartedAt === null && now >= balloon.mouthCooldownUntil)
        .map((balloon) => ({ balloon, distance: Math.hypot(activeMouth.x - balloon.x, activeMouth.y - balloon.y) }))
        .filter(({ balloon, distance }) => distance < balloon.radius * 1.15 + 34)
        .sort((a, b) => a.distance - b.distance)[0]
      if (nearest) nearest.balloon.cameraMotionStartedAt = now
    }
    this.mouthWasRound = mouthIsRound

    this.balloons.forEach((balloon) => {
      if (balloon.cameraMotionStartedAt === null) {
        balloon.cameraScale += (1 - balloon.cameraScale) * 0.18
        return
      }
      const progress = Math.min(1, (now - balloon.cameraMotionStartedAt) / 1450)
      const arc = Math.pow(Math.sin(progress * Math.PI), 0.82)
      balloon.cameraScale = 1 + arc * (0.95 + Math.min(0.25, activeMouth?.openness ?? 0))
      if (progress >= 1) {
        balloon.cameraScale = 1
        balloon.cameraMotionStartedAt = null
        balloon.mouthCooldownUntil = now + 850
      }
    })
  }

  private drawString(balloon: Balloon, pinches: PinchPoint[]) {
    const { start, end } = this.stringPoints(balloon, pinches)
    const sway = Math.sin(balloon.phase * 1.7) * Math.min(10, balloon.stringLength * 0.08)
    const context = this.context
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.bezierCurveTo(
      start.x + sway,
      start.y + balloon.stringLength * 0.32,
      end.x - sway,
      end.y - balloon.stringLength * 0.26,
      end.x,
      end.y,
    )
    context.strokeStyle = 'rgba(255,255,255,.72)'
    context.lineWidth = 1.15
    context.stroke()
  }

  private drawBalloon(balloon: Balloon) {
    const context = this.context
    const squash = 0.94 + Math.sin(balloon.phase * 2.1) * 0.018
    context.save()
    context.translate(balloon.x, balloon.y)
    context.rotate(Math.max(-0.16, Math.min(0.16, balloon.vx * 0.004)))
    context.scale(balloon.cameraScale, balloon.cameraScale * squash)
    if (balloon.cameraScale > 1.04) {
      context.shadowColor = 'rgba(10,18,35,.34)'
      context.shadowBlur = 14 + (balloon.cameraScale - 1) * 20
      context.shadowOffsetY = 8
    }
    context.beginPath()
    context.moveTo(0, -balloon.radius)
    context.bezierCurveTo(balloon.radius * 0.82, -balloon.radius * 0.9, balloon.radius * 0.94, balloon.radius * 0.35, 0, balloon.radius)
    context.bezierCurveTo(-balloon.radius * 0.94, balloon.radius * 0.35, -balloon.radius * 0.82, -balloon.radius * 0.9, 0, -balloon.radius)
    context.fillStyle = balloon.color
    context.globalAlpha = 0.9
    context.fill()
    context.strokeStyle = 'rgba(255,255,255,.32)'
    context.lineWidth = 1.2
    context.stroke()
    context.globalAlpha = 1
    context.fillStyle = balloon.shine
    context.beginPath()
    context.ellipse(-balloon.radius * 0.3, -balloon.radius * 0.38, balloon.radius * 0.13, balloon.radius * 0.28, -0.42, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = balloon.color
    context.beginPath()
    context.moveTo(0, balloon.radius * 0.92)
    context.lineTo(-5, balloon.radius + 9)
    context.lineTo(6, balloon.radius + 8)
    context.closePath()
    context.restore()
  }

  private draw(pinches: PinchPoint[]) {
    const context = this.context
    context.clearRect(0, 0, this.width, this.height)
    this.balloons.forEach((balloon) => this.drawString(balloon, pinches))
    ;[...this.balloons]
      .sort((a, b) => a.cameraScale - b.cameraScale)
      .forEach((balloon) => this.drawBalloon(balloon))
    this.fragments.forEach((fragment) => {
      context.save()
      context.globalAlpha = Math.min(1, fragment.life * 1.8)
      context.translate(fragment.x, fragment.y)
      context.rotate(fragment.rotation)
      context.fillStyle = fragment.color
      context.beginPath()
      context.moveTo(-fragment.size, -fragment.size * 0.34)
      context.lineTo(fragment.size, 0)
      context.lineTo(-fragment.size * 0.55, fragment.size * 0.72)
      context.closePath()
      context.fill()
      context.restore()
    })
  }

  render(now: number, indexFingers: TrackedFingertip[], pinches: PinchPoint[], mouthPoint: MouthPoint | null) {
    if (now - this.lastFrameAt < BALLOON_FRAME_INTERVAL) return
    this.resize()
    const delta = Math.min(0.05, Math.max(0.001, (now - this.lastFrameAt) / 1000))
    this.lastFrameAt = now
    this.updateGrabs(pinches)
    this.updatePhysics(delta, now, pinches)
    this.updateMouthInteraction(now, mouthPoint)
    this.detectPops(indexFingers)
    this.draw(pinches)
  }
}

class ShiroScene {
  private readonly dog: HTMLDivElement
  private readonly walkImage: HTMLImageElement
  private readonly bellyImage: HTMLImageElement
  private readonly bone: HTMLDivElement
  private readonly feedArmedAt = new Map<'left' | 'right', number>()
  private width = 0
  private height = 0
  private dogWidth = 240
  private dogHeight = 150
  private x = 0
  private targetX = 0
  private speed = 70
  private facing = 1
  private lastFrameAt = 0
  private pauseUntil = 0
  private bellyUntil = 0
  private biteUntil = 0
  private boneFlight: BoneFlight | null = null
  private gestureWasActive = false
  private active = false

  constructor(root: HTMLDivElement) {
    this.dog = root.querySelector<HTMLDivElement>('.shiro-dog')!
    this.walkImage = root.querySelector<HTMLImageElement>('.shiro-walk-image')!
    this.bellyImage = root.querySelector<HTMLImageElement>('.shiro-belly-image')!
    this.bone = root.querySelector<HTMLDivElement>('.shiro-bone')!
  }

  activate(now: number) {
    this.active = true
    this.resize(true)
    this.lastFrameAt = now
    this.pauseUntil = now + 350
    this.chooseTarget()
    this.drawDom(now)
  }

  deactivate() {
    this.active = false
    this.gestureWasActive = false
    this.bellyUntil = 0
    this.biteUntil = 0
    this.boneFlight = null
    this.feedArmedAt.clear()
    this.bone.classList.remove('is-visible')
    this.dog.classList.remove('is-belly', 'is-biting')
  }

  private resize(force = false) {
    const width = Math.max(1, window.innerWidth)
    const height = Math.max(1, window.innerHeight)
    if (!force && width === this.width && height === this.height) return
    const oldWidth = this.width
    this.width = width
    this.height = height
    this.dogWidth = Math.max(172, Math.min(310, width * 0.205))
    this.dogHeight = this.dogWidth * 0.625
    this.x = oldWidth > 0 ? this.x / oldWidth * width : width * 0.5
    this.x = Math.max(this.dogWidth * 0.52, Math.min(width - this.dogWidth * 0.52, this.x))
    this.targetX = Math.max(this.dogWidth * 0.52, Math.min(width - this.dogWidth * 0.52, this.targetX || width * 0.72))
    this.dog.style.width = `${this.dogWidth}px`
    this.dog.style.height = `${this.dogHeight}px`

    const sheetScale = this.dogWidth / 800
    this.walkImage.style.width = `${1586 * sheetScale}px`
    this.walkImage.style.height = `${992 * sheetScale}px`
    this.walkImage.style.left = `${-30 * sheetScale}px`
    this.walkImage.style.top = `${-15 * sheetScale}px`
  }

  private chooseTarget() {
    const margin = this.dogWidth * 0.54
    const span = Math.max(1, this.width - margin * 2)
    let next = margin + Math.random() * span
    if (Math.abs(next - this.x) < Math.min(180, span * 0.28)) {
      next = this.x < this.width * 0.5 ? margin + span * 0.78 : margin + span * 0.22
    }
    this.targetX = Math.max(margin, Math.min(this.width - margin, next))
    this.speed = 48 + Math.random() * 46
  }

  private updateWalk(delta: number, now: number) {
    if (now < this.pauseUntil) return
    const distance = this.targetX - this.x
    if (Math.abs(distance) < 5) {
      this.x = this.targetX
      this.pauseUntil = now + 500 + Math.random() * 1150
      this.chooseTarget()
      return
    }
    const direction = Math.sign(distance)
    this.facing = direction > 0 ? -1 : 1
    this.x += direction * Math.min(Math.abs(distance), this.speed * delta)
  }

  private mouthPosition() {
    return {
      x: this.x - this.facing * this.dogWidth * 0.33,
      y: this.height - 14 - this.dogHeight * 0.52,
    }
  }

  private startBoneFlight(hand: FeedHandPoint, now: number) {
    this.facing = hand.x < this.x ? 1 : -1
    const mouth = this.mouthPosition()
    const distance = Math.hypot(mouth.x - hand.x, mouth.y - hand.y)
    this.bellyUntil = 0
    this.boneFlight = {
      fromX: hand.x,
      fromY: hand.y,
      startedAt: now,
      duration: Math.max(560, Math.min(900, 520 + distance * 0.22)),
      deliveredAt: null,
      spin: (Math.random() < 0.5 ? -1 : 1) * (420 + Math.random() * 240),
    }
    this.pauseUntil = now + 1700
  }

  private updateFeeding(now: number, hands: FeedHandPoint[]) {
    const visibleHands = new Set(hands.map((hand) => hand.hand))
    hands.forEach((hand) => {
      const armedAt = this.feedArmedAt.get(hand.hand)
      if (hand.feedPose === 'gun') {
        this.feedArmedAt.delete(hand.hand)
        return
      }
      if (hand.feedPose === 'fist') {
        if (armedAt === undefined) this.feedArmedAt.set(hand.hand, now)
        return
      }
      if (armedAt === undefined) return
      if (now - armedAt > 2200) {
        this.feedArmedAt.delete(hand.hand)
      } else if (hand.feedPose === 'open' && now - armedAt >= 80 && !this.boneFlight) {
        this.feedArmedAt.delete(hand.hand)
        this.startBoneFlight(hand, now)
      }
    })
    this.feedArmedAt.forEach((armedAt, hand) => {
      if (!visibleHands.has(hand) && now - armedAt > 500) this.feedArmedAt.delete(hand)
    })

    if (!this.boneFlight) return
    if (this.boneFlight.deliveredAt === null && now - this.boneFlight.startedAt >= this.boneFlight.duration) {
      this.boneFlight.deliveredAt = now
      this.biteUntil = now + 1050
    } else if (this.boneFlight.deliveredAt !== null && now - this.boneFlight.deliveredAt > 920) {
      this.boneFlight = null
      this.pauseUntil = now + 320
    }
  }

  private bonePose(now: number) {
    const flight = this.boneFlight
    if (!flight) return null
    const mouth = this.mouthPosition()
    if (flight.deliveredAt !== null) {
      const heldProgress = Math.min(1, (now - flight.deliveredAt) / 920)
      return {
        x: mouth.x,
        y: mouth.y + Math.sin(now * 0.035) * 2,
        rotation: this.facing === 1 ? -8 : 8,
        scale: 1 - heldProgress * 0.22,
        opacity: Math.min(1, (1 - heldProgress) * 2.8),
      }
    }
    const progress = Math.min(1, Math.max(0, (now - flight.startedAt) / flight.duration))
    const eased = 1 - Math.pow(1 - progress, 2)
    const distance = Math.hypot(mouth.x - flight.fromX, mouth.y - flight.fromY)
    const arc = Math.min(190, 55 + distance * 0.2)
    return {
      x: flight.fromX + (mouth.x - flight.fromX) * eased,
      y: flight.fromY + (mouth.y - flight.fromY) * eased - Math.sin(progress * Math.PI) * arc,
      rotation: flight.spin * progress,
      scale: 0.72 + Math.sin(progress * Math.PI) * 0.3,
      opacity: 1,
    }
  }

  private drawBoneDom(now: number) {
    const pose = this.bonePose(now)
    this.bone.classList.toggle('is-visible', Boolean(pose))
    if (!pose) {
      this.bone.style.opacity = '0'
      return
    }
    this.bone.style.opacity = `${pose.opacity}`
    this.bone.style.transform = `translate3d(${pose.x - 26}px, ${pose.y - 9}px, 0) rotate(${pose.rotation}deg) scale(${pose.scale})`
  }

  private drawDom(now: number) {
    const isBelly = now < this.bellyUntil
    const isBiting = now < this.biteUntil
    const isPaused = now < this.pauseUntil || Boolean(this.boneFlight) || isBiting
    const bob = !isBelly && !isPaused ? Math.sin(now * 0.012) * 3 : 0
    const top = this.height - this.dogHeight - 14 + bob
    const tilt = isBelly ? 0 : Math.sin(now * 0.006) * 0.8
    this.dog.classList.toggle('is-belly', isBelly)
    this.dog.classList.toggle('is-biting', isBiting && !isBelly)
    this.dog.classList.toggle('is-walking', !isBelly && !isPaused)
    this.dog.style.transform = `translate3d(${this.x - this.dogWidth / 2}px, ${top}px, 0) scaleX(${this.facing}) rotate(${tilt}deg)`
    this.drawBoneDom(now)
  }

  render(now: number, gestureActive: boolean, hands: FeedHandPoint[]) {
    if (!this.active || now - this.lastFrameAt < SHIRO_FRAME_INTERVAL) return
    this.resize()
    const delta = Math.min(0.05, Math.max(0.001, (now - this.lastFrameAt) / 1000))
    this.lastFrameAt = now

    if (gestureActive && !this.gestureWasActive) {
      this.bellyUntil = now + 2200
    } else if (gestureActive && this.bellyUntil > 0) {
      this.bellyUntil = Math.max(this.bellyUntil, now + 420)
    }
    this.gestureWasActive = gestureActive

    this.updateFeeding(now, hands)
    if (now >= this.bellyUntil && !this.boneFlight && now >= this.biteUntil) this.updateWalk(delta, now)
    this.drawDom(now)
  }

  isFeeding() {
    return Boolean(this.boneFlight && this.boneFlight.deliveredAt === null)
  }

  isFeedArmed() {
    return this.feedArmedAt.size > 0
  }

  isBiting(now: number) {
    return now < this.biteUntil
  }

  drawCapture(context: CanvasRenderingContext2D, outputWidth: number, outputHeight: number, now: number) {
    if (!this.walkImage.complete || !this.walkImage.naturalWidth) return
    const scaleX = outputWidth / Math.max(1, this.width)
    const scaleY = outputHeight / Math.max(1, this.height)
    const ground = this.height - 14
    const isBelly = now < this.bellyUntil && this.bellyImage.complete && this.bellyImage.naturalWidth > 0
    context.save()
    context.scale(scaleX, scaleY)
    context.translate(this.x, 0)
    context.scale(this.facing, 1)
    if (isBelly) {
      const width = this.dogWidth * 1.18
      const height = width / 1.5
      context.drawImage(this.bellyImage, -width / 2, ground - height, width, height)
    } else {
      context.drawImage(this.walkImage, 30, 15, 800, 500, -this.dogWidth / 2, ground - this.dogHeight, this.dogWidth, this.dogHeight)
    }
    context.restore()

    const pose = this.bonePose(now)
    if (!pose) return
    context.save()
    context.scale(scaleX, scaleY)
    context.translate(pose.x, pose.y)
    context.rotate(pose.rotation * Math.PI / 180)
    context.scale(pose.scale, pose.scale)
    context.globalAlpha = pose.opacity
    context.shadowColor = 'rgba(24,18,12,.25)'
    context.shadowBlur = 7
    context.shadowOffsetY = 4
    context.fillStyle = '#f3dfbd'
    context.fillRect(-19, -6, 38, 12)
    ;[[-20, -6], [-20, 6], [20, -6], [20, 6]].forEach(([x, y]) => {
      context.beginPath()
      context.arc(x, y, 7.5, 0, Math.PI * 2)
      context.fill()
    })
    context.restore()
  }
}

// Replace this path with any image you add under /public when customizing the lemons.
const LEMON_IMAGE = assetUrl('/lemons/lemon-user.png')
const DETECTION_INTERVAL = 1000 / 15
const WATER_DETECTION_INTERVAL = 1000 / 20
const FACE_DETECTION_INTERVAL = 1000 / 10
const HAND_TIMEOUT = 260

const IMPINE_EYE_GROUPS = [
  [468, 469, 470, 471, 472],
  [473, 474, 475, 476, 477],
]
const IMPINE_EYE_FALLBACK_GROUPS = [
  [33, 133, 159, 145],
  [362, 263, 386, 374],
]
const IMPINE_CHEEK_GROUPS = [
  [50, 101, 118, 147, 187, 205],
  [280, 330, 347, 376, 411, 425],
]

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main id="experience-app" class="lemonade-app" aria-label="Interactive camera experiences">
    <video id="camera-video" class="camera-video" autoplay playsinline muted></video>
    <canvas id="water-canvas" class="water-canvas" aria-hidden="true"></canvas>
    <canvas id="rubber-canvas" class="rubber-canvas" aria-hidden="true"></canvas>
    <canvas id="shampoo-canvas" class="shampoo-canvas" aria-hidden="true"></canvas>
    <canvas id="glasses-canvas" class="glasses-canvas" aria-hidden="true"></canvas>
    <canvas id="ripple-canvas" class="ripple-canvas" aria-hidden="true"></canvas>
    <canvas id="balloon-canvas" class="balloon-canvas" aria-hidden="true"></canvas>
    <div id="impine-window" class="impine-window" aria-label="아임피네 WebCam window">
      <img class="impine-note" src="/%22%E1%84%82%E1%85%A1%20%E1%84%8C%E1%85%B5%E1%86%AB%E1%84%8D%E1%85%A1%20%E1%84%80%E1%85%AB%E1%86%AB%E1%84%8E%E1%85%A1%E1%86%AD%E1%84%8B%E1%85%A1..%22.png" alt="나 진짜 괜찮아.." draggable="false" />
      <div class="impine-window-controls" role="toolbar" aria-label="WebCam window controls">
        <button id="impine-minimize" class="impine-window-button" type="button" aria-label="Minimize WebCam"><span>—</span></button>
        <button id="impine-maximize" class="impine-window-button" type="button" aria-label="Maximize WebCam"><span>□</span></button>
        <button id="impine-close" class="impine-window-button impine-close-button" type="button" aria-label="Close WebCam"><span>×</span></button>
      </div>
      <div id="impine-stage" class="impine-stage" aria-label="아임피네 split camera">
        <canvas id="impine-canvas" class="impine-canvas" aria-hidden="true"></canvas>
      </div>
      <div id="impine-console" class="impine-console" aria-hidden="true">
        <div class="impine-info"><span>CAMERA 01</span><span>640 × 480</span></div>
        <div id="impine-state" class="impine-state">READY</div>
      </div>
      <span class="impine-minimized-label">WebCam</span>
    </div>
    <div id="shiro-scene" class="shiro-scene" aria-hidden="true">
      <div class="shiro-dog">
        <img class="shiro-walk-image" src="${assetUrl('/shiro-sprites.png')}" alt="" draggable="false" />
        <img class="shiro-belly-image" src="${assetUrl('/shiro-belly.png')}" alt="" draggable="false" />
      </div>
      <div class="shiro-bone" aria-hidden="true"></div>
    </div>
    <div class="camera-fallback" aria-hidden="true"></div>
    <div class="camera-shade" aria-hidden="true"></div>

    <header class="experience-header">
      <div id="experience-eyebrow" class="eyebrow"><span class="eyebrow-dot"></span>EXPERIMENT 07</div>
      <h1 id="experience-title">Lemonade</h1>
      <p id="experience-copy">Turn a little squeeze into a whole lot of sunshine.</p>
    </header>

    <nav class="experience-switcher" aria-label="Choose an experience">
      <button class="experience-option is-active" type="button" data-experience="lemonade" aria-pressed="true">Lemonade</button>
      <button class="experience-option" type="button" data-experience="watertouch" aria-pressed="false">WaterTouch</button>
      <button class="experience-option" type="button" data-experience="balloon" aria-pressed="false">Balloon</button>
      <button class="experience-option" type="button" data-experience="shiro" aria-pressed="false">흰둥이</button>
      <button class="experience-option" type="button" data-experience="impine" aria-pressed="false">아임피네</button>
      <button class="experience-option" type="button" data-experience="rubber" aria-pressed="false">고무인간</button>
      <button class="experience-option" type="button" data-experience="shampoo" aria-pressed="false">Shampoo</button>
      <button class="experience-option" type="button" data-experience="glasses" aria-pressed="false">안경</button>
      <button class="experience-option" type="button" data-experience="forest" aria-pressed="false">동물의 숲</button>
      <button class="experience-option" type="button" data-experience="rumbling" aria-pressed="false">땅울림</button>
      <button class="experience-option" type="button" data-experience="minecraft" aria-pressed="false">마인크래프트</button>
    </nav>

    <button id="shampoo-lever" class="shampoo-lever" type="button" aria-label="샤워 레버를 아래로 당겨 거품 씻기" aria-hidden="true" tabindex="-1">
      <span class="shampoo-lever-title">SHOWER</span>
      <span class="shampoo-lever-track"><span class="shampoo-lever-handle"><span></span><span></span><span></span></span></span>
      <span class="shampoo-lever-hint">PULL ↓</span>
    </button>

    <div id="lemon-layer" class="lemon-layer" aria-hidden="true"></div>
    <div id="juice-layer" class="juice-layer" aria-hidden="true"></div>
    <div id="sip-layer" class="sip-layer" aria-hidden="true"></div>

    <div id="hand-guide" class="hand-guide" role="status">
      <span class="guide-icon">✦</span>
      <span id="guide-copy">Allow camera access, then squeeze a lemon with your left hand.</span>
    </div>

    <div id="cup" class="glass-cup" aria-label="Lemonade glass">
            <img class="cup-image" src="${assetUrl('/cup2.png')}" alt="" draggable="false" />
      <div class="cup-glow"></div>
      <div class="cup-liquid"><span class="liquid-shine"></span></div>
      <div class="ice ice-one"></div>
      <div class="ice ice-two"></div>
      <div class="ice ice-three"></div>
      <div class="slice slice-one"></div>
      <div class="slice slice-two"></div>
      <div class="straw"><span class="straw-tip"></span></div>
      <div class="cup-rim"></div>
      <div class="cup-label">LEMONADE</div>
    </div>

    <div class="bottom-ui">
      <div class="cup-meter" aria-label="Lemonade fill level">
        <span class="meter-label">FRESHLY SQUEEZED</span>
        <span id="meter-value">0%</span>
      </div>
      <button id="camera-button" class="camera-button" type="button" aria-label="Take photo or record video">
        <span class="camera-button-inner"></span>
      </button>
      <p id="capture-hint" class="capture-hint">tap for a photo · hold to record</p>
    </div>

    <div id="camera-status" class="camera-status" role="status"></div>
    <canvas id="capture-canvas" hidden></canvas>
  </main>
`

document.querySelector<HTMLImageElement>('.impine-note')!.src = assetUrl('/%22%E1%84%82%E1%85%A1%20%E1%84%8C%E1%85%B5%E1%86%AB%E1%84%8C%E1%85%A1%20%E1%84%80%E1%85%AB%E1%86%AB%E1%84%8C%E1%85%A1%E1%86%AD%E1%84%8B%E1%85%A1..%22.png')
document.documentElement.style.setProperty('--impine-window-background', `url("${assetUrl('/구식 webcam 프로그램 배경.png')}")`)

const video = document.querySelector<HTMLVideoElement>('#camera-video')!
const waterCanvas = document.querySelector<HTMLCanvasElement>('#water-canvas')!
const rubberCanvas = document.querySelector<HTMLCanvasElement>('#rubber-canvas')!
const shampooCanvas = document.querySelector<HTMLCanvasElement>('#shampoo-canvas')!
const glassesCanvas = document.querySelector<HTMLCanvasElement>('#glasses-canvas')!
const shampooLever = document.querySelector<HTMLButtonElement>('#shampoo-lever')!
const rippleCanvas = document.querySelector<HTMLCanvasElement>('#ripple-canvas')!
const balloonCanvas = document.querySelector<HTMLCanvasElement>('#balloon-canvas')!
const impineStage = document.querySelector<HTMLDivElement>('#impine-stage')!
const impineCanvas = document.querySelector<HTMLCanvasElement>('#impine-canvas')!
const impineState = document.querySelector<HTMLDivElement>('#impine-state')!
const impineWindow = document.querySelector<HTMLDivElement>('#impine-window')!
const impineMinimize = document.querySelector<HTMLButtonElement>('#impine-minimize')!
const impineMaximize = document.querySelector<HTMLButtonElement>('#impine-maximize')!
const impineClose = document.querySelector<HTMLButtonElement>('#impine-close')!
const shiroSceneElement = document.querySelector<HTMLDivElement>('#shiro-scene')!
const experienceApp = document.querySelector<HTMLElement>('#experience-app')!
const experienceEyebrow = document.querySelector<HTMLDivElement>('#experience-eyebrow')!
const experienceTitle = document.querySelector<HTMLHeadingElement>('#experience-title')!
const experienceCopy = document.querySelector<HTMLParagraphElement>('#experience-copy')!
const experienceOptions = Array.from(document.querySelectorAll<HTMLButtonElement>('.experience-option'))
const lemonLayer = document.querySelector<HTMLDivElement>('#lemon-layer')!
const juiceLayer = document.querySelector<HTMLDivElement>('#juice-layer')!
const sipLayer = document.querySelector<HTMLDivElement>('#sip-layer')!
const cup = document.querySelector<HTMLDivElement>('#cup')!
const guideCopy = document.querySelector<HTMLSpanElement>('#guide-copy')!
const meterValue = document.querySelector<HTMLSpanElement>('#meter-value')!
const status = document.querySelector<HTMLDivElement>('#camera-status')!
const cameraButton = document.querySelector<HTMLButtonElement>('#camera-button')!
const captureCanvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!
const captureHint = document.querySelector<HTMLParagraphElement>('#capture-hint')!

const lemons: Lemon[] = []
let stream: MediaStream | null = null
let handLandmarker: HandLandmarker | null = null
let faceLandmarker: FaceLandmarker | null = null
let impineFacePoints: ImpineFacePoints | null = null
let rubberFace: RubberFaceState | null = null
let waterRenderer: WaterRenderer | null = WaterRenderer.create(waterCanvas)
let rubberRenderer: RubberFaceRenderer | null = null
const rippleOverlay = new RippleOverlay(rippleCanvas)
const waterAudio = new WaterAudioEngine()
const balloonScene = new BalloonScene(balloonCanvas, (x) => waterAudio.balloonPop(x))
const shiroScene = new ShiroScene(shiroSceneElement)
const shampooScene = new ShampooScene(shampooCanvas, video)
const glassesScene = new GlassesScene(glassesCanvas, video)
let forestScene: ForestScene | null = null
let forestLoadGeneration = 0
let rumblingScene: RumblingScene | null = null
let rumblingLoadGeneration = 0

async function activateRumbling() {
  const generation = ++rumblingLoadGeneration
  try {
    const { RumblingScene } = await import('./rumbling')
    if (activeExperience !== 'rumbling' || resourcesDisposed || generation !== rumblingLoadGeneration) return
    rumblingScene ??= new RumblingScene(experienceApp)
    rumblingScene.activate()
  } catch (error) {
    rumblingScene?.deactivate()
    console.error('Rumbling scene could not load.', error)
    if (activeExperience === 'rumbling') experienceCopy.textContent = '3D 도시를 불러오지 못했어요. 다른 예제로 이동한 뒤 다시 선택해주세요.'
  }
}

async function activateForest() {
  const generation = ++forestLoadGeneration
  try {
    const { ForestScene } = await import('./forest')
    if (activeExperience !== 'forest' || resourcesDisposed || generation !== forestLoadGeneration) return
    forestScene ??= new ForestScene(experienceApp)
    forestScene.activate()
  } catch (error) {
    console.error('Forest scene could not load.', error)
    if (activeExperience === 'forest') experienceCopy.textContent = '마을을 불러오지 못했어요. 다른 예제로 이동한 뒤 다시 선택해주세요.'
  }
}
let impineRenderer: ImpineRenderer
let lastDetectionAt = 0
let lastFaceDetectionAt = 0
let lastFrameAt = performance.now()
let detectionFrame = 0
let animationFrame = 0
let leftHand: HandPoint | null = null
let rightHand: HandPoint | null = null
const fingertipTracks = new Map<string, TrackedFingertip>()
const pinchTracks = new Map<'left' | 'right', PinchPoint>()
const waterRipples: WaterRipple[] = []
const lastRippleAt = new Map<string, number>()
let mouth: MouthPoint | null = null
let gunGesture: GunGesture | null = null
let feedHands: FeedHandPoint[] = []
let rubberWarp: RubberWarp | null = null
let grabbedLemon: Lemon | null = null
let lemonadeFill = 0
let strawUnlocked = false
let isDrinking = false
let lastSipAt = 0
let handModelReady = false
let isRecording = false
let mediaRecorder: MediaRecorder | null = null
let recordingCanvasStream: MediaStream | null = null
let recordedChunks: Blob[] = []
let lastRecordedFrameAt = 0
let lastEffectFrameAt = 0
let pressTimer = 0
let pressStartedAt = 0
let longPressTriggered = false
let activeExperience: Experience = 'lemonade'
let previousExperience: Experience = 'lemonade'
let resourcesDisposed = false
let visionGeneration = 0
let leverPointerId: number | null = null
let leverStartY = 0
let leverTriggered = false

function createLemons() {
  const startingPositions = [
    [14, 25, 92, 7],
    [38, 17, 78, 11],
    [65, 25, 104, 17],
    [86, 16, 84, 3],
    [52, 39, 70, 23],
  ]

  startingPositions.forEach(([x, y, size, phase], index) => {
    const element = document.createElement('div')
    element.className = 'lemon-orb'
    element.innerHTML = `<div class="lemon-halo"></div><img src="${LEMON_IMAGE}" alt="" draggable="false" />`
    lemonLayer.append(element)

    lemons.push({
      id: index,
      x,
      y,
      size,
      rotation: -12 + index * 10,
      phase,
      drift: 0.7 + index * 0.08,
      maxJuice: 0.72 + index * 0.06,
      juice: 0.72 + index * 0.06,
      element,
      held: false,
      squeezed: false,
      fallVelocity: 0,
      lastDropAt: 0,
    })
  })
}

function setStatus(message: string, visible = true) {
  status.textContent = message
  status.classList.toggle('is-visible', visible)
}

function setImpineState(message: string) {
  impineState.textContent = message
}

function resetShampooLever() {
  if (leverPointerId !== null && shampooLever.hasPointerCapture(leverPointerId)) shampooLever.releasePointerCapture(leverPointerId)
  leverPointerId = null
  leverTriggered = false
  shampooLever.classList.remove('is-dragging', 'is-pulled')
  shampooLever.style.setProperty('--lever-pull', '0px')
  shampooScene.setLeverHeld(false)
}

function setExperience(experience: Experience) {
  if (experience === activeExperience) return
  if (isRecording) stopRecording()
  stopVisionSession()
  if (experience === 'impine' && activeExperience !== 'impine') previousExperience = activeExperience
  if (activeExperience === 'balloon') balloonScene.deactivate()
  if (activeExperience === 'shiro') shiroScene.deactivate()
  if (activeExperience === 'impine') impineRenderer.reset()
  if (activeExperience === 'rubber') rubberRenderer?.reset()
  if (activeExperience === 'shampoo') {
    resetShampooLever()
    shampooScene.deactivate()
  }
  if (activeExperience === 'glasses') glassesScene.deactivate()
  if (activeExperience === 'forest') { forestLoadGeneration += 1; forestScene?.deactivate() }
  if (activeExperience === 'rumbling') { rumblingLoadGeneration += 1; rumblingScene?.deactivate() }
  rubberWarp = null
  rubberFace = null
  experienceApp.classList.remove('is-impine-minimized', 'is-impine-maximized')
  activeExperience = experience
  const isWaterTouch = experience === 'watertouch'
  const isBalloon = experience === 'balloon'
  const isShiro = experience === 'shiro'
  const isImpine = experience === 'impine'
  const isRubber = experience === 'rubber'
  const isShampoo = experience === 'shampoo'
  const isGlasses = experience === 'glasses'
  const isForest = experience === 'forest'
  const isRumbling = experience === 'rumbling'
  experienceApp.classList.toggle('is-rumbling', isRumbling)
  experienceApp.classList.toggle('is-forest', isForest)
  experienceApp.classList.toggle('is-watertouch', isWaterTouch)
  experienceApp.classList.toggle('is-balloon', isBalloon)
  experienceApp.classList.toggle('is-shiro', isShiro)
  experienceApp.classList.toggle('is-impine', isImpine)
  experienceApp.classList.toggle('is-rubber', isRubber)
  experienceApp.classList.toggle('is-shampoo', isShampoo)
  experienceApp.classList.toggle('is-glasses', isGlasses)
  shampooLever.setAttribute('aria-hidden', String(!isShampoo))
  shampooLever.tabIndex = isShampoo ? 0 : -1
  experienceEyebrow.innerHTML = `<span class="eyebrow-dot"></span>EXPERIMENT ${isRumbling ? '16' : isForest ? '15' : isGlasses ? '14' : isShampoo ? '13' : isRubber ? '12' : isImpine ? '11' : isShiro ? '10' : isBalloon ? '09' : isWaterTouch ? '08' : '07'}`
  experienceTitle.textContent = isRumbling ? '땅울림' : isForest ? '동물의 숲' : isGlasses ? '안경' : isShampoo ? 'Shampoo' : isRubber ? '고무인간' : isImpine ? '아임피네' : isShiro ? '흰둥이' : isBalloon ? 'Balloon' : isWaterTouch ? 'WaterTouch' : 'Lemonade'
  cameraButton.setAttribute('aria-label', isShiro ? 'Start video recording' : 'Take photo or record video')
  experienceCopy.textContent = isRumbling ? '한강을 따라, 손끝으로 돌려보는 작은 서울.' : isForest
    ? '햇살과 산책, 그리고 나만의 작은 마을.'
    : isGlasses
    ? '안경을 톡 올리고, 눈을 찌푸려 집어 던져보세요.'
    : isShampoo
    ? '엄지와 검지로 거품을 그리고, 레버를 당겨 씻어내세요.'
    : isRubber
    ? '얼굴과 머리를 집어 고무처럼 부드럽게 늘려보세요.'
    : isShiro
    ? '손짓으로 놀아주고 개껌을 던져보세요.'
    : isImpine
      ? '한 장의 사진을 두 번의 순간으로 완성해보세요.'
    : isBalloon
      ? 'Pop with your index finger, or pinch a string and lead it through the air.'
      : isWaterTouch
        ? 'Let every fingertip send a ripple through the camera view.'
        : 'Turn a little squeeze into a whole lot of sunshine.'

  experienceOptions.forEach((option) => {
    const isSelected = option.dataset.experience === experience
    option.classList.toggle('is-active', isSelected)
    option.setAttribute('aria-pressed', String(isSelected))
  })

  if (isImpine) {
    impineRenderer.reset()
    impineFacePoints = null
    setImpineState('READY')
    captureHint.textContent = 'tap to capture the left half'
  } else if (isWaterTouch) {
    waterRipples.length = 0
    lastRippleAt.clear()
    waterRenderer?.activate()
    lastEffectFrameAt = 0
    captureHint.textContent = 'tap for a water photo · hold to record with sound'
    void waterAudio.unlock()
  } else if (isRubber) {
    waterCanvas.classList.remove('is-ready')
    video.classList.remove('is-water-source')
    rubberRenderer?.reset()
    captureHint.textContent = 'tap for a rubber face photo · hold to record'
  } else if (isShampoo) {
    waterCanvas.classList.remove('is-ready')
    video.classList.remove('is-water-source')
    shampooScene.activate()
    captureHint.textContent = 'tap for a foam photo · hold to record'
  } else if (isGlasses) {
    waterCanvas.classList.remove('is-ready')
    video.classList.remove('is-water-source')
    glassesScene.activate()
    captureHint.textContent = 'tap for a glasses photo · hold to record'
  } else {
    waterRipples.length = 0
    lastRippleAt.clear()
    waterCanvas.classList.remove('is-ready')
    video.classList.remove('is-water-source')
    captureHint.textContent = 'tap for a photo · hold to record'
  }
  if (isBalloon) {
    balloonScene.activate(performance.now())
    void waterAudio.unlock()
  }
  if (isShiro) {
    gunGesture = null
    captureHint.textContent = 'tap to start video'
    shiroScene.activate(performance.now())
  }
  updateGuide()
  if (isRumbling) void activateRumbling()
  else if (isForest) void activateForest()
  else void startVisionSession()
}

function restoreImpineWindow() {
  experienceApp.classList.remove('is-impine-minimized')
}

function toggleImpineMinimize() {
  if (experienceApp.classList.contains('is-impine-minimized')) {
    restoreImpineWindow()
    return
  }
  experienceApp.classList.remove('is-impine-maximized')
  experienceApp.classList.add('is-impine-minimized')
}

function toggleImpineMaximize() {
  if (experienceApp.classList.contains('is-impine-minimized')) restoreImpineWindow()
  experienceApp.classList.toggle('is-impine-maximized')
  const isMaximized = experienceApp.classList.contains('is-impine-maximized')
  impineMaximize.setAttribute('aria-label', isMaximized ? 'Restore WebCam' : 'Maximize WebCam')
}

function closeImpineWindow() {
  setExperience(previousExperience)
}

function updateGuide() {
  if (activeExperience === 'glasses') {
    guideCopy.textContent = glassesScene.isFogging
      ? '안경 렌즈에 김이 서리고 있어요…'
      : glassesScene.isSparkling
        ? '김이 걷히고 안경이 반짝여요!'
        : glassesScene.isHolding
          ? '안경을 잡았어요. 손을 움직여 밖으로 던져보세요.'
          : glassesScene.isFlying
            ? '안경이 화면 밖으로 날아가고 있어요.'
            : glassesScene.isBouncing
              ? '안경이 살짝 올라갔다 내려왔어요!'
              : !glassesScene.hasFace
                ? '카메라에 얼굴을 보여주면 안경이 나타나요.'
                : glassesScene.canGrab
                  ? '지금 안경을 엄지·검지로 집어 이동할 수 있어요.'
                  : '검지를 세워 콧등의 6번에서 168번으로 올려보세요 · 눈을 찌푸려 핀치한 뒤 입을 벌려보세요.'
    return
  }
  if (activeExperience === 'shampoo') {
    guideCopy.textContent = shampooScene.error ?? (shampooScene.isRinsing
      ? '샤워 중이에요. 거품이 위에서부터 씻겨 내려갑니다.'
      : !shampooScene.hasValidMask
      ? '카메라에 얼굴과 머리를 보여주면 거품이 나타나요.'
      : !shampooScene.isHandReady
        ? '손 인식을 준비하고 있어요.'
        : shampooScene.isGesturing
          ? '엄지와 검지로 집은 채 움직여 섬세하게 그려보세요.'
          : shampooScene.isWashed
            ? '깨끗이 씻었어요. 다시 핀치하면 새 거품을 그릴 수 있어요.'
            : '얼굴·두피에서 엄지와 검지를 맞대어 그려보세요. 레버를 당기면 씻겨요.')
    return
  }
  if (activeExperience === 'rubber') {
    if (!handModelReady) {
      guideCopy.textContent = '카메라를 허용한 뒤 얼굴이나 머리 위에서 엄지와 검지를 맞대보세요.'
    } else if (rubberWarp?.active) {
      guideCopy.textContent = '핀치를 움직이면 얼굴이 고무처럼 늘어나요.'
    } else if (rubberWarp && rubberWarp.releasedAt !== null) {
      guideCopy.textContent = '톡—얼굴이 탄력 있게 돌아오는 중이에요.'
    } else {
      guideCopy.textContent = '얼굴이나 머리 위에서 엄지와 검지를 맞대고 움직여보세요.'
    }
    return
  }
  if (activeExperience === 'impine') {
    guideCopy.textContent = '왼쪽을 먼저 찍고, 같은 버튼으로 오른쪽을 이어서 찍어보세요.'
    return
  }
  if (activeExperience === 'shiro') {
    if (!handModelReady) {
      guideCopy.textContent = '카메라를 허용한 뒤 손을 화면에 보여주세요.'
    } else if (shiroScene.isBiting(performance.now())) {
      guideCopy.textContent = '와앙! 흰둥이가 개껌을 물었어요.'
    } else if (shiroScene.isFeeding()) {
      guideCopy.textContent = '개껌이 흰둥이에게 날아가고 있어요.'
    } else if (activeGunGesture(performance.now())) {
      guideCopy.textContent = '빵! 흰둥이가 배를 보여줘요.'
    } else if (shiroScene.isFeedArmed()) {
      guideCopy.textContent = '이제 주먹을 활짝 펴서 개껌을 던져보세요.'
    } else {
      guideCopy.textContent = '엄지·검지로 총 쏘기 · 주먹을 쥐었다 펴서 개껌 주기'
    }
    return
  }
  if (activeExperience === 'balloon') {
    guideCopy.textContent = 'Point to pop · pinch a string · touch a balloon to an O-shaped mouth.'
    return
  }
  if (activeExperience === 'watertouch') {
    const fingerCount = activeFingertips(performance.now()).length
    if (!handModelReady) {
      guideCopy.textContent = 'Allow camera access, then show both hands to the camera.'
    } else if (fingerCount >= MAX_FINGERTIPS) {
      guideCopy.textContent = 'All ten fingertips are making waves.'
    } else if (fingerCount > 0) {
      guideCopy.textContent = `Tracking ${fingerCount} fingertip${fingerCount === 1 ? '' : 's'} — move through the water.`
    } else {
      guideCopy.textContent = 'Hold both hands up and move your fingertips through the water.'
    }
    return
  }
  if (!handModelReady) return
  if (isDrinking) {
    guideCopy.textContent = 'Sip the sunshine through the straw.'
  } else if (strawUnlocked) {
    guideCopy.textContent = 'Bring the straw to your mouth to take a sip.'
  } else if (grabbedLemon?.squeezed) {
    guideCopy.textContent = 'Nice squeeze. Catch the drops in your glass.'
  } else if (grabbedLemon) {
    guideCopy.textContent = 'Keep your left fist closed to squeeze the lemon.'
  } else if (rightHand && Date.now() - rightHand.seenAt < HAND_TIMEOUT) {
    guideCopy.textContent = 'Your right palm is carrying the glass.'
  } else {
    guideCopy.textContent = 'Close your left hand near a lemon to grab it.'
  }
}

function updateLemonVisual(lemon: Lemon, now: number) {
  const squeeze = lemon.held ? Math.max(0.62, 1 - (1 - lemon.juice / lemon.maxJuice) * 0.36) : 1
  const alpha = lemon.squeezed ? Math.max(0, 1 - lemon.y / 125) : 1
  const bob = lemon.held || lemon.squeezed ? 0 : Math.sin(now * 0.001 * lemon.drift + lemon.phase) * 1.8
  const scaleX = lemon.held ? 1 + (1 - squeeze) * 0.28 : lemon.squeezed ? 1.08 : 1
  const scaleY = lemon.squeezed ? 0.55 : squeeze

  lemon.element.style.left = `${lemon.x}%`
  lemon.element.style.top = `${lemon.y + bob}%`
  lemon.element.style.width = `${lemon.size}px`
  lemon.element.style.opacity = `${alpha}`
  lemon.element.style.transform = `translate(-50%, -50%) rotate(${lemon.rotation}deg) scale(${scaleX}, ${scaleY})`
  lemon.element.classList.toggle('is-held', lemon.held)
  lemon.element.classList.toggle('is-squeezed', lemon.squeezed)
}

function createJuiceDrop(lemon: Lemon, now: number) {
  if (now - lemon.lastDropAt < 95) return
  lemon.lastDropAt = now
  const drop = document.createElement('span')
  drop.className = 'juice-drop'
  drop.style.left = `${lemon.x}%`
  drop.style.top = `${lemon.y + lemon.size * 0.45}%`
  drop.style.animationDuration = `${500 + Math.random() * 250}ms`
  juiceLayer.append(drop)
  window.setTimeout(() => drop.remove(), 900)
}

function updateCup() {
  const percentage = Math.round(lemonadeFill * 100)
  const cupHeight = cup.clientHeight || 180
  if (lemonadeFill >= 0.98) strawUnlocked = true
  if (lemonadeFill <= 0.005) strawUnlocked = false
  cup.style.setProperty('--fill', `${lemonadeFill}`)
  cup.style.setProperty('--liquid-height', `${13 + Math.max(0, cupHeight - 8) * lemonadeFill}px`)
  cup.style.setProperty('--ice-base', `${(1 - lemonadeFill) * 10}px`)
  cup.style.setProperty('--ice-top', `${(1 - lemonadeFill) * -9}px`)
  meterValue.textContent = `${percentage}%`
  cup.classList.toggle('is-full', lemonadeFill > 0.98)
  cup.classList.toggle('has-straw', strawUnlocked && lemonadeFill > 0.005)
  cup.classList.toggle('is-sipping', isDrinking)
}

function createSipParticle(now: number) {
  if (!mouth || now - lastSipAt < 85) return
  const cupRect = cup.getBoundingClientRect()
  const strawStart = {
    x: cupRect.left + cupRect.width * 0.58,
    y: cupRect.top - 91,
  }
  const particle = document.createElement('span')
  particle.className = 'sip-particle'
  particle.style.left = `${strawStart.x}px`
  particle.style.top = `${strawStart.y}px`
  particle.style.setProperty('--sip-x', `${mouth.x - strawStart.x}px`)
  particle.style.setProperty('--sip-y', `${mouth.y - strawStart.y}px`)
  particle.style.animationDelay = `${Math.random() * 70}ms`
  sipLayer.append(particle)
  lastSipAt = now
  window.setTimeout(() => particle.remove(), 820)
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function grabNearestLemon(hand: HandPoint) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const nearest = lemons
    .filter((lemon) => !lemon.squeezed)
    .map((lemon) => ({
      lemon,
      distance: distance(
        { x: (lemon.x / 100) * viewportWidth, y: (lemon.y / 100) * viewportHeight },
        hand,
      ),
    }))
    .sort((a, b) => a.distance - b.distance)[0]

  if (nearest && nearest.distance < Math.max(130, nearest.lemon.size * 1.65)) {
    grabbedLemon = nearest.lemon
    grabbedLemon.held = true
  }
}

function updateInteraction(now: number, delta: number) {
  const activeLeftHand = leftHand && now - leftHand.seenAt < HAND_TIMEOUT ? leftHand : null
  const activeRightHand = rightHand && now - rightHand.seenAt < HAND_TIMEOUT ? rightHand : null

  if (activeRightHand) {
    cup.style.setProperty('--hand-x', `${activeRightHand.x}px`)
    cup.style.setProperty('--hand-y', `${activeRightHand.y}px`)
    cup.classList.add('is-hand-held')
  } else {
    cup.classList.remove('is-hand-held')
  }

  if (!activeLeftHand?.isFist) {
    if (grabbedLemon) grabbedLemon.held = false
    grabbedLemon = null
    return
  }

  if (!grabbedLemon) grabNearestLemon(activeLeftHand)
  if (!grabbedLemon) return

  grabbedLemon.held = true
  grabbedLemon.x = (activeLeftHand.x / window.innerWidth) * 100
  grabbedLemon.y = (activeLeftHand.y / window.innerHeight) * 100
  const squeezedAmount = Math.min(1, activeLeftHand.strength * 1.45)
  const drain = delta * 0.22 * squeezedAmount
  if (drain > 0 && grabbedLemon.juice > 0) {
    grabbedLemon.juice = Math.max(0, grabbedLemon.juice - drain)
    lemonadeFill = Math.min(1, lemonadeFill + drain * 0.95)
    createJuiceDrop(grabbedLemon, now)
    updateCup()
  }

  if (grabbedLemon.juice <= 0.001) {
    grabbedLemon.juice = 0
    grabbedLemon.held = false
    grabbedLemon.squeezed = true
    grabbedLemon.fallVelocity = 5
    grabbedLemon.element.classList.add('is-squeezed')
    grabbedLemon = null
  }
}

function updateDrinking(now: number, delta: number) {
  if (!strawUnlocked || !mouth || now - mouth.seenAt > 400) {
    if (isDrinking) {
      isDrinking = false
      updateCup()
    }
    return
  }

  const cupRect = cup.getBoundingClientRect()
  const strawPoint = { x: cupRect.left + cupRect.width * 0.58, y: cupRect.top - 91 }
  const mouthIsClose = distance(strawPoint, mouth) < Math.max(112, cupRect.width * 1.45)
  if (!mouthIsClose) {
    if (isDrinking) {
      isDrinking = false
      updateCup()
    }
    return
  }

  isDrinking = true
  lemonadeFill = Math.max(0, lemonadeFill - delta * 0.18)
  createSipParticle(now)
  updateCup()
}

function animate(now: number) {
  const delta = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000))
  lastFrameAt = now
  if (activeExperience === 'lemonade') {
    updateInteraction(now, delta)
    updateDrinking(now, delta)

    lemons.forEach((lemon) => {
      if (lemon.squeezed) {
        lemon.fallVelocity += 11 * delta
        lemon.y += lemon.fallVelocity * delta
        lemon.rotation += 90 * delta
        if (lemon.y > 125) lemon.element.remove()
      }
      updateLemonVisual(lemon, now)
    })
  }
  updateGuide()
  animationFrame = requestAnimationFrame(animate)
}

function landmarkDistance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}

function addWaterRipple(x: number, y: number, energy: number, now: number) {
  waterRipples.unshift({ x, y, bornAt: now, energy })
  if (waterRipples.length > MAX_WATER_RIPPLES) waterRipples.length = MAX_WATER_RIPPLES
  waterAudio.splash(x, energy, now)
}

function activeWaterRipples(now: number) {
  for (let index = waterRipples.length - 1; index >= 0; index -= 1) {
    if (now - waterRipples[index].bornAt > RIPPLE_LIFETIME) waterRipples.splice(index, 1)
  }
  return waterRipples
}

function fistStrength(landmarks: NormalizedLandmark[]) {
  const wrist = landmarks[0]
  const fingerPairs = [[8, 6], [12, 10], [16, 14], [20, 18]]
  const curled = fingerPairs.reduce((count, [tip, pip]) => {
    return count + (landmarkDistance(landmarks[tip], wrist) < landmarkDistance(landmarks[pip], wrist) * 1.12 ? 1 : 0)
  }, 0)
  return { isFist: curled >= 3, strength: curled / fingerPairs.length }
}

function fingerIsExtended(landmarks: NormalizedLandmark[], tipIndex: number, pipIndex: number, mcpIndex: number) {
  const wrist = landmarks[0]
  const tip = landmarks[tipIndex]
  const pip = landmarks[pipIndex]
  const mcp = landmarks[mcpIndex]
  if (!wrist || !tip || !pip || !mcp) return false
  return landmarkDistance(tip, wrist) > landmarkDistance(pip, wrist) * 1.14
    && landmarkDistance(tip, mcp) > landmarkDistance(pip, mcp) * 1.2
}

function isFingerGunGesture(landmarks: NormalizedLandmark[]) {
  const wrist = landmarks[0]
  const thumbTip = landmarks[4]
  const thumbJoint = landmarks[3]
  const indexBase = landmarks[5]
  const middleBase = landmarks[9]
  if (!wrist || !thumbTip || !thumbJoint || !indexBase || !middleBase) return false
  const handScale = Math.max(0.001, landmarkDistance(wrist, middleBase))
  const indexExtended = fingerIsExtended(landmarks, 8, 6, 5)
  const middleFolded = !fingerIsExtended(landmarks, 12, 10, 9)
  const ringFolded = !fingerIsExtended(landmarks, 16, 14, 13)
  const pinkyFolded = !fingerIsExtended(landmarks, 20, 18, 17)
  const thumbExtended = landmarkDistance(thumbTip, indexBase) > handScale * 0.58
    && landmarkDistance(thumbTip, middleBase) > landmarkDistance(thumbJoint, middleBase) * 1.02
  const fingersSeparated = landmarkDistance(thumbTip, landmarks[8]) > handScale * 0.62
  return thumbExtended && indexExtended && middleFolded && ringFolded && pinkyFolded && fingersSeparated
}

function classifyFeedPose(landmarks: NormalizedLandmark[]): FeedHandPoint['feedPose'] {
  if (isFingerGunGesture(landmarks)) return 'gun'
  const indexOpen = fingerIsExtended(landmarks, 8, 6, 5)
  const middleOpen = fingerIsExtended(landmarks, 12, 10, 9)
  const ringOpen = fingerIsExtended(landmarks, 16, 14, 13)
  const pinkyOpen = fingerIsExtended(landmarks, 20, 18, 17)
  if (!indexOpen && !middleOpen && !ringOpen && !pinkyOpen) return 'fist'

  const thumbTip = landmarks[4]
  const thumbJoint = landmarks[3]
  const thumbBase = landmarks[2]
  const indexBase = landmarks[5]
  const pinkyBase = landmarks[17]
  const wrist = landmarks[0]
  const middleBase = landmarks[9]
  if (!thumbTip || !thumbJoint || !thumbBase || !indexBase || !pinkyBase || !wrist || !middleBase) return 'other'
  const handScale = Math.max(0.001, landmarkDistance(wrist, middleBase))
  const thumbOpen = landmarkDistance(thumbTip, thumbBase) > landmarkDistance(thumbJoint, thumbBase) * 1.15
    && landmarkDistance(thumbTip, pinkyBase) > landmarkDistance(thumbJoint, pinkyBase) * 1.04
    && landmarkDistance(thumbTip, indexBase) > handScale * 0.42
  return indexOpen && middleOpen && ringOpen && pinkyOpen && thumbOpen ? 'open' : 'other'
}

function activeGunGesture(now: number) {
  return Boolean(gunGesture?.isActive && now - gunGesture.seenAt <= GUN_GESTURE_TIMEOUT)
}

function activeFeedHands(now: number): FeedHandPoint[] {
  return feedHands.filter((hand) => now - hand.seenAt <= HAND_TIMEOUT)
}

function updateFingertipTrack(key: string, hand: 'left' | 'right', finger: number, x: number, y: number, now: number) {
  const previous = fingertipTracks.get(key)
  const elapsed = previous ? Math.max(0.016, (now - previous.seenAt) / 1000) : 0.016
  const smoothing = activeExperience === 'watertouch' ? 0.72 : 0.58
  const smoothedX = previous ? previous.x + (x - previous.x) * smoothing : x
  const smoothedY = previous ? previous.y + (y - previous.y) * smoothing : y
  const vx = previous ? (smoothedX - previous.x) / elapsed / window.innerWidth : 0
  const vy = previous ? (smoothedY - previous.y) / elapsed / window.innerHeight : 0
  const speed = Math.hypot(vx, vy)
  const isMoving = speed > 0.018
  const energy = Math.min(1.15, 0.52 + speed * 2.4)
  const track: TrackedFingertip = {
    hand,
    finger,
    x: smoothedX,
    y: smoothedY,
    vx: vx * 0.48,
    vy: vy * 0.48,
    pulseAt: isMoving || !previous ? now : previous.pulseAt,
    energy: isMoving || !previous ? energy : previous.energy,
    seenAt: now,
  }
  fingertipTracks.set(key, track)
  const previousRippleAt = lastRippleAt.get(key) ?? 0
  if (activeExperience === 'watertouch' && (!previous || (isMoving && now - previousRippleAt >= RIPPLE_SPAWN_INTERVAL))) {
    addWaterRipple(smoothedX, smoothedY, energy, now)
    lastRippleAt.set(key, now)
  }
}

function processFingertips(result: HandLandmarkerResult, now: number) {
  const detectedKeys = new Set<string>()
  result.landmarks.forEach((landmarks, index) => {
    const handLabel = result.handedness[index]?.[0]?.categoryName?.toLowerCase()
    const userHand = handLabel === 'left' ? 'right' : 'left'
    FINGERTIP_INDICES.forEach((landmarkIndex, fingerIndex) => {
      const tip = landmarks[landmarkIndex]
      if (!tip) return
      const key = `${userHand}-${fingerIndex}`
      detectedKeys.add(key)
      updateFingertipTrack(
        key,
        userHand,
        fingerIndex,
        (1 - tip.x) * window.innerWidth,
        tip.y * window.innerHeight,
        now,
      )
    })
  })

  fingertipTracks.forEach((track, key) => {
    if (!detectedKeys.has(key) && now - track.seenAt > FINGERTIP_TIMEOUT) {
      fingertipTracks.delete(key)
      lastRippleAt.delete(key)
    }
  })
}

function activeFingertips(now: number) {
  return Array.from(fingertipTracks.values())
    .filter((track) => now - track.seenAt <= FINGERTIP_TIMEOUT)
    .sort((a, b) => a.hand.localeCompare(b.hand) || a.finger - b.finger)
}

function updatePinchTrack(hand: 'left' | 'right', landmarks: NormalizedLandmark[], now: number) {
  const thumb = landmarks[4]
  const index = landmarks[8]
  const wrist = landmarks[0]
  const middleBase = landmarks[9]
  if (!thumb || !index || !wrist || !middleBase) return
  const previous = pinchTracks.get(hand)
  const midpoint = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }
  const position = activeExperience === 'rubber'
    ? rubberPoint(midpoint, window.innerWidth, window.innerHeight)
    : { x: (1 - midpoint.x) * window.innerWidth, y: midpoint.y * window.innerHeight }
  const { x, y } = position
  const elapsed = previous ? Math.max(0.016, (now - previous.seenAt) / 1000) : 0.016
  const smoothing = activeExperience === 'rubber' ? 0.86 : 0.72
  const smoothedX = previous ? previous.x + (x - previous.x) * smoothing : x
  const smoothedY = previous ? previous.y + (y - previous.y) * smoothing : y
  const handScale = Math.max(0.001, landmarkDistance(wrist, middleBase))
  pinchTracks.set(hand, {
    hand,
    x: smoothedX,
    y: smoothedY,
    vx: previous ? (smoothedX - previous.x) / elapsed / window.innerWidth : 0,
    vy: previous ? (smoothedY - previous.y) / elapsed / window.innerHeight : 0,
    isPinching: landmarkDistance(thumb, index) < handScale * 0.52,
    seenAt: now,
  })
}

function activePinches(now: number) {
  return Array.from(pinchTracks.values()).filter((pinch) => now - pinch.seenAt <= PINCH_TIMEOUT)
}

function pointInRubberFace(x: number, y: number) {
  if (!rubberFace) return false
  const points = rubberHeadPoints(rubberFace.landmarks, window.innerWidth, window.innerHeight)
  let isInside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index]
    const prior = points[previous]
    const crosses = (current.y > y) !== (prior.y > y)
      && x < (prior.x - current.x) * (y - current.y) / (prior.y - current.y || 0.0001) + current.x
    if (crosses) isInside = !isInside
  }
  return isInside
}

function updateRubberInteraction(now: number) {
  const currentPinches = activePinches(now).filter((pinch) => pinch.isPinching)
  const existing = rubberWarp
  const tracked = existing?.active
    ? currentPinches.find((pinch) => pinch.hand === existing.hand)
    : currentPinches.find((pinch) => pointInRubberFace(pinch.x, pinch.y))

  if (tracked) {
    if (!existing || existing.hand !== tracked.hand || existing.releasedAt !== null) {
      const head = rubberFace ? rubberHeadCenter(rubberFace.landmarks, window.innerWidth, window.innerHeight) : { x: tracked.x, y: tracked.y }
      rubberWarp = {
        hand: tracked.hand,
        anchorX: tracked.x,
        anchorY: tracked.y,
        startX: tracked.x,
        startY: tracked.y,
        headX: head.x,
        headY: head.y,
        x: tracked.x,
        y: tracked.y,
        vx: tracked.vx,
        vy: tracked.vy,
        active: true,
        releasedAt: null,
      }
    } else {
      if (rubberFace && now - rubberFace.seenAt <= RUBBER_FACE_TIMEOUT) {
        const head = rubberHeadCenter(rubberFace.landmarks, window.innerWidth, window.innerHeight)
        existing.anchorX = existing.startX + head.x - existing.headX
        existing.anchorY = existing.startY + head.y - existing.headY
      }
      existing.x = tracked.x
      existing.y = tracked.y
      existing.vx = tracked.vx
      existing.vy = tracked.vy
      existing.active = true
      existing.releasedAt = null
    }
    return
  }

  if (existing?.active) {
    existing.active = false
    existing.releasedAt = now
  }
  if (rubberWarp && rubberWarp.releasedAt !== null && now - rubberWarp.releasedAt > 1250) rubberWarp = null
}

function processHands(result: HandLandmarkerResult, now: number) {
  if (activeExperience === 'glasses') {
    glassesScene.onHands(result, now)
    return
  }
  leftHand = null
  rightHand = null
  feedHands = []
  let gunIsActive = false

  result.landmarks.forEach((landmarks, index) => {
    const palm = landmarks[9]
    if (!palm) return
    const handLabel = result.handedness[index]?.[0]?.categoryName?.toLowerCase()
    // The preview is mirrored, so swap MediaPipe's raw-camera labels for screen/user hands.
    const userHand = handLabel === 'left' ? 'right' : 'left'
    const handPoint = {
      x: (1 - palm.x) * window.innerWidth,
      y: palm.y * window.innerHeight,
      ...fistStrength(landmarks),
      seenAt: now,
    }
    if (userHand === 'left') leftHand = handPoint
    if (userHand === 'right') rightHand = handPoint
    if (activeExperience === 'shiro') {
      const feedPose = classifyFeedPose(landmarks)
      feedHands.push({ ...handPoint, hand: userHand, feedPose })
      if (feedPose === 'gun') gunIsActive = true
    }
    updatePinchTrack(userHand, landmarks, now)
  })
  gunGesture = { isActive: gunIsActive, seenAt: now }
  processFingertips(result, now)
}

function processFace(result: FaceLandmarkerResult, now: number) {
  const landmarks = result.faceLandmarks[0]
  if (activeExperience === 'glasses') {
    glassesScene.onFace(result, now)
    return
  }
  if (activeExperience === 'shampoo') {
    shampooScene.setFace(landmarks ?? null, now)
    return
  }
  if (!landmarks) {
    mouth = null
    impineFacePoints = null
    rubberFace = null
    return
  }
  rubberFace = { landmarks, seenAt: now }

  const eyeCenters = IMPINE_EYE_GROUPS
    .map((group, groupIndex) => {
      const source = group.some((index) => Boolean(landmarks[index])) ? group : IMPINE_EYE_FALLBACK_GROUPS[groupIndex]
      const visible = source.map((index) => landmarks[index]).filter(Boolean)
      if (!visible.length) return null
      return {
        x: visible.reduce((sum, point) => sum + (1 - point.x), 0) / visible.length,
        y: visible.reduce((sum, point) => sum + point.y, 0) / visible.length,
      }
    })
    .filter((point): point is { x: number; y: number } => point !== null)
    .sort((a, b) => a.x - b.x)
  const cheekCenters = IMPINE_CHEEK_GROUPS
    .map((group) => {
      const visible = group.map((index) => landmarks[index]).filter(Boolean)
      if (!visible.length) return null
      return {
        x: visible.reduce((sum, point) => sum + (1 - point.x), 0) / visible.length,
        y: visible.reduce((sum, point) => sum + point.y, 0) / visible.length,
      }
    })
    .filter((point): point is { x: number; y: number } => point !== null)
    .sort((a, b) => a.x - b.x)
  if (eyeCenters.length >= 2 && cheekCenters.length >= 2) {
    const leftEye = eyeCenters[0]
    const rightCheek = cheekCenters[cheekCenters.length - 1]
    if (impineFacePoints) {
      impineFacePoints.leftEyeX = leftEye.x
      impineFacePoints.leftEyeY = leftEye.y
      impineFacePoints.rightCheekX = rightCheek.x
      impineFacePoints.rightCheekY = rightCheek.y
      impineFacePoints.seenAt = now
    } else {
      impineFacePoints = {
        leftEyeX: leftEye.x,
        leftEyeY: leftEye.y,
        rightCheekX: rightCheek.x,
        rightCheekY: rightCheek.y,
        seenAt: now,
      }
    }
  }
  const upperLip = landmarks?.[13]
  const lowerLip = landmarks?.[14]
  const leftCorner = landmarks?.[61]
  const rightCorner = landmarks?.[291]
  if (!upperLip || !lowerLip || !leftCorner || !rightCorner) {
    mouth = null
    return
  }
  const mouthWidth = Math.max(0.001, landmarkDistance(leftCorner, rightCorner))
  const openness = landmarkDistance(upperLip, lowerLip) / mouthWidth
  mouth = {
    x: (1 - (upperLip.x + lowerLip.x) / 2) * window.innerWidth,
    y: ((upperLip.y + lowerLip.y) / 2) * window.innerHeight,
    isRound: openness > 0.24,
    openness,
    seenAt: now,
  }
}

const visionFilesetPromise = FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm')

function stopVisionSession() {
  visionGeneration += 1
  handLandmarker?.close()
  faceLandmarker?.close()
  handLandmarker = null
  faceLandmarker = null
  handModelReady = false
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  video.pause()
  video.srcObject = null
  lastDetectionAt = 0
  lastFaceDetectionAt = 0
  leftHand = null
  rightHand = null
  mouth = null
  fingertipTracks.clear()
  pinchTracks.clear()
}

function startVisionSession() {
  if (resourcesDisposed) return
  const generation = ++visionGeneration
  void startCamera(generation)
  if (activeExperience !== 'impine' && activeExperience !== 'shampoo') void loadHandTracker(generation)
  if (activeExperience === 'lemonade' || activeExperience === 'balloon' || activeExperience === 'impine' || activeExperience === 'rubber' || activeExperience === 'shampoo' || activeExperience === 'glasses') {
    void loadFaceTracker(generation)
  }
}

async function loadHandTracker(generation: number) {
  try {
    const vision = await visionFilesetPromise
    if (generation !== visionGeneration) return
    let created: HandLandmarker
    try {
      created = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: assetUrl('/models/hand_landmarker.task'), delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      })
    } catch {
      created = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: assetUrl('/models/hand_landmarker.task'), delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      })
    }
    if (generation !== visionGeneration) {
      created.close()
      return
    }
    handLandmarker = created
    handModelReady = true
    setStatus('Hands ready', false)
  } catch (error) {
    if (generation !== visionGeneration) return
    console.error('MediaPipe hand tracker could not load.', error)
    setStatus('Hand tracking could not load. Check your connection and reload.')
  }
}

async function loadFaceTracker(generation: number) {
  try {
    const vision = await visionFilesetPromise
    if (generation !== visionGeneration) return
    const outputFaceBlendshapes = activeExperience === 'glasses'
    let created: FaceLandmarker
    try {
      created = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: assetUrl('/models/face_landmarker.task'), delegate: 'GPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes, minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      })
    } catch {
      created = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: assetUrl('/models/face_landmarker.task'), delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes, minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      })
    }
    if (generation !== visionGeneration) {
      created.close()
      return
    }
    faceLandmarker = created
  } catch (error) {
    if (generation !== visionGeneration) return
    console.error('MediaPipe face tracker could not load.', error)
    setStatus(activeExperience === 'glasses'
      ? 'Face tracking could not load. Glasses are unavailable.'
      : 'Mouth tracking could not load. Straw sipping is unavailable.')
  }
}

async function startCamera(generation: number) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera access is not available in this browser.')
    return
  }
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    })
    if (generation !== visionGeneration) {
      acquired.getTracks().forEach((track) => track.stop())
      return
    }
    stream = acquired
    video.srcObject = acquired
    await video.play()
    if (generation !== visionGeneration) return
    setStatus('Camera ready', false)
  } catch (error) {
    if (generation !== visionGeneration) return
    console.error('Camera permission or device error.', error)
    setStatus('Camera access is needed for this experience.')
  }
}

function detectHands(now: number) {
  if (!handLandmarker || !video.videoWidth || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  const interval = activeExperience === 'watertouch' || activeExperience === 'balloon'
    ? WATER_DETECTION_INTERVAL
    : DETECTION_INTERVAL
  if (now - lastDetectionAt < interval) return
  lastDetectionAt = now
  try {
    processHands(handLandmarker.detectForVideo(video, now), now)
  } catch (error) {
    console.warn('Hand detection frame skipped.', error)
  }
}

function detectFace(now: number) {
  if (!faceLandmarker || !video.videoWidth || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  if (now - lastFaceDetectionAt < FACE_DETECTION_INTERVAL) return
  lastFaceDetectionAt = now
  try {
    processFace(faceLandmarker.detectForVideo(video, now), now)
  } catch (error) {
    console.warn('Face detection frame skipped.', error)
  }
}

function renderLoop(now: number) {
  if (activeExperience === 'rumbling') {
    rumblingScene?.render(now)
    detectionFrame = requestAnimationFrame(renderLoop)
    return
  }
  if (activeExperience === 'forest') {
    forestScene?.render(now)
    detectionFrame = requestAnimationFrame(renderLoop)
    return
  }
  if (activeExperience !== 'impine' && activeExperience !== 'shampoo') detectHands(now)
  if (activeExperience === 'lemonade') {
    detectFace(now)
  } else if (activeExperience === 'watertouch') {
    if (now - lastEffectFrameAt >= EFFECT_FRAME_INTERVAL) {
      const fingers = activeFingertips(now)
      const ripples = activeWaterRipples(now)
      waterRenderer?.render(video, fingers, ripples, now)
      rippleOverlay.render(video, fingers, ripples, now, !waterRenderer)
      if (isRecording && now - lastRecordedFrameAt >= EFFECT_FRAME_INTERVAL) {
        drawWaterCaptureFrame()
        lastRecordedFrameAt = now
      }
      lastEffectFrameAt = now
    }
  } else if (activeExperience === 'balloon') {
    detectFace(now)
    const indexFingers = activeFingertips(now).filter((finger) => finger.finger === 1)
    balloonScene.render(now, indexFingers, activePinches(now), mouth)
    if (isRecording && now - lastRecordedFrameAt >= 1000 / 30) {
      drawBalloonCaptureFrame()
      lastRecordedFrameAt = now
    }
  } else if (activeExperience === 'impine') {
    if (!impineRenderer.isComplete) detectFace(now)
    impineRenderer.render(impineFacePoints)
  } else if (activeExperience === 'rubber') {
    detectFace(now)
    updateRubberInteraction(now)
    rubberRenderer?.render(rubberFace, rubberWarp, now)
    if (isRecording && now - lastRecordedFrameAt >= RUBBER_FRAME_INTERVAL) {
      drawRubberCaptureFrame(now)
      lastRecordedFrameAt = now
    }
  } else if (activeExperience === 'shampoo') {
    detectFace(now)
    shampooScene.render(now)
    if (isRecording && now - lastRecordedFrameAt >= 1000 / 30) {
      drawShampooCaptureFrame(now)
      lastRecordedFrameAt = now
    }
  } else if (activeExperience === 'glasses') {
    detectFace(now)
    glassesScene.render(now)
    if (isRecording && now - lastRecordedFrameAt >= 1000 / 30) {
      drawGlassesCaptureFrame()
      lastRecordedFrameAt = now
    }
  } else {
    shiroScene.render(now, activeGunGesture(now), activeFeedHands(now))
    if (isRecording && now - lastRecordedFrameAt >= SHIRO_FRAME_INTERVAL) {
      drawShiroCaptureFrame(now)
      lastRecordedFrameAt = now
    }
  }
  detectionFrame = requestAnimationFrame(renderLoop)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function drawMirroredVideoCover(context: CanvasRenderingContext2D, width: number, height: number) {
  if (!video.videoWidth || !video.videoHeight) return
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
  const drawWidth = video.videoWidth * scale
  const drawHeight = video.videoHeight * scale
  const drawX = (width - drawWidth) / 2
  const drawY = (height - drawHeight) / 2
  context.save()
  context.translate(width, 0)
  context.scale(-1, 1)
  context.drawImage(video, drawX, drawY, drawWidth, drawHeight)
  context.restore()
}

const RUBBER_FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]
const RUBBER_CHEEK_GROUPS = [
  [50, 101, 118, 147, 187, 205],
  [280, 330, 347, 376, 411, 425],
]

function rubberPoint(point: { x: number; y: number }, width: number, height: number) {
  if (!video.videoWidth || !video.videoHeight) return { x: (1 - point.x) * width, y: point.y * height }
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
  const imageWidth = video.videoWidth * scale
  const imageHeight = video.videoHeight * scale
  return {
    x: width * 0.5 + (0.5 - point.x) * imageWidth,
    y: height * 0.5 + (point.y - 0.5) * imageHeight,
  }
}

function rubberHeadCenter(landmarks: NormalizedLandmark[], width: number, height: number) {
  const left = rubberPoint(landmarks[234], width, height)
  const right = rubberPoint(landmarks[454], width, height)
  const forehead = rubberPoint(landmarks[10], width, height)
  const chin = rubberPoint(landmarks[152], width, height)
  return { x: (left.x + right.x) * 0.5, y: (forehead.y + chin.y) * 0.5 }
}

function rubberHeadPoints(landmarks: NormalizedLandmark[], width: number, height: number) {
  if (![10, 33, 152, 234, 263, 454].every((index) => Boolean(landmarks[index]))) return []
  const forehead = rubberPoint(landmarks[10], width, height)
  const chin = rubberPoint(landmarks[152], width, height)
  const left = rubberPoint(landmarks[234], width, height)
  const right = rubberPoint(landmarks[454], width, height)
  const eyeA = rubberPoint(landmarks[33], width, height)
  const eyeB = rubberPoint(landmarks[263], width, height)
  const eyeY = (eyeA.y + eyeB.y) * 0.5
  const headHeight = Math.max(1, Math.abs(chin.y - forehead.y))
  const headWidth = Math.max(1, Math.abs(right.x - left.x))
  const centerX = (left.x + right.x) * 0.5
  const topLift = Math.min(headHeight * 0.36, headWidth * 0.4)
  const topSpan = Math.max(1, eyeY - forehead.y)

  return RUBBER_FACE_OVAL
    .map((index) => landmarks[index])
    .filter((point): point is NormalizedLandmark => Boolean(point))
    .map((landmark) => {
      const point = rubberPoint(landmark, width, height)
      const upper = Math.max(0, Math.min(1, (eyeY - point.y) / topSpan))
      const side = Math.min(1, Math.abs(point.x - centerX) / (headWidth * 0.5))
      const sideInfluence = Math.max(0, Math.min(1, (eyeY + headHeight * 0.12 - point.y) / (topSpan + headHeight * 0.12)))
      return {
        x: point.x + Math.sign(point.x - centerX) * headWidth * 0.09 * sideInfluence * side,
        y: point.y - topLift * upper,
      }
    })
}

function rubberFacePath(context: CanvasRenderingContext2D, points: { x: number; y: number }[]) {
  if (points.length < 3) return
  context.beginPath()
  const firstMidpoint = {
    x: (points[points.length - 1].x + points[0].x) * 0.5,
    y: (points[points.length - 1].y + points[0].y) * 0.5,
  }
  context.moveTo(firstMidpoint.x, firstMidpoint.y)
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    const midpoint = { x: (point.x + next.x) * 0.5, y: (point.y + next.y) * 0.5 }
    context.quadraticCurveTo(point.x, point.y, midpoint.x, midpoint.y)
  })
  context.closePath()
}

class RubberFaceRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly sourceCanvas = document.createElement('canvas')
  private readonly sourceContext: CanvasRenderingContext2D
  private readonly headCanvas = document.createElement('canvas')
  private readonly headContext: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private pixelRatio = 1
  private lastFrameAt = 0
  private lastColorAt = 0
  private leftColor = 'rgb(190, 145, 126)'
  private rightColor = 'rgb(190, 145, 126)'

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    const sourceContext = this.sourceCanvas.getContext('2d', { alpha: false })
    const headContext = this.headCanvas.getContext('2d')
    if (!context || !sourceContext || !headContext) throw new Error('Could not create the rubber face renderer.')
    this.canvas = canvas
    this.context = context
    this.sourceContext = sourceContext
    this.headContext = headContext
    this.context.imageSmoothingEnabled = true
    this.sourceContext.imageSmoothingEnabled = true
    this.headContext.imageSmoothingEnabled = true
  }

  reset() {
    this.lastFrameAt = 0
    this.canvas.classList.remove('is-ready')
    this.context.clearRect(0, 0, this.width, this.height)
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const cappedRatio = Math.min(retinaPixelRatio(width, height), 2)
    const pixelWidth = Math.max(1, Math.round(width * cappedRatio))
    const pixelHeight = Math.max(1, Math.round(height * cappedRatio))
    if (pixelWidth === this.width && pixelHeight === this.height) return
    this.width = pixelWidth
    this.height = pixelHeight
    this.pixelRatio = cappedRatio
    this.canvas.width = pixelWidth
    this.canvas.height = pixelHeight
    this.sourceCanvas.width = pixelWidth
    this.sourceCanvas.height = pixelHeight
    this.headCanvas.width = pixelWidth
    this.headCanvas.height = pixelHeight
  }

  private sampleColor(landmarks: NormalizedLandmark[], group: number[]) {
    const samples = group.map((index) => landmarks[index]).filter(Boolean)
    if (!samples.length) return this.leftColor
    let red = 0
    let green = 0
    let blue = 0
    let count = 0
    const radius = Math.max(2, Math.round(3 * this.pixelRatio))
    samples.forEach((landmark) => {
      const point = rubberPoint(landmark, this.width, this.height)
      const x = Math.max(0, Math.min(this.width - 1, Math.round(point.x)))
      const y = Math.max(0, Math.min(this.height - 1, Math.round(point.y)))
      const size = radius * 2 + 1
      const image = this.sourceContext.getImageData(
        Math.max(0, x - radius),
        Math.max(0, y - radius),
        Math.min(size, this.width - Math.max(0, x - radius)),
        Math.min(size, this.height - Math.max(0, y - radius)),
      ).data
      for (let index = 0; index < image.length; index += 4) {
        red += image[index]
        green += image[index + 1]
        blue += image[index + 2]
        count += 1
      }
    })
    if (!count) return this.leftColor
    return `rgb(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)})`
  }

  private updateCheekColors(landmarks: NormalizedLandmark[], now: number) {
    if (now - this.lastColorAt < 180) return
    this.leftColor = this.sampleColor(landmarks, RUBBER_CHEEK_GROUPS[0])
    this.rightColor = this.sampleColor(landmarks, RUBBER_CHEEK_GROUPS[1])
    this.lastColorAt = now
  }

  private drawFaceMask(points: { x: number; y: number }[]) {
    rubberFacePath(this.context, points)
    this.context.save()
    this.context.clip()
    const bounds = points.reduce((current, point) => ({
      minX: Math.min(current.minX, point.x),
      maxX: Math.max(current.maxX, point.x),
      minY: Math.min(current.minY, point.y),
      maxY: Math.max(current.maxY, point.y),
    }), { minX: this.width, maxX: 0, minY: this.height, maxY: 0 })
    const gradient = this.context.createLinearGradient(bounds.minX, 0, bounds.maxX, 0)
    gradient.addColorStop(0, this.leftColor)
    gradient.addColorStop(0.5, this.leftColor)
    gradient.addColorStop(1, this.rightColor)
    this.context.fillStyle = gradient
    this.context.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    this.context.restore()
  }

  private drawHeadTexture(points: { x: number; y: number }[]) {
    const context = this.headContext
    context.clearRect(0, 0, this.width, this.height)
    context.save()
    rubberFacePath(context, points)
    context.clip()
    context.drawImage(this.sourceCanvas, 0, 0)
    context.restore()
  }

  private drawTriangle(
    source: { x: number; y: number }[],
    destination: { x: number; y: number }[],
  ) {
    const sourceX = source[1].x - source[0].x
    const sourceY = source[1].y - source[0].y
    const sourceX2 = source[2].x - source[0].x
    const sourceY2 = source[2].y - source[0].y
    const determinant = sourceX * sourceY2 - sourceX2 * sourceY
    if (Math.abs(determinant) < 0.01) return
    const destinationX = destination[1].x - destination[0].x
    const destinationY = destination[1].y - destination[0].y
    const destinationX2 = destination[2].x - destination[0].x
    const destinationY2 = destination[2].y - destination[0].y
    const a = (destinationX * sourceY2 - destinationX2 * sourceY) / determinant
    const c = (-destinationX * sourceX2 + destinationX2 * sourceX) / determinant
    const b = (destinationY * sourceY2 - destinationY2 * sourceY) / determinant
    const d = (-destinationY * sourceX2 + destinationY2 * sourceX) / determinant
    const e = destination[0].x - a * source[0].x - c * source[0].y
    const f = destination[0].y - b * source[0].x - d * source[0].y
    const minX = Math.min(source[0].x, source[1].x, source[2].x)
    const minY = Math.min(source[0].y, source[1].y, source[2].y)
    const maxX = Math.max(source[0].x, source[1].x, source[2].x)
    const maxY = Math.max(source[0].y, source[1].y, source[2].y)

    const centerX = (destination[0].x + destination[1].x + destination[2].x) / 3
    const centerY = (destination[0].y + destination[1].y + destination[2].y) / 3
    const seamOverlap = Math.max(0.6, this.pixelRatio * 0.45)
    const expanded = destination.map((point) => {
      const dx = point.x - centerX
      const dy = point.y - centerY
      const length = Math.max(0.001, Math.hypot(dx, dy))
      return { x: point.x + dx / length * seamOverlap, y: point.y + dy / length * seamOverlap }
    })

    this.context.save()
    this.context.beginPath()
    this.context.moveTo(expanded[0].x, expanded[0].y)
    this.context.lineTo(expanded[1].x, expanded[1].y)
    this.context.lineTo(expanded[2].x, expanded[2].y)
    this.context.closePath()
    this.context.clip()
    this.context.setTransform(a, b, c, d, e, f)
    this.context.drawImage(this.headCanvas, minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY), minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY))
    this.context.restore()
  }

  private drawWarp(points: { x: number; y: number }[], warp: RubberWarp, now: number) {
    const bounds = points.reduce((current, point) => ({
      minX: Math.min(current.minX, point.x),
      maxX: Math.max(current.maxX, point.x),
      minY: Math.min(current.minY, point.y),
      maxY: Math.max(current.maxY, point.y),
    }), { minX: this.width, maxX: 0, minY: this.height, maxY: 0 })
    const elapsed = warp.releasedAt === null ? 0 : Math.max(0, (now - warp.releasedAt) / 1000)
    const spring = warp.releasedAt === null ? 1 : Math.exp(-elapsed * 5.1) * Math.cos(elapsed * 17.5)
    const scaleX = this.width / Math.max(1, window.innerWidth)
    const scaleY = this.height / Math.max(1, window.innerHeight)
    const anchorX = warp.anchorX * scaleX
    const anchorY = warp.anchorY * scaleY
    const deltaX = (warp.x - warp.anchorX) * scaleX * spring
    const deltaY = (warp.y - warp.anchorY) * scaleY * spring
    const displacement = Math.hypot(deltaX, deltaY)
    const radius = Math.max(115 * this.pixelRatio, (bounds.maxX - bounds.minX) * 0.48, displacement * 0.95)
    const columns = 12
    const rows = 16
    const sourcePoints: { x: number; y: number }[][] = []
    const destinationPoints: { x: number; y: number }[][] = []
    for (let row = 0; row <= rows; row += 1) {
      const sourceRow: { x: number; y: number }[] = []
      const destinationRow: { x: number; y: number }[] = []
      for (let column = 0; column <= columns; column += 1) {
        const x = bounds.minX + (bounds.maxX - bounds.minX) * column / columns
        const y = bounds.minY + (bounds.maxY - bounds.minY) * row / rows
        const distanceToAnchor = Math.hypot(x - anchorX, y - anchorY)
        const influence = Math.exp(-(distanceToAnchor * distanceToAnchor) / (radius * radius))
        sourceRow.push({ x, y })
        destinationRow.push({ x: x + deltaX * influence, y: y + deltaY * influence })
      }
      sourcePoints.push(sourceRow)
      destinationPoints.push(destinationRow)
    }

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const sourceTopLeft = sourcePoints[row][column]
        const sourceTopRight = sourcePoints[row][column + 1]
        const sourceBottomLeft = sourcePoints[row + 1][column]
        const sourceBottomRight = sourcePoints[row + 1][column + 1]
        const destinationTopLeft = destinationPoints[row][column]
        const destinationTopRight = destinationPoints[row][column + 1]
        const destinationBottomLeft = destinationPoints[row + 1][column]
        const destinationBottomRight = destinationPoints[row + 1][column + 1]
        this.drawTriangle(
          [sourceTopLeft, sourceTopRight, sourceBottomLeft],
          [destinationTopLeft, destinationTopRight, destinationBottomLeft],
        )
        this.drawTriangle(
          [sourceTopRight, sourceBottomRight, sourceBottomLeft],
          [destinationTopRight, destinationBottomRight, destinationBottomLeft],
        )
      }
    }
  }

  render(face: RubberFaceState | null, warp: RubberWarp | null, now: number, force = false) {
    if (!video.videoWidth || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !face || now - face.seenAt > RUBBER_FACE_TIMEOUT || !warp) {
      this.canvas.classList.remove('is-ready')
      return
    }
    if (!force && now - this.lastFrameAt < RUBBER_FRAME_INTERVAL) return
    this.lastFrameAt = now
    this.resize()
    this.sourceContext.clearRect(0, 0, this.width, this.height)
    drawMirroredVideoCover(this.sourceContext, this.width, this.height)
    this.context.clearRect(0, 0, this.width, this.height)
    const points = rubberHeadPoints(face.landmarks, this.width, this.height)
    if (points.length < 3) {
      this.canvas.classList.remove('is-ready')
      return
    }
    this.updateCheekColors(face.landmarks, now)
    this.drawFaceMask(points)
    this.drawHeadTexture(points)
    this.drawWarp(points, warp, now)
    this.canvas.classList.add('is-ready')
  }
}

class ImpineRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly stage: HTMLElement
  private readonly context: CanvasRenderingContext2D
  private readonly leftSnapshot = document.createElement('canvas')
  private readonly rightSnapshot = document.createElement('canvas')
  private readonly subtitleImage = new Image()
  private readonly effectImage = new Image()
  private width = 0
  private height = 0
  private phase: 'ready' | 'left-fixed' | 'complete' = 'ready'

  constructor(canvas: HTMLCanvasElement, stage: HTMLElement) {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Could not create the split camera canvas.')
    this.canvas = canvas
    this.stage = stage
    this.context = context
    // The public filename is stored as decomposed Korean Unicode on macOS.
    this.subtitleImage.src = assetUrl('/%E1%84%8C%E1%85%A1%E1%84%86%E1%85%A1%E1%86%A8.png')
    this.effectImage.src = assetUrl('/%E1%84%92%E1%85%AD%E1%84%80%E1%85%AA.png')
  }

  get isComplete() {
    return this.phase === 'complete'
  }

  get isLeftFixed() {
    return this.phase === 'left-fixed'
  }

  reset() {
    this.phase = 'ready'
    this.leftSnapshot.width = 0
    this.leftSnapshot.height = 0
    this.rightSnapshot.width = 0
    this.rightSnapshot.height = 0
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private resize() {
    const rect = this.stage.getBoundingClientRect()
    const cssSize = Math.max(1, Math.min(rect.width, rect.height))
    const pixelRatio = retinaPixelRatio(cssSize, cssSize)
    const width = Math.max(1, Math.round(cssSize * pixelRatio))
    if (width === this.width && width === this.height) return
    this.resizeSnapshot(this.leftSnapshot, Math.max(1, Math.floor(width / 2)), width)
    this.resizeSnapshot(this.rightSnapshot, Math.max(1, Math.floor(width / 2)), width)
    this.width = width
    this.height = width
    this.canvas.width = width
    this.canvas.height = width
    this.context.imageSmoothingEnabled = true
  }

  private resizeSnapshot(canvas: HTMLCanvasElement, width: number, height: number) {
    if (!canvas.width || !canvas.height) return
    if (canvas.width === width && canvas.height === height) return
    const previous = document.createElement('canvas')
    previous.width = canvas.width
    previous.height = canvas.height
    previous.getContext('2d')!.drawImage(canvas, 0, 0)
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, width, height)
  }

  private prepareSnapshot(canvas: HTMLCanvasElement) {
    const halfWidth = Math.max(1, Math.floor(this.width / 2))
    if (canvas.width !== halfWidth || canvas.height !== this.height) {
      canvas.width = halfWidth
      canvas.height = this.height
    }
  }

  private drawVideoHalf(left: boolean) {
    const { context, width, height } = this
    const halfWidth = width / 2
    context.save()
    context.beginPath()
    context.rect(left ? 0 : halfWidth, 0, halfWidth, height)
    context.clip()
    context.filter = left ? 'grayscale(1)' : 'none'
    drawMirroredVideoCover(context, width, height)
    context.restore()
  }

  private drawTear(facePoints: ImpineFacePoints | null, now: number) {
    if (!facePoints || !this.effectImage.complete || !this.effectImage.naturalWidth) return
    const { context, width, height } = this
    const x = facePoints.leftEyeX * width
    const eyeY = facePoints.leftEyeY * height
    const effectSize = Math.max(120, width * 0.42)
    // The tear artwork has transparent padding on its left, so anchor its
    // visible drop slightly left of the tracked eye center.
    const effectX = x - effectSize * 0.6
    const effectY = eyeY - effectSize * 0.19 + Math.sin(now * 0.004) * 2

    context.save()
    context.beginPath()
    context.rect(0, 0, width / 2, height)
    context.clip()
    context.globalAlpha = 0.9
    context.drawImage(this.effectImage, 0, 0, 887, 887, effectX, effectY, effectSize, effectSize)
    context.beginPath()
    const dropCycle = (now % 1850) / 1850
    const dropProgress = dropCycle < 0.78 ? dropCycle / 0.78 : -1
    if (dropProgress >= 0) {
      const dropX = x + Math.sin(now * 0.003) * width * 0.008
      const dropY = eyeY + effectSize * (0.48 + dropProgress * 0.33)
      const dropRadius = Math.max(4, width * 0.014) * (1 - dropProgress * 0.28)
      context.moveTo(dropX, dropY - dropRadius * 1.9)
      context.bezierCurveTo(dropX - dropRadius * 1.2, dropY - dropRadius * .45, dropX - dropRadius, dropY + dropRadius, dropX, dropY + dropRadius)
      context.bezierCurveTo(dropX + dropRadius, dropY + dropRadius, dropX + dropRadius * 1.2, dropY - dropRadius * .45, dropX, dropY - dropRadius * 1.9)
      context.fillStyle = `rgba(175,225,243,${0.56 * (1 - dropProgress * 0.45)})`
      context.fill()
    }
    context.restore()
  }

  private drawBlush(facePoints: ImpineFacePoints | null, now: number) {
    if (!facePoints || !this.effectImage.complete || !this.effectImage.naturalWidth) return
    const { context, width, height } = this
    const x = facePoints.rightCheekX * width
    const y = facePoints.rightCheekY * height
    const pulse = 1 + Math.sin(now * 0.0045) * 0.035
    const effectSize = Math.max(130, width * 0.39) * pulse

    context.save()
    context.beginPath()
    context.rect(width / 2, 0, width / 2, height)
    context.clip()
    context.globalAlpha = 0.76 + Math.sin(now * 0.0045) * 0.08
    // Move the visible blush away from the nose while keeping its tracked
    // face-relative scale and blur unchanged.
    context.drawImage(this.effectImage, 887, 0, 887, 887, x - effectSize * 0.42, y - effectSize * 0.53, effectSize, effectSize)
    context.restore()
  }

  private drawSubtitle() {
    if (!this.subtitleImage.complete || !this.subtitleImage.naturalWidth) return
    const { context, width, height } = this
    // The supplied asset is one transparent title. Clip that one source at the
    // exact center so the typography never becomes two independently laid-out texts.
    const subtitleY = height * 0.34
    context.save()
    context.beginPath()
    context.rect(0, 0, width / 2, height)
    context.clip()
    context.drawImage(this.subtitleImage, 0, subtitleY, width, width)
    context.restore()
    context.save()
    context.beginPath()
    context.rect(width / 2, 0, width / 2, height)
    context.clip()
    context.drawImage(this.subtitleImage, 0, subtitleY, width, width)
    context.restore()
  }

  render(facePoints: ImpineFacePoints | null, includeSubtitle = true, now = performance.now()) {
    if (!video.videoWidth || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    this.resize()
    const { context, width, height } = this
    const halfWidth = width / 2
    context.clearRect(0, 0, width, height)

    if (this.phase === 'ready') {
      this.drawVideoHalf(true)
    } else {
      this.prepareSnapshot(this.leftSnapshot)
      context.drawImage(this.leftSnapshot, 0, 0, halfWidth, height)
    }

    if (this.phase === 'complete') {
      this.prepareSnapshot(this.rightSnapshot)
      context.drawImage(this.rightSnapshot, halfWidth, 0, halfWidth, height)
    } else {
      this.drawVideoHalf(false)
    }

    if (this.phase === 'ready') this.drawTear(facePoints, now)
    if (this.phase !== 'complete') this.drawBlush(facePoints, now)

    context.save()
    context.fillStyle = 'rgba(255,255,255,.22)'
    context.fillRect(Math.floor(halfWidth) - 0.5, 0, 1, height)
    context.restore()
    if (includeSubtitle) this.drawSubtitle()
  }

  captureLeft(facePoints: ImpineFacePoints | null, now = performance.now()) {
    this.render(facePoints, false, now)
    this.prepareSnapshot(this.leftSnapshot)
    this.leftSnapshot.getContext('2d')!.drawImage(this.canvas, 0, 0, this.width / 2, this.height, 0, 0, this.leftSnapshot.width, this.leftSnapshot.height)
    this.phase = 'left-fixed'
    this.render(facePoints, true, now)
  }

  captureRight(facePoints: ImpineFacePoints | null, now = performance.now()) {
    this.render(facePoints, false, now)
    this.prepareSnapshot(this.rightSnapshot)
    this.rightSnapshot.getContext('2d')!.drawImage(this.canvas, this.width / 2, 0, this.width / 2, this.height, 0, 0, this.rightSnapshot.width, this.rightSnapshot.height)
    this.phase = 'complete'
    this.render(facePoints, true, now)
  }

  copyTo(target: HTMLCanvasElement) {
    if (target.width !== this.width || target.height !== this.height) {
      target.width = this.width
      target.height = this.height
    }
    const targetContext = target.getContext('2d')!
    targetContext.clearRect(0, 0, this.width, this.height)
    targetContext.drawImage(this.canvas, 0, 0)
  }
}

function prepareWaterCaptureCanvas() {
  const width = waterCanvas.width || rippleCanvas.width || Math.max(1, Math.round(window.innerWidth))
  const height = waterCanvas.height || rippleCanvas.height || Math.max(1, Math.round(window.innerHeight))
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width
    captureCanvas.height = height
  }
}

function drawWaterCaptureFrame() {
  prepareWaterCaptureCanvas()
  const context = captureCanvas.getContext('2d')!
  const width = captureCanvas.width
  const height = captureCanvas.height
  context.clearRect(0, 0, width, height)
  if (waterCanvas.classList.contains('is-ready')) {
    context.drawImage(waterCanvas, 0, 0, width, height)
  } else {
    drawMirroredVideoCover(context, width, height)
  }
  context.drawImage(rippleCanvas, 0, 0, width, height)
}

function drawRubberCaptureFrame(now = performance.now(), refreshEffect = false) {
  if (refreshEffect) rubberRenderer?.render(rubberFace, rubberWarp, now, true)
  const pixelRatio = retinaPixelRatio(window.innerWidth, window.innerHeight)
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio))
  const height = Math.max(1, Math.round(window.innerHeight * pixelRatio))
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width
    captureCanvas.height = height
  }
  const context = captureCanvas.getContext('2d')!
  context.clearRect(0, 0, width, height)
  drawMirroredVideoCover(context, width, height)
  if (rubberCanvas.classList.contains('is-ready')) context.drawImage(rubberCanvas, 0, 0, width, height)
}

function drawShampooCaptureFrame(now = performance.now(), refreshEffect = false) {
  if (refreshEffect) shampooScene.render(now, true)
  const pixelRatio = retinaPixelRatio(window.innerWidth, window.innerHeight)
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio))
  const height = Math.max(1, Math.round(window.innerHeight * pixelRatio))
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width
    captureCanvas.height = height
  }
  const context = captureCanvas.getContext('2d')!
  context.clearRect(0, 0, width, height)
  drawMirroredVideoCover(context, width, height)
  shampooScene.drawCapture(context, width, height)
}

function drawGlassesCaptureFrame(now = performance.now(), refreshEffect = false) {
  if (refreshEffect) glassesScene.render(now, true)
  const pixelRatio = retinaPixelRatio(window.innerWidth, window.innerHeight)
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio))
  const height = Math.max(1, Math.round(window.innerHeight * pixelRatio))
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width
    captureCanvas.height = height
  }
  const context = captureCanvas.getContext('2d')!
  context.clearRect(0, 0, width, height)
  drawMirroredVideoCover(context, width, height)
  glassesScene.drawCapture(context, width, height)
}

function drawBalloonCaptureFrame() {
  const width = balloonCanvas.width || Math.max(1, Math.round(window.innerWidth))
  const height = balloonCanvas.height || Math.max(1, Math.round(window.innerHeight))
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width
    captureCanvas.height = height
  }
  const context = captureCanvas.getContext('2d')!
  context.clearRect(0, 0, width, height)
  drawMirroredVideoCover(context, width, height)
  context.drawImage(balloonCanvas, 0, 0, width, height)
}

function drawShiroCaptureFrame(now = performance.now()) {
  const pixelRatio = retinaPixelRatio(window.innerWidth, window.innerHeight)
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio))
  const height = Math.max(1, Math.round(window.innerHeight * pixelRatio))
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width
    captureCanvas.height = height
  }
  const context = captureCanvas.getContext('2d')!
  context.clearRect(0, 0, width, height)
  drawMirroredVideoCover(context, width, height)
  shiroScene.drawCapture(context, width, height, now)
}

function takePhoto() {
  if (!video.videoWidth) {
    setStatus('Start the camera before taking a photo.')
    return
  }
  if (activeExperience === 'impine') {
    if (!impineRenderer.isLeftFixed && !impineRenderer.isComplete) {
      impineRenderer.captureLeft(impineFacePoints)
      setImpineState('LEFT CAPTURED')
      captureHint.textContent = 'tap to capture the right half'
      setStatus('Left half captured — take the right half')
      window.setTimeout(() => setStatus('', false), 1800)
      return
    }
    if (impineRenderer.isLeftFixed) {
      impineRenderer.captureRight(impineFacePoints)
      setImpineState('COMPLETE')
      impineRenderer.copyTo(captureCanvas)
      captureCanvas.toBlob((blob) => {
        if (!blob) return
        downloadBlob(blob, `impine-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
        setStatus('Photo saved')
        captureHint.textContent = 'tap to start over'
        window.setTimeout(() => setStatus('', false), 1500)
      }, 'image/jpeg', 0.92)
      return
    }
    impineRenderer.reset()
    impineFacePoints = null
    setImpineState('READY')
    captureHint.textContent = 'tap to capture the left half'
    setStatus('Ready for a new split portrait')
    window.setTimeout(() => setStatus('', false), 1400)
  } else if (activeExperience === 'watertouch') {
    const now = performance.now()
    const fingers = activeFingertips(now)
    const ripples = activeWaterRipples(now)
    waterRenderer?.render(video, fingers, ripples, now)
    rippleOverlay.render(video, fingers, ripples, now, !waterRenderer)
    drawWaterCaptureFrame()
  } else if (activeExperience === 'balloon') {
    drawBalloonCaptureFrame()
  } else if (activeExperience === 'rubber') {
    drawRubberCaptureFrame(performance.now(), true)
  } else if (activeExperience === 'shampoo') {
    drawShampooCaptureFrame(performance.now(), true)
  } else if (activeExperience === 'glasses') {
    drawGlassesCaptureFrame(performance.now(), true)
  } else if (activeExperience === 'shiro') {
    drawShiroCaptureFrame()
  } else {
    const width = video.videoWidth
    const height = video.videoHeight
    captureCanvas.width = width
    captureCanvas.height = height
    const context = captureCanvas.getContext('2d')!
    context.save()
    context.translate(width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0, width, height)
    context.restore()
  }
  const prefix = activeExperience
  captureCanvas.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
      setStatus('Photo saved')
      window.setTimeout(() => setStatus('', false), 1500)
    }
  }, 'image/jpeg', 0.92)
}

function supportedRecordingType() {
  const types = ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

async function startRecording() {
  if (!stream || !('MediaRecorder' in window)) {
    setStatus('Video recording is not supported on this browser.')
    return
  }
  const mimeType = supportedRecordingType()
  try {
    const recordingExperience = activeExperience
    let recordingStream = stream
    if (recordingExperience !== 'lemonade') {
      if (recordingExperience !== 'shiro' && recordingExperience !== 'shampoo' && recordingExperience !== 'glasses') await waterAudio.unlock()
      if (recordingExperience === 'watertouch') {
        drawWaterCaptureFrame()
      } else if (recordingExperience === 'rubber') {
        drawRubberCaptureFrame(performance.now(), true)
      } else if (recordingExperience === 'shiro') {
        drawShiroCaptureFrame()
      } else if (recordingExperience === 'shampoo') {
        drawShampooCaptureFrame(performance.now(), true)
      } else if (recordingExperience === 'glasses') {
        drawGlassesCaptureFrame(performance.now(), true)
      } else {
        drawBalloonCaptureFrame()
      }
      recordingCanvasStream = captureCanvas.captureStream(30)
      const tracks = [...recordingCanvasStream.getVideoTracks()]
      const effectAudioTrack = recordingExperience === 'shiro' || recordingExperience === 'shampoo' || recordingExperience === 'glasses' ? null : waterAudio.recordingTrack()
      if (effectAudioTrack) tracks.push(effectAudioTrack)
      recordingStream = new MediaStream(tracks)
      lastRecordedFrameAt = 0
    }
    recordedChunks = []
    mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined)
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data)
    }
    mediaRecorder.onstop = () => {
      const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
      downloadBlob(new Blob(recordedChunks, { type: mimeType || 'video/webm' }), `${recordingExperience}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`)
      recordingCanvasStream?.getVideoTracks().forEach((track) => track.stop())
      recordingCanvasStream = null
      setStatus('Video saved')
      window.setTimeout(() => setStatus('', false), 1800)
    }
    mediaRecorder.start(1000)
    isRecording = true
    cameraButton.classList.add('is-recording')
    cameraButton.setAttribute('aria-label', 'Stop video recording')
    captureHint.textContent = 'tap to stop recording'
  } catch (error) {
    console.error('Could not start video recording.', error)
    setStatus('Video recording could not start on this device.')
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return
  mediaRecorder.stop()
  isRecording = false
  cameraButton.classList.remove('is-recording')
  cameraButton.setAttribute('aria-label', activeExperience === 'shiro' ? 'Start video recording' : 'Take photo or record video')
  captureHint.textContent = activeExperience === 'shiro'
    ? 'tap to start video'
    : activeExperience === 'watertouch'
      ? 'tap for a water photo · hold to record with sound'
      : activeExperience === 'rubber'
        ? 'tap for a rubber face photo · hold to record'
      : activeExperience === 'shampoo'
        ? 'tap for a foam photo · hold to record'
      : activeExperience === 'glasses'
        ? 'tap for a glasses photo · hold to record'
      : 'tap for a photo · hold to record'
}

function onPointerDown(event: PointerEvent) {
  event.preventDefault()
  if (isRecording) {
    stopRecording()
    return
  }
  if (activeExperience === 'impine') {
    cameraButton.classList.add('is-pressed')
    return
  }
  if (activeExperience === 'shiro') {
    cameraButton.classList.add('is-pressed')
    void startRecording()
    return
  }
  longPressTriggered = false
  pressStartedAt = performance.now()
  cameraButton.classList.add('is-pressed')
  pressTimer = window.setTimeout(() => {
    longPressTriggered = true
    cameraButton.classList.remove('is-pressed')
    void startRecording()
  }, 520)
}

function onPointerUp(event: PointerEvent) {
  event.preventDefault()
  window.clearTimeout(pressTimer)
  cameraButton.classList.remove('is-pressed')
  if (activeExperience === 'impine') {
    takePhoto()
    return
  }
  if (activeExperience === 'shiro') return
  if (!longPressTriggered && performance.now() - pressStartedAt < 520) takePhoto()
}

function onLeverPointerDown(event: PointerEvent) {
  if (activeExperience !== 'shampoo') return
  event.preventDefault()
  leverPointerId = event.pointerId
  leverStartY = event.clientY
  leverTriggered = false
  shampooLever.setPointerCapture(event.pointerId)
  shampooLever.classList.add('is-dragging')
}

function onLeverPointerMove(event: PointerEvent) {
  if (event.pointerId !== leverPointerId || activeExperience !== 'shampoo') return
  event.preventDefault()
  const pull = Math.max(0, Math.min(70, event.clientY - leverStartY))
  shampooLever.style.setProperty('--lever-pull', `${pull}px`)
  if (pull >= 48 && !leverTriggered) {
    leverTriggered = true
    shampooLever.classList.add('is-pulled')
    shampooScene.rinse()
    shampooScene.setLeverHeld(true)
  }
}

function onLeverKeyDown(event: KeyboardEvent) {
  if (activeExperience !== 'shampoo' || !['ArrowDown', 'Enter', ' '].includes(event.key)) return
  event.preventDefault()
  if (leverTriggered) return
  leverTriggered = true
  shampooLever.style.setProperty('--lever-pull', '70px')
  shampooLever.classList.add('is-pulled')
  shampooScene.rinse()
  shampooScene.setLeverHeld(true)
}

function onLeverKeyUp(event: KeyboardEvent) {
  if (['ArrowDown', 'Enter', ' '].includes(event.key)) resetShampooLever()
}

impineRenderer = new ImpineRenderer(impineCanvas, impineStage)
rubberRenderer = new RubberFaceRenderer(rubberCanvas)
createLemons()
lemons.forEach((lemon) => updateLemonVisual(lemon, performance.now()))
updateCup()
animationFrame = requestAnimationFrame(animate)
detectionFrame = requestAnimationFrame(renderLoop)
const requestedExperience = new URLSearchParams(window.location.search).get('experience')
const initialExperience = experienceOptions.find((option) => option.dataset.experience === requestedExperience)?.dataset.experience
if (initialExperience && initialExperience !== 'minecraft' && initialExperience !== activeExperience) {
  setExperience(initialExperience as Experience)
} else {
  startVisionSession()
}

cameraButton.addEventListener('pointerdown', onPointerDown)
cameraButton.addEventListener('pointerup', onPointerUp)
cameraButton.addEventListener('pointercancel', onPointerUp)
cameraButton.addEventListener('contextmenu', (event) => event.preventDefault())
shampooLever.addEventListener('pointerdown', onLeverPointerDown)
shampooLever.addEventListener('pointermove', onLeverPointerMove)
shampooLever.addEventListener('pointerup', resetShampooLever)
shampooLever.addEventListener('pointercancel', resetShampooLever)
shampooLever.addEventListener('keydown', onLeverKeyDown)
shampooLever.addEventListener('keyup', onLeverKeyUp)
shampooLever.addEventListener('blur', resetShampooLever)
impineMinimize.addEventListener('click', toggleImpineMinimize)
impineMaximize.addEventListener('click', toggleImpineMaximize)
impineClose.addEventListener('click', closeImpineWindow)
impineWindow.addEventListener('click', (event) => {
  if (!experienceApp.classList.contains('is-impine-minimized')) return
  const target = event.target as HTMLElement
  if (target === impineWindow || target.closest('.impine-minimized-label')) restoreImpineWindow()
})
experienceOptions.forEach((option) => {
  option.addEventListener('click', () => {
    const experience = option.dataset.experience
    if (experience === 'minecraft') {
      const url = new URL(window.location.href)
      url.searchParams.set('experience', activeExperience)
      window.history.replaceState(window.history.state, '', url.href)
      url.searchParams.set('experience', 'minecraft')
      window.location.assign(url.href)
      return
    }
    if (experience === 'lemonade' || experience === 'watertouch' || experience === 'balloon' || experience === 'shiro' || experience === 'impine' || experience === 'rubber' || experience === 'shampoo' || experience === 'glasses' || experience === 'forest' || experience === 'rumbling') setExperience(experience)
  })
})
window.addEventListener('resize', updateCup)

function disposeResources() {
  if (resourcesDisposed) return
  resourcesDisposed = true
  window.clearTimeout(pressTimer)
  cancelAnimationFrame(animationFrame)
  cancelAnimationFrame(detectionFrame)
  if (isRecording) stopRecording()
  resetShampooLever()
  stopVisionSession()
  shampooScene.deactivate()
  glassesScene.deactivate()
  forestLoadGeneration += 1
  forestScene?.deactivate()
  rumblingLoadGeneration += 1
  rumblingScene?.deactivate()
  waterRenderer?.dispose()
  waterRenderer = null
  recordingCanvasStream?.getVideoTracks().forEach((track) => track.stop())
  waterAudio.dispose()
}

window.addEventListener('pagehide', disposeResources)
window.addEventListener('beforeunload', disposeResources)
