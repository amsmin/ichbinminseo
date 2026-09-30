import { PoseLandmarker, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision'
import type { BodyFrame } from './minecraft-tracking3d'
import { createVisionTask } from './minecraft-vision-runtime'
import { assetUrl } from './asset-url'

type Mode = 'hand' | 'head'
let disposed = false, configuration = 0
let active: Mode | null = null
let pose: PoseLandmarker | null = null
let hands: HandLandmarker | null = null
let face: FaceLandmarker | null = null
let handSetup: Promise<void> | null = null, headSetup: Promise<void> | null = null
let stage = 'wasm:resolve'
function enterStage(value: string) {
  stage = value
  self.postMessage({ type: 'status', stage })
}
function reportError(error: unknown) {
  const detail = error instanceof Error ? error : new Error(String(error))
  self.postMessage({ type: 'error', stage, message: detail.message, name: detail.name, stack: detail.stack })
}

async function configure(mode: Mode) {
  const generation = ++configuration
  active = null
  try {
    if (mode === 'hand') {
      handSetup ??= (async () => {
        if (disposed) return
        const p = await createVisionTask('pose:init', vision => PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: assetUrl('/models/pose_landmarker_lite.task'), delegate: 'CPU' },
          canvas: new OffscreenCanvas(1,1), runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
          minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .55,
        }), enterStage)
        if (disposed) { p.close(); return }
        pose = p
        const h = await createVisionTask('hand:init', vision => HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: assetUrl('/models/hand_landmarker.task'), delegate: 'CPU' },
          canvas: new OffscreenCanvas(1,1), runningMode: 'VIDEO', numHands: 2,
          minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .55,
        }), enterStage)
        if (disposed) { h.close(); return }
        hands = h
      })()
      await handSetup
    } else {
      headSetup ??= (async () => {
        if (disposed) return
        const f = await createVisionTask('face:init', vision => FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: assetUrl('/models/face_landmarker.task'), delegate: 'CPU' },
          canvas: new OffscreenCanvas(1,1), runningMode: 'VIDEO', numFaces: 1,
          outputFaceBlendshapes: false, minFaceDetectionConfidence: .5,
          minFacePresenceConfidence: .5, minTrackingConfidence: .55,
        }), enterStage)
        if (disposed) { f.close(); return }
        face = f
      })()
      await headSetup
    }
    if (disposed || generation !== configuration) return
    active = mode
    self.postMessage({ type: 'ready', mode })
  } catch (error) {
    if (!disposed && generation === configuration) reportError(error)
  }
}

self.onmessage = (event: MessageEvent<
  { type: 'frame'; bitmap: ImageBitmap; timestamp: number; selection: number; mode: Mode }
  | { type: 'configure'; mode: Mode } | { type: 'dispose' }
>) => {
  const data = event.data
  if (data.type === 'configure') { void configure(data.mode); return }
  if (data.type === 'dispose') {
    disposed = true; configuration++
    pose?.close(); hands?.close(); face?.close()
    pose = null; hands = null; face = null
    self.close(); return
  }
  try {
    if (disposed || active !== data.mode) {
      self.postMessage({ type: 'tracking', frame: { pose: [], hands: [], face: [] }, timestamp: data.timestamp, selection: data.selection })
      return
    }
    const frame: BodyFrame = { pose: [], hands: [], face: [] }
    if (active === 'hand' && pose && hands) {
      stage = 'hand:infer'
      const h = hands.detectForVideo(data.bitmap,data.timestamp)
      frame.hands = h.landmarks.map((points,i) => ({ points, world: h.worldLandmarks[i] ?? [],
        label: h.handedness[i]?.[0]?.categoryName ?? '', score: h.handedness[i]?.[0]?.score ?? 0 }))
      // Both wrists and fingers must describe the SAME frame for a two-hand
      // handle axis. Backpressure in the main thread bounds CPU work to 18 Hz.
      stage = 'pose:infer'
      const p = pose.detectForVideo(data.bitmap,data.timestamp)
      frame.pose = p.landmarks[0] ?? []
      p.close()
    } else if (face) {
      stage = 'face:infer'
      frame.face = face.detectForVideo(data.bitmap,data.timestamp).faceLandmarks[0] ?? []
    }
    self.postMessage({ type: 'tracking', frame, timestamp: data.timestamp, selection: data.selection })
  } catch (error) {
    reportError(error)
  } finally { data.bitmap.close() }
}
