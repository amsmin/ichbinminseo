import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { assetUrl } from './asset-url'

// One inference on the captured still, never a continuous camera inference loop.
self.onmessage = async (event: MessageEvent<ImageBitmap>) => {
  const photo = event.data
  let detector: FaceLandmarker | null = null
  try {
    const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm', true)
    detector = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: assetUrl('/models/face_landmarker.task'), delegate: 'CPU' },
      canvas: new OffscreenCanvas(1, 1), runningMode: 'IMAGE', numFaces: 1,
    })
    const points = detector.detect(photo).faceLandmarks[0]
    if (!points) throw new Error('얼굴을 찾지 못했어요. 밝은 곳에서 정면을 보고 다시 촬영해주세요.')
    const point = (index: number) => ({ x: points[index]!.x * photo.width, y: points[index]!.y * photo.height })
    const top = point(10), chin = point(152), left = point(234), right = point(454)
    const a = point(33), b = point(263)
    const sign = b.x >= a.x ? 1 : -1
    const eyeCenter = (iris: number, cornerA: number, cornerB: number) => {
      if (points[iris]) return point(iris)
      const a = point(cornerA), b = point(cornerB)
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    const eyes = [eyeCenter(468, 33, 133), eyeCenter(473, 263, 362)].sort((a, b) => a.x - b.x)
    const nose = point(1)
    const eyeSpan = Math.hypot(eyes[1]!.x - eyes[0]!.x, eyes[1]!.y - eyes[0]!.y)
    if (eyeSpan < 18) throw new Error('양쪽 눈이 잘 보이도록 카메라에 조금 더 가까이 다가와주세요.')
    const noseOffset = ((nose.x - (eyes[0]!.x + eyes[1]!.x) / 2) * (eyes[1]!.x - eyes[0]!.x)
      + (nose.y - (eyes[0]!.y + eyes[1]!.y) / 2) * (eyes[1]!.y - eyes[0]!.y)) / (eyeSpan * eyeSpan)
    if (Math.abs(noseOffset) > .28) throw new Error('얼굴을 옆으로 돌리지 말고 양쪽 눈이 보이게 정면을 바라봐주세요.')
    self.postMessage({
      crop: { leftEye: eyes[0], rightEye: eyes[1], x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2,
        width: Math.hypot(right.x - left.x, right.y - left.y) * .94,
        height: Math.hypot(chin.x - top.x, chin.y - top.y) * .98,
        angle: Math.atan2((b.y - a.y) * sign, (b.x - a.x) * sign) },
    })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '얼굴 검출을 시작하지 못했어요.' })
  } finally { detector?.close(); photo.close() }
}
