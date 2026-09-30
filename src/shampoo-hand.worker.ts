import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { assetUrl } from './asset-url'

type WorkerHand = {
  hand: 'left' | 'right'
  x: number
  y: number
  pose: 'pinch' | 'open'
}

let landmarker: HandLandmarker | null = null
let disposed = false
const pinchState = new Map<WorkerHand['hand'], { active: boolean; seenAt: number }>()

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}

function classify(landmarks: NormalizedLandmark[], wasPinching: boolean): WorkerHand['pose'] {
  const wrist = landmarks[0]
  const middleBase = landmarks[9]
  const handScale = Math.max(0.001, distance(wrist, middleBase))
  const pinchDistance = distance(landmarks[4], landmarks[8]) / handScale
  const indexReach = distance(landmarks[8], landmarks[5]) / Math.max(0.001, distance(landmarks[6], landmarks[5]))
  const indexAwayFromPalm = distance(landmarks[8], middleBase) > distance(landmarks[6], middleBase) * (wasPinching ? 1.01 : 1.08)
  return pinchDistance < (wasPinching ? 0.43 : 0.35)
    && indexReach > (wasPinching ? 1.2 : 1.3)
    && indexAwayFromPalm ? 'pinch' : 'open'
}

async function initialize() {
  try {
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm', true)
    if (disposed) return
    const created = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: assetUrl('/models/hand_landmarker.task'), delegate: 'CPU' },
      canvas: typeof OffscreenCanvas === 'undefined' ? undefined : new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    })
    if (disposed) {
      created.close()
      return
    }
    landmarker = created
    self.postMessage({ type: 'ready' })
  } catch (error) {
    if (!disposed) self.postMessage({ type: 'error', message: String(error) })
  }
}

self.onmessage = (event: MessageEvent<{ type: 'frame'; bitmap: ImageBitmap; timestamp: number } | { type: 'dispose' }>) => {
  const data = event.data
  if (data.type === 'dispose') {
    disposed = true
    pinchState.clear()
    landmarker?.close()
    landmarker = null
    self.close()
    return
  }
  const { bitmap, timestamp } = data
  if (!landmarker || disposed) {
    bitmap.close()
    return
  }
  try {
    const result = landmarker.detectForVideo(bitmap, timestamp)
    const hands: WorkerHand[] = result.landmarks.map((landmarks, index) => {
      const label = result.handedness[index]?.[0]?.categoryName?.toLowerCase()
      const hand: WorkerHand['hand'] = label === 'left' ? 'right' : 'left'
      const pose = classify(landmarks, pinchState.get(hand)?.active ?? false)
      pinchState.set(hand, { active: pose === 'pinch', seenAt: timestamp })
      const thumb = landmarks[4]
      const finger = landmarks[8]
      const palm = landmarks[9]
      return {
        hand,
        x: pose === 'pinch' ? (thumb.x + finger.x) * 0.5 : palm.x,
        y: pose === 'pinch' ? (thumb.y + finger.y) * 0.5 : palm.y,
        pose,
      }
    })
    for (const [hand, state] of pinchState) {
      if (!hands.some((result) => result.hand === hand) && timestamp - state.seenAt > 300) pinchState.delete(hand)
    }
    self.postMessage({ type: 'hands', hands, timestamp })
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) })
  } finally {
    bitmap.close()
  }
}

void initialize()
