import * as THREE from 'three'
import { projectPose, type Viewport } from './minecraft-pose'

export type Landmark3D = { x: number; y: number; z: number; visibility?: number }
export type TrackedHand = { points: Landmark3D[]; world: Landmark3D[]; label: string; score: number }
export type BodyFrame = { pose: Landmark3D[]; hands: TrackedHand[]; face: Landmark3D[] }
export type GearTransform = { position: THREE.Vector3; rotation: THREE.Quaternion; hands: THREE.Vector3[][]; wrists: [THREE.Vector3,THREE.Vector3] | null }
export const GEAR_FOV = 45
export const focalLength = (view: Viewport) => view.height / (2 * Math.tan(THREE.MathUtils.degToRad(GEAR_FOV) / 2))
const clamp = THREE.MathUtils.clamp
const valid = (p: Landmark3D | undefined): p is Landmark3D => !!p && [p.x,p.y,p.z].every(Number.isFinite)

function sourceSpan(a: Landmark3D, b: Landmark3D, view: Viewport) {
  const scale = Math.max(view.width / view.videoWidth, view.height / view.videoHeight)
  return Math.hypot((a.x-b.x)*view.videoWidth*scale, (a.y-b.y)*view.videoHeight*scale, (a.z-b.z)*view.videoWidth*scale)
}

// Perspective unprojection matches the existing mirrored, cover-cropped video.
// MediaPipe relative z supplies local depth; apparent anatomical size supplies
// camera distance. This is monocular estimated depth, not a hardware depth map.
export function cameraPoint(p: Landmark3D, depth: number, referenceZ: number, view: Viewport) {
  const screen = projectPose(p, view), focal = focalLength(view)
  const drawWidth = view.videoWidth * Math.max(view.width / view.videoWidth, view.height / view.videoHeight)
  const d = Math.max(.12, depth + (p.z - referenceZ) * drawWidth * depth / focal)
  return new THREE.Vector3((screen.x - view.left - view.width / 2) * d / focal,
    (view.height / 2 - (screen.y - view.top)) * d / focal, -d)
}

function visible(p: Landmark3D | undefined): p is Landmark3D {
  return valid(p) && (p.visibility ?? 0) >= .5
}

function palmDepth(hand: TrackedHand, view: Viewport): number | null {
  const span = sourceSpan(hand.points[0],hand.points[9],view)
  if (span < 8) return null
  const a=hand.world[0], b=hand.world[9]
  const meters=valid(a)&&valid(b) ? clamp(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),.065,.115) : .09
  return clamp(focalLength(view)*meters/span,.38,3.2)
}

export function twoHandTransform(frame: BodyFrame, view: Viewport): GearTransform | null {
  if (!view.videoWidth || !view.videoHeight || !view.width || !view.height) return null
  const candidates=frame.hands.filter(h=>h.points.length===21 && h.points.every(valid) && h.score>=.5)
  const poseLeft=frame.pose[15], poseRight=frame.pose[16]
  const havePose=visible(poseLeft)&&visible(poseRight)
  let left: TrackedHand | null=null, right: TrackedHand | null=null
  if (havePose) {
    // Match BOTH anatomical wrists, using a one-to-one assignment. Never reuse
    // a hand for both endpoints and never sort wrists by screen height/x.
    let best=Infinity
    for (const a of candidates) for (const b of candidates) {
      if (a===b) continue
      const da=Math.hypot(a.points[0].x-poseLeft.x,a.points[0].y-poseLeft.y)
      const db=Math.hypot(b.points[0].x-poseRight.x,b.points[0].y-poseRight.y)
      if (da<.22 && db<.22 && da+db<best) { left=a;right=b;best=da+db }
    }
  } else {
    // Unmirrored camera input: handedness labels follow MediaPipe's selfie
    // convention. BOTH labelled hands are required when the torso is cropped.
    left=candidates.find(h=>h.label==='Right'&&h.score>=.6)??null
    right=candidates.find(h=>h.label==='Left'&&h.score>=.6)??null
    if (!left || !right || left===right) return null
  }

  let leftWrist: THREE.Vector3, rightWrist: THREE.Vector3
  const hands: THREE.Vector3[][]=[]
  if (havePose) {
    const depths=[left,right].filter((h):h is TrackedHand=>!!h)
      .map(h=>palmDepth(h,view)).filter((d):d is number=>d!==null)
    let depth: number
    if (depths.length) depth=depths.reduce((sum,d)=>sum+d,0)/depths.length
    else {
      const shoulderLeft=frame.pose[11], shoulderRight=frame.pose[12]
      if (!visible(shoulderLeft)||!visible(shoulderRight)) return null
      const span=sourceSpan(shoulderLeft,shoulderRight,view)
      if (span<16) return null
      depth=clamp(focalLength(view)*.36/span,.38,3.2)
    }
    const referenceZ=(poseLeft.z+poseRight.z)/2
    // Pose wrists share one z origin. Hand z values don't, so align each finger
    // set to its own Pose wrist instead of comparing two unrelated hand origins.
    leftWrist=cameraPoint(poseLeft,depth,referenceZ,view)
    rightWrist=cameraPoint(poseRight,depth,referenceZ,view)
    for (const [hand,wrist,anchor] of [[left,poseLeft,leftWrist],[right,poseRight,rightWrist]] as const) {
      if (!hand) continue
      const points=hand.points.map(p=>cameraPoint({...p,z:wrist.z+p.z-hand.points[0].z},depth,referenceZ,view))
      const offset=anchor.clone().sub(points[0])
      hands.push(points.map(p=>p.add(offset)))
    }
  } else {
    const leftDepth=palmDepth(left!,view), rightDepth=palmDepth(right!,view)
    if (leftDepth===null||rightDepth===null) return null
    const lp=left!.points.map(p=>cameraPoint(p,leftDepth,left!.points[0].z,view))
    const rp=right!.points.map(p=>cameraPoint(p,rightDepth,right!.points[0].z,view))
    leftWrist=lp[0];rightWrist=rp[0]
    hands.push(lp,rp)
  }
  // Left -> right is a stable anatomical handle axis, including when crossing
  // hands or turning the grip. One missing wrist never becomes a one-hand grip.
  const y=rightWrist.clone().sub(leftWrist)
  if (y.length()<.018) return null
  y.normalize()
  const position=leftWrist.clone().add(rightWrist).multiplyScalar(.5)
  let normal=new THREE.Vector3(0,0,1)
  if (hands.length===2) {
    const normals=hands.map(h=>new THREE.Vector3().crossVectors(
      h[5].clone().sub(h[17]),h[9].clone().sub(h[0])).normalize())
    if (normals[0].dot(normals[1])<0) normals[0].negate()
    const combined=normals[0].add(normals[1])
    if (combined.lengthSq()>.01) normal=combined.normalize()
  }
  normal.addScaledVector(y,-normal.dot(y))
  if (normal.lengthSq()<.01) {
    normal.set(0,0,1).addScaledVector(y,-y.z)
    if (normal.lengthSq()<.01) normal.set(0,1,0).addScaledVector(y,-y.y)
  }
  normal.normalize()
  const x=new THREE.Vector3().crossVectors(y,normal).normalize()
  const z=new THREE.Vector3().crossVectors(x,y).normalize()
  return { position,rotation:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z)),
    hands,wrists:[leftWrist,rightWrist] }
}

export function helmetTransform(frame: BodyFrame, view: Viewport): GearTransform | null {
  const f = frame.face
  if (![33,263,10,152,234,454].every(i => valid(f[i])) || !view.videoWidth || !view.videoHeight) return null
  const span = sourceSpan(f[234], f[454], view)
  if (span < 20) return null
  const depth = clamp(focalLength(view) * .155 / span, .25, 3.2)
  const referenceZ = (f[33].z + f[263].z) / 2
  const point = (i: number) => cameraPoint(f[i], depth, referenceZ, view)
  const a = point(33), b = point(263)
  // Anatomical indices retain their ordering as the head turns; no billboard.
  const right = a.clone().sub(b).normalize()
  const up = point(10).sub(point(152)).normalize()
  const forward = new THREE.Vector3().crossVectors(right, up).normalize()
  if (forward.lengthSq() < .5) return null
  up.crossVectors(forward, right).normalize()
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward))
  const position = a.add(b).multiplyScalar(.5).addScaledVector(forward, -.077)
  return { position, rotation, hands: [], wrists: null }
}

export function smoothGear(current: GearTransform | null, target: GearTransform, dt: number): GearTransform {
  if (!current) return { position: target.position.clone(), rotation: target.rotation.clone(), hands: target.hands, wrists: target.wrists }
  const delta = Math.min(.065, Math.max(0, dt))
  const movement = current.position.distanceTo(target.position)
  const alpha = 1 - Math.exp(-delta * (14 + Math.min(20, movement * 120)))
  current.position.lerp(target.position, alpha)
  current.rotation.slerp(target.rotation, 1 - Math.exp(-delta * 17))
  current.hands = target.hands
  current.wrists = target.wrists
  return current
}
