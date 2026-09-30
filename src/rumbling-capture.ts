import { eyeAlignment, TITAN_EYES, type EyePoint } from './rumbling-face-layout'
type FaceCrop = { x: number; y: number; width: number; height: number; angle: number; leftEye: EyePoint; rightEye: EyePoint }
/** Single-shot camera flow. Photos stay in memory and never leave the browser. */
export class RumblingCapture {
  readonly dialog: HTMLDialogElement
  private video: HTMLVideoElement
  private message: HTMLElement
  private shoot: HTMLButtonElement
  private stream: MediaStream | null = null
  private generation = 0
  private busy = false
  private connecting = false
  private retry: HTMLButtonElement
  private cancelDetection: (() => void) | null = null
  private onCapture: (face: HTMLCanvasElement) => void

  constructor(parent: HTMLElement, onCapture: (face: HTMLCanvasElement) => void) {
    this.onCapture = onCapture
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'rumbling-camera'
    this.dialog.innerHTML = `<header><div><small>THE RUMBLING</small><h2>시조의 거인이 될 얼굴을 촬영하세요</h2></div><button type="button" class="titan-close" aria-label="촬영 닫기">×</button></header>
      <div class="titan-camera-view"><video autoplay muted playsinline></video><div class="titan-face-guide" aria-hidden="true"><span class="titan-eye-guide" style="left:${TITAN_EYES.leftU * 100}%;top:${TITAN_EYES.v * 100}%"></span><span class="titan-eye-guide" style="left:${TITAN_EYES.rightU * 100}%;top:${TITAN_EYES.v * 100}%"></span></div></div>
      <p>초록색 눈 가이드를 참고해 정면을 바라봐주세요. 정확히 맞추지 않아도 촬영 후 양쪽 눈의 위치·간격·기울기를 자동 정렬합니다. 사진은 전송·저장하지 않습니다.</p>
      <p class="titan-camera-status" role="status" aria-live="polite"></p>
      <button type="button" class="titan-reconnect">카메라 다시 연결</button>
      <button type="button" class="titan-shoot" disabled>촬영하고 땅울림 시작</button>`
    parent.append(this.dialog)
    this.video = this.dialog.querySelector('video')!
    this.message = this.dialog.querySelector('.titan-camera-status')!
    this.shoot = this.dialog.querySelector('.titan-shoot')!
    this.retry = this.dialog.querySelector('.titan-reconnect')!
    this.video.muted = true
    this.video.playsInline = true
    this.retry.addEventListener('click', () => { void this.connectCamera() })
    this.dialog.querySelector('.titan-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close() })
    // A delayed close event from a previous opening must not stop a new stream.
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.stop() })
    this.video.addEventListener('loadeddata', () => this.update())
    this.video.addEventListener('canplay', () => this.update())
    this.shoot.addEventListener('click', () => { void this.capture() })
  }

  async open() {
    if (this.dialog.open) return
    this.dialog.showModal()
    await this.connectCamera()
  }

  private async connectCamera() {
    this.stop()
    const generation = this.generation
    this.connecting = true
    this.message.textContent = '카메라 연결 중… 브라우저의 카메라 권한 요청을 허용해주세요.'
    this.update()
    try {
      if (!window.isSecureContext) throw new DOMException('HTTPS 또는 localhost로 접속해야 카메라를 사용할 수 있어요.', 'InsecureContextError')
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('현재 브라우저는 카메라를 지원하지 않아요. Safari 또는 Chrome에서 열어주세요.', 'UnsupportedCameraError')
      let stream: MediaStream
      try {
        stream = await this.requestStream({ facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, generation)
      } catch (error) {
        if (generation !== this.generation) return
        if (!(error instanceof DOMException) || !['OverconstrainedError', 'NotReadableError', 'AbortError'].includes(error.name)) throw error
        // Some webcams reject preferred constraints or need a moment after the previous example releases them.
        await new Promise(resolve => setTimeout(resolve, 250))
        if (generation !== this.generation) return
        stream = await this.requestStream(true, generation)
      }
      if (generation !== this.generation || !this.dialog.open) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream
      this.video.srcObject = stream
      const playback = this.video.play()
      await this.waitForFrame(playback, generation)
      if (generation !== this.generation) return
      this.message.textContent = '얼굴을 타원에 맞추고 촬영해주세요.'
      this.update()
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
        if (generation !== this.generation || !this.dialog.open) return
        this.stop()
        this.message.textContent = '카메라 연결이 종료됐어요. 카메라 다시 연결을 눌러주세요.'
        this.update()
      }, { once: true })
    } catch (error) {
      if (generation !== this.generation) return
      this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
      this.video.pause(); this.video.srcObject = null
      const name = error instanceof Error ? error.name : 'UnknownError'
      const messages: Record<string, string> = {
        NotAllowedError: '카메라 권한이 차단됐어요. 주소창의 사이트 설정과 macOS 시스템 설정의 카메라 권한을 허용한 뒤 다시 연결해주세요.',
        SecurityError: '브라우저 보안 설정이 카메라를 차단했어요. HTTPS 접속과 사이트 권한을 확인해주세요.',
        NotFoundError: '사용할 카메라가 없어요. 카메라 연결 상태를 확인해주세요.',
        NotReadableError: '카메라를 시작하지 못했어요. 다른 카메라 앱이나 탭을 닫고 다시 연결해주세요.',
        TimeoutError: '카메라 응답을 기다리는 시간이 초과됐어요. 권한 요청을 확인한 뒤 다시 연결해주세요.',
        FrameTimeoutError: '카메라 영상이 재생되지 않아요. 카메라 다시 연결을 눌러주세요.',
      }
      this.message.textContent = messages[name] || (error instanceof Error ? error.message : '카메라 연결에 실패했어요. 다시 연결해주세요.')
      console.warn('Rumbling camera connection failed:', name)
    } finally {
      if (generation === this.generation) { this.connecting = false; this.update() }
    }
  }

  private requestStream(video: MediaTrackConstraints | boolean, generation: number): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      let expired = false
      const timer = window.setTimeout(() => { expired = true; reject(new DOMException('Camera request timed out', 'TimeoutError')) }, 30000)
      navigator.mediaDevices.getUserMedia({ audio: false, video }).then(stream => {
        clearTimeout(timer)
        if (expired || generation !== this.generation || !this.dialog.open) {
          stream.getTracks().forEach(track => track.stop())
          reject(new DOMException('Camera request cancelled', 'AbortError')); return
        }
        resolve(stream)
      }, error => { clearTimeout(timer); reject(error) })
    })
  }

  private async waitForFrame(playback: Promise<void>, generation: number) {
    let playbackError: unknown
    void playback.catch(error => { playbackError = error })
    const started = performance.now()
    while (generation === this.generation) {
      if (playbackError) throw playbackError
      if (this.video.readyState >= 2 && this.video.videoWidth > 0 && !this.video.paused) return
      if (performance.now() - started > 10000) throw new DOMException('Video frame timed out', 'FrameTimeoutError')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new DOMException('Camera opening cancelled', 'AbortError')
  }

  private update() {
    this.retry.disabled = this.connecting || this.busy
    this.retry.textContent = this.connecting ? '카메라 연결 중…' : '카메라 다시 연결'
    this.shoot.disabled = this.connecting || this.busy || !this.stream || this.video.readyState < 2 || !this.video.videoWidth
    if (!this.video.videoWidth) return
    const view = this.dialog.querySelector<HTMLElement>('.titan-camera-view')!
    view.style.aspectRatio = `${this.video.videoWidth} / ${this.video.videoHeight}`
    // Guide helps framing; the actual crop is located by face landmarks after capture.
    view.style.setProperty('--face-width', `${this.video.videoHeight * .62 * .72 / this.video.videoWidth * 100}%`)
  }

  private detectFace(bitmap: ImageBitmap): Promise<FaceCrop> {
    return new Promise((resolve, reject) => {
      let worker: Worker
      try { worker = new Worker(new URL('./rumbling-face.worker.ts', import.meta.url), { type: 'module' }) }
      catch (error) { bitmap.close(); reject(error); return }
      const finish = () => { clearTimeout(timer); worker.terminate(); this.cancelDetection = null }
      const timer = window.setTimeout(() => { finish(); reject(new Error('얼굴 모델 준비 시간이 초과됐어요. 네트워크 연결을 확인하고 다시 촬영해주세요.')) }, 30000)
      this.cancelDetection = () => { finish(); reject(new Error('촬영 취소')) }
      worker.onmessage = (event: MessageEvent<{ crop?: FaceCrop; error?: string }>) => {
        finish()
        if (event.data.crop) resolve(event.data.crop)
        else reject(new Error(event.data.error || '얼굴을 찾지 못했어요.'))
      }
      worker.onerror = () => { finish(); reject(new Error('얼굴 인식기를 불러오지 못했어요. 네트워크 연결을 확인해주세요.')) }
      try { worker.postMessage(bitmap, [bitmap]) }
      catch (error) { bitmap.close(); finish(); reject(error) }
    })
  }

  private async capture() {
    if (this.shoot.disabled) return
    this.busy = true; this.update()
    const generation = this.generation
    this.message.textContent = '양쪽 눈을 검출해 거인의 초록눈 위치에 자동 정렬하고 있어요…'
    try {
      const photo = document.createElement('canvas')
      const scale = Math.min(1, 960 / this.video.videoWidth)
      photo.width = Math.round(this.video.videoWidth * scale); photo.height = Math.round(this.video.videoHeight * scale)
      const photoCtx = photo.getContext('2d')!
      photoCtx.translate(photo.width, 0); photoCtx.scale(-1, 1)
      photoCtx.drawImage(this.video, 0, 0, photo.width, photo.height)
      const bitmap = await createImageBitmap(photo)
      if (generation !== this.generation) { bitmap.close(); return }
      const crop = await this.detectFace(bitmap)
      if (generation !== this.generation || !this.dialog.open) return
      if (crop.width < 30 || crop.height < 40) throw new Error('얼굴이 너무 작아요. 카메라에 조금 더 가까이 다가와주세요.')
      const face = document.createElement('canvas'); face.width = 288; face.height = 400
      const ctx = face.getContext('2d')!
      const alignment = eyeAlignment(crop.leftEye, crop.rightEye)
      ctx.translate(alignment.targetX, alignment.targetY)
      ctx.scale(alignment.scale, alignment.scale)
      ctx.rotate(-alignment.angle)
      ctx.translate(-alignment.x, -alignment.y)
      ctx.drawImage(photo, 0, 0)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      // A feathered ellipse excludes the corners and background of the photograph.
      const oval = document.createElement('canvas'); oval.width = 288; oval.height = 400
      const ovalCtx = oval.getContext('2d')!
      ovalCtx.translate(144, 200); ovalCtx.scale(144, 200)
      const fade = ovalCtx.createRadialGradient(0, 0, .82, 0, 0, 1)
      fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#fff0')
      ovalCtx.fillStyle = fade; ovalCtx.fillRect(-1, -1, 2, 2)
      ctx.drawImage(oval, 0, 0)
      this.onCapture(face)
      this.close()
    } catch (error) {
      if (generation !== this.generation) return
      console.error('Titan capture failed', error)
      this.message.textContent = error instanceof Error ? error.message : '합성하지 못했어요. 다시 촬영해주세요.'
    } finally { if (generation === this.generation) { this.busy = false; this.update() } }
  }

  private stop() {
    this.generation++
    this.cancelDetection?.()
    this.busy = false
    this.connecting = false
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    this.video.pause(); this.video.srcObject = null
  }

  close() { this.stop(); if (this.dialog.open) this.dialog.close() }
}

/** First reference image: face opening inside the long hair, below the neck. */
export function composeTitan(face: HTMLCanvasElement, artwork: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 2048 / artwork.naturalWidth)
  canvas.width = Math.round(artwork.naturalWidth * scale); canvas.height = Math.round(artwork.naturalHeight * scale)
  const ctx = canvas.getContext('2d')!
  // Calibrated to public/titan.png (1717×916); titan2.png is the head-detail reference.
  // Keep the outer hair silhouette and the long hanging strands untouched.
  const x = canvas.width * .198, y = canvas.height * .568
  const width = canvas.width * .025, height = canvas.height * .085
  // Photo underneath, original skeleton/hair above; only the inner face is opened.
  ctx.filter = 'saturate(0.35) contrast(1.15)'
  ctx.drawImage(face, x - width / 2, y - height / 2, width, height)
  ctx.filter = 'none'
  const overlay = document.createElement('canvas'); overlay.width = canvas.width; overlay.height = canvas.height
  const top = overlay.getContext('2d')!
  top.drawImage(artwork, 0, 0, canvas.width, canvas.height)
  top.globalCompositeOperation = 'destination-out'
  top.drawImage(face, x - width / 2, y - height / 2, width, height)
  // Put original fringe strands back over the photograph, keeping eyes mostly clear.
  top.globalCompositeOperation = 'source-over'
  top.save()
  top.beginPath(); top.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2); top.clip()
  for (const [offset, length] of [[-.31, .74], [-.12, .29], [.16, .34], [.34, .81]]) {
    const strandX = x + offset! * width
    const strandY = y - height / 2
    const strandWidth = Math.max(1, width * .035)
    top.drawImage(artwork, strandX / scale, strandY / scale, strandWidth / scale, height * length! / scale,
      strandX, strandY, strandWidth, height * length!)
  }
  top.restore()
  ctx.drawImage(overlay, 0, 0)
  return canvas
}
