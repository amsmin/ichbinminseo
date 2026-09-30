import './minecraft.css'
import { MINECRAFT_HUD } from './minecraft-hud'
import { MinecraftEquipment } from './minecraft-equipment'
import { hotbarSelectionMarkup, mountHotbarSelection } from './minecraft-selection'

// Keep the supplied file untouched. SVG clips display its existing pixels in
// two independent screen-space windows, without redrawing any HUD artwork.
export const MINECRAFT_OVERLAY_URL = '/hotbar2.png'

function hudWindow(part: 'crosshair' | 'hotbar', label: string) {
  const { viewBox, clip } = MINECRAFT_HUD[part]
  return `<svg class="minecraft-${part}" viewBox="${viewBox}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="minecraft-${part}-clip" clipPathUnits="userSpaceOnUse"><path d="${clip}" /></clipPath></defs>
    <image ${part === 'hotbar' ? 'data-hotbar-art' : ''} href="${MINECRAFT_OVERLAY_URL}" width="${MINECRAFT_HUD.sourceWidth}" height="${MINECRAFT_HUD.sourceHeight}" clip-path="url(#minecraft-${part}-clip)" />
    ${part === 'hotbar' ? hotbarSelectionMarkup(MINECRAFT_OVERLAY_URL) : ''}
  </svg>`
}

export function mountMinecraft(root: HTMLElement) {
  document.title = '마인크래프트 · Experiment 17'
  root.innerHTML = `
    <main class="minecraft-camera" aria-label="마인크래프트 카메라">
      <video class="minecraft-video" autoplay muted playsinline aria-label="좌우 반전된 웹캠 영상"></video>
      <div class="minecraft-hud" hidden>
        ${hudWindow('crosshair', '마인크래프트 조준점')}
        ${hudWindow('hotbar', '마인크래프트 핫바와 숫자')}
      </div>
      <p class="minecraft-error" role="alert" hidden></p>
    </main>
  `
  const video = root.querySelector<HTMLVideoElement>('video')!
  const hud = root.querySelector<HTMLDivElement>('.minecraft-hud')!
  const disposeSelection = mountHotbarSelection(root.querySelector<SVGSVGElement>('.minecraft-hotbar')!)
  const overlay = new Image()
  const errorNotice = root.querySelector<HTMLParagraphElement>('.minecraft-error')!
  let stream: MediaStream | null = null
  let generation = 0
  let disposed = false
  let cameraError = ''
  let imageError = ''
  let trackingError = ''
  video.muted = true

  function showErrors() {
    errorNotice.textContent = [cameraError, imageError, trackingError].filter(Boolean).join('\n')
    errorNotice.hidden = !errorNotice.textContent
  }

  const equipment = new MinecraftEquipment(root.querySelector<HTMLElement>('.minecraft-camera')!, video, (message) => {
    trackingError = message
    showErrors()
  })

  overlay.onload = () => {
    if (disposed) return
    hud.hidden = false
    imageError = ''
    showErrors()
  }
  overlay.onerror = () => {
    if (disposed) return
    hud.hidden = true
    imageError = '원본 PNG를 public/hotbar2.png에 넣고 새로고침해주세요. 이미지는 편집 없이 그대로 표시됩니다.'
    showErrors()
  }
  overlay.src = MINECRAFT_OVERLAY_URL

  function stopCamera() {
    equipment.stop()
    generation += 1
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.pause()
    video.srcObject = null
  }

  async function startCamera() {
    stopCamera()
    const request = generation
    cameraError = ''
    showErrors()
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraError = '카메라를 사용하려면 HTTPS 또는 localhost로 접속해주세요.'
      showErrors()
      return
    }
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
      // A permission prompt may resolve after navigation or disposal.
      if (disposed || request !== generation) {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }
      stream = acquired
      acquired.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (disposed || request !== generation) return
        cameraError = '카메라 연결이 종료됐습니다. 연결과 권한을 확인한 뒤 새로고침해주세요.'
        stopCamera()
        showErrors()
      }, { once: true }))
      video.srcObject = acquired
      await video.play()
      if (!disposed && request === generation) equipment.start()
    } catch (error) {
      if (disposed || request !== generation) return
      stopCamera()
      const name = error instanceof Error ? error.name : ''
      cameraError = name === 'NotAllowedError' || name === 'SecurityError'
        ? '카메라 권한이 필요합니다. 브라우저 사이트 설정에서 카메라를 허용한 뒤 새로고침해주세요.'
        : name === 'NotFoundError'
          ? '연결된 카메라가 없습니다. 웹캠을 연결한 뒤 새로고침해주세요.'
          : '카메라를 실행하지 못했습니다. 다른 앱의 카메라 사용을 종료한 뒤 새로고침해주세요.'
      showErrors()
    }
  }

  const onPageHide = () => stopCamera()
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && !disposed) void startCamera()
  }
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  void startCamera()

  return () => {
    disposed = true
    stopCamera()
    equipment.dispose()
    disposeSelection()
    overlay.onload = null
    overlay.onerror = null
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('beforeunload', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    root.replaceChildren()
  }
}
