import './minecraft-equipment.css'
import { hotbarKey, type HotbarSlot } from './minecraft-selection'
import { MinecraftGearStage } from './minecraft-gear-stage'
import { twoHandTransform, helmetTransform, type BodyFrame, type GearTransform } from './minecraft-tracking3d'
import { trackEvent } from './analytics'

type Mode = 'hand' | 'head'
type TrackingMessage = { type: 'ready'; mode: Mode } | { type: 'status'; stage: string }
  | { type: 'error'; stage: string; name: string; message: string; stack?: string }
  | { type: 'tracking'; frame: BodyFrame; timestamp: number; selection: number }
const GRACE_MS = 360
const INFERENCE_INTERVAL = 1000 / 18
const hasGear = (slot: HotbarSlot): slot is 2 | 3 | 4 | 5 => slot >= 2 && slot <= 5

export class MinecraftEquipment {
  private parent: HTMLElement
  private video: HTMLVideoElement
  private report: (message: string) => void
  private stage: MinecraftGearStage | null = null
  private slot: HotbarSlot = 1
  private selection = 0
  private worker: Worker | null = null
  private workerMode: Mode | null = null
  private workerReady = false
  private busy = false
  private watchdog = 0
  private running = false
  private disposed = false
  private frame = 0
  private lastRender = 0
  private lastInference = -Infinity
  private lastVideoTime = -1
  private tracking: BodyFrame = { pose: [], hands: [], face: [] }
  private poseTimestamp = -Infinity
  private lastValid = -Infinity
  private target: GearTransform | null = null

  constructor(parent: HTMLElement, video: HTMLVideoElement, report: (message: string) => void) {
    this.parent = parent
    this.video = video
    this.report = report
    window.addEventListener('keydown', this.onKey)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  start() {
    if (this.disposed) return
    this.running = true
    this.resume()
  }

  stop() {
    this.running = false
    this.suspend()
    // Release the WebGL context on page navigation/camera shutdown.
    this.stage?.dispose()
    this.stage = null
  }

  dispose() {
    this.disposed = true
    this.stop()
    window.removeEventListener('keydown', this.onKey)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.isComposing || event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    const slot = hotbarKey(event)
    if (slot === null) return
    event.preventDefault()
    this.select(slot)
  }

  private select(slot: HotbarSlot) {
    if (this.slot === slot && (!hasGear(slot) || this.stage && this.workerReady)) return
    trackEvent('minecraft_slot_select', { slot })
    this.slot = slot
    this.selection++
    this.busy = false
    this.stage?.hide()
    this.clearPose()
    this.report('')
    if (!hasGear(slot)) { this.suspend(); return }
    try {
      this.stage ??= new MinecraftGearStage(this.parent)
      this.stage.select(slot)
    } catch (error) {
      console.error('3D equipment could not initialize', error)
      this.failWorker('3D 장비를 시작하지 못했습니다. WebGL 지원 브라우저에서 다시 시도해주세요.')
      return
    }
    this.resume()
  }

  private clearPose() {
    this.tracking = { pose: [], hands: [], face: [] }
    this.target = null
    this.poseTimestamp = -Infinity
    this.lastValid = -Infinity
  }

  private onVisibility = () => {
    if (document.hidden) this.suspend()
    else this.resume()
  }

  private suspend() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.stage?.hide()
    this.clearPose()
    this.releaseWorker()
  }

  private releaseWorker() {
    window.clearTimeout(this.watchdog)
    const worker = this.worker
    this.worker = null
    this.workerMode = null
    this.workerReady = false
    this.busy = false
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.postMessage({ type: 'dispose' })
      window.setTimeout(() => worker.terminate(), 150)
    }
  }

  private failWorker(message: string) {
    this.suspend()
    this.report(message)
  }

  private resume() {
    if (!this.running || this.disposed || document.hidden || !hasGear(this.slot)) return
    const mode: Mode = this.slot === 5 ? 'head' : 'hand'
    try {
      if (!this.stage) { this.stage = new MinecraftGearStage(this.parent); this.stage.select(this.slot) }
      if (!this.worker) {
        const worker = new Worker(new URL('./minecraft-pose.worker.ts', import.meta.url), { type: 'module' })
        this.worker = worker
        worker.onmessage = (event: MessageEvent<TrackingMessage>) => {
          if (this.worker !== worker || this.disposed) return
          const data = event.data
          if (data.type === 'status') {
            console.debug('[Minecraft tracking]', data.stage)
          } else if (data.type === 'ready') {
            if (data.mode !== this.workerMode) return
            window.clearTimeout(this.watchdog)
            this.workerReady = true
            this.report('')
          } else if (data.type === 'error') {
            console.error('3D tracking failed', data.stage, data.name, data.message, data.stack)
            this.failWorker(`트래킹 오류 [${data.stage}]: ${data.message}`)
          } else {
            if (data.selection !== this.selection) return
            window.clearTimeout(this.watchdog)
            this.busy = false
            this.tracking = data.frame
            // A successful CPU inference may take longer than the grace window.
            // Grace starts when its result arrives, not when the frame was sent.
            this.poseTimestamp = performance.now()
          }
        }
        worker.onerror = (event) => {
          console.error('Minecraft Worker error', event.message, event.filename, event.lineno, event.colno, event.error)
          this.failWorker(`트래킹 오류 [worker]: ${event.message || 'Worker 실행 실패'}`)
        }
      }
      if (this.workerMode !== mode || !this.workerReady) {
        this.workerMode = mode
        this.workerReady = false
        this.busy = false
        window.clearTimeout(this.watchdog)
        this.watchdog = window.setTimeout(() => this.failWorker('트래킹 준비 시간이 초과됐습니다. 연결을 확인하고 숫자키를 다시 눌러주세요.'), 45000)
        this.worker.postMessage({ type: 'configure', mode })
      }
    } catch (error) {
      console.error(error)
      this.failWorker('이 브라우저에서 3D 트래킹을 시작할 수 없습니다.')
      return
    }
    if (!this.frame) {
      this.lastRender = performance.now()
      this.lastInference = -Infinity
      this.lastVideoTime = -1
      this.frame = requestAnimationFrame(this.tick)
    }
  }

  private sendFrame(now: number) {
    const worker = this.worker
    if (!worker || !this.workerReady || this.busy || this.video.readyState < 2 || !this.video.videoWidth
      || this.video.currentTime === this.lastVideoTime || now - this.lastInference < INFERENCE_INTERVAL) return
    this.busy = true
    this.lastVideoTime = this.video.currentTime
    this.lastInference = now
    const selection = this.selection, mode = this.workerMode
    const ratio = Math.min(1, 640 / Math.max(this.video.videoWidth, this.video.videoHeight))
    window.clearTimeout(this.watchdog)
    this.watchdog = window.setTimeout(() => this.failWorker('트래킹 응답이 지연됩니다. 숫자키를 다시 눌러주세요.'), 5000)
    void createImageBitmap(this.video, {
      resizeWidth: Math.max(1, Math.round(this.video.videoWidth * ratio)),
      resizeHeight: Math.max(1, Math.round(this.video.videoHeight * ratio)), resizeQuality: 'low',
    }).then((bitmap) => {
      if (this.disposed || this.worker !== worker || selection !== this.selection) { bitmap.close(); return }
      worker.postMessage({ type: 'frame', bitmap, timestamp: now, selection, mode }, [bitmap])
    }).catch((error) => {
      if (this.worker !== worker || selection !== this.selection) return
      console.error('Tracking camera frame failed', error)
      this.failWorker('카메라 프레임을 읽지 못했습니다. 숫자키를 다시 눌러주세요.')
    })
  }

  private tick = (now: number) => {
    this.frame = 0
    if (!this.running || this.disposed || document.hidden || !hasGear(this.slot)) return
    this.sendFrame(now)
    const rect = this.video.getBoundingClientRect()
    const view = { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight }
    const target = now - this.poseTimestamp < 450
      ? (this.slot === 5 ? helmetTransform(this.tracking,view) : twoHandTransform(this.tracking,view)) : null
    if (target) { this.target = target; this.lastValid = this.poseTimestamp }
    if (this.target && now - this.lastValid <= GRACE_MS) {
      if (now - this.lastRender >= 1000 / 40) {
        this.stage?.render(this.target,(now-this.lastRender)/1000,rect.width,rect.height)
        this.lastRender = now
      }
    } else {
      this.stage?.hide()
      this.lastRender = now
    }
    this.frame = requestAnimationFrame(this.tick)
  }
}
