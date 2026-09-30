import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type ResidentKind = 'human'|'cat'|'dog'|'fox'|'rabbit'|'bear'|'squirrel'|'pig'|'cow'|'horse'|'deer'|'elephant'|'frog'|'bird'|'duck'|'penguin'|'fish'|'turtle'|'insect'|'octopus'|'vessel'|'vehicle'|'plant'|'fruit'|'object'
export type ResidentRecognition = {
  kind:ResidentKind
  label:string
  confidence:number
  source:'classifier'|'pose'|'silhouette'
}

export type ResidentAnalysis = {
  person: ImageData
  pose: NormalizedLandmark[]
  face: NormalizedLandmark[]
  referencePose: NormalizedLandmark[]
  silhouette: Float32Array
  maskSize: number
  referenceWidth: number
  referenceHeight: number
  recognition?:ResidentRecognition
}

export type ResidentWorkerInput =
  | { type: 'prepare' }
  | { type: 'create'; photo: ImageBitmap; reference: ImageBitmap }

export type ResidentWorkerOutput =
  | { type: 'progress'; message: string }
  | { type: 'ready' }
  | { type: 'result'; result: ResidentAnalysis }
  | { type: 'error'; message: string }
