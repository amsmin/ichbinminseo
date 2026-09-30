export type EquipmentSlot = 1 | 2 | 3 | 4 | 5
export type PosePoint = { x: number; y: number; visibility?: number; presence?: number }
export type Viewport = { left: number; top: number; width: number; height: number; videoWidth: number; videoHeight: number }
export type Attachment = { x: number; y: number; angle: number; size: number }

export function equipmentKey(event: Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>): EquipmentSlot | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const digit = /^(?:Digit|Numpad)([1-5])$/.exec(event.code)?.[1] ?? (/^[1-5]$/.test(event.key) ? event.key : '')
  return digit ? Number(digit) as EquipmentSlot : null
}

// Landmarks arrive from the UNMIRRORED full video. Match CSS cover + scaleX(-1).
export function projectPose(point: PosePoint, view: Viewport) {
  const scale = Math.max(view.width / view.videoWidth, view.height / view.videoHeight)
  return {
    x: view.left + view.width - (point.x * view.videoWidth * scale + (view.width - view.videoWidth * scale) / 2),
    y: view.top + point.y * view.videoHeight * scale + (view.height - view.videoHeight * scale) / 2,
  }
}

const confident = (p: PosePoint | undefined): p is PosePoint => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && (p.visibility ?? 0) >= .55 && (p.presence ?? 1) >= .5
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

export function poseAttachment(points: PosePoint[], slot: EquipmentSlot, view: Viewport): Attachment | null {
  if (slot === 1 || !view.videoWidth || !view.videoHeight || !view.width || !view.height) return null
  if (slot !== 5) {
    // Anatomical RIGHT elbow/wrist; never swap indices because of the selfie view.
    if (!confident(points[14]) || !confident(points[16])) return null
    const elbow = projectPose(points[14], view), wrist = projectPose(points[16], view)
    const arm = distance(elbow, wrist)
    if (arm < 8) return null
    const shoulders = confident(points[11]) && confident(points[12])
      ? distance(projectPose(points[11], view), projectPose(points[12], view)) : arm * 2
    // Foreshortening should not make an item collapse when the arm points forward.
    const size = Math.max(arm, shoulders * .28) * (slot === 2 ? 1.12 : slot === 3 ? 1.5 : 1.65)
    return { ...wrist, angle: Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x), size: Math.min(size, Math.max(view.width, view.height) * .65) }
  }
  if (!confident(points[2]) || !confident(points[5]) || !confident(points[0])) return null
  const eyes = [projectPose(points[2], view), projectPose(points[5], view)].sort((a, b) => a.x - b.x)
  const eyeWidth = distance(eyes[0], eyes[1])
  if (eyeWidth < 5) return null
  const ears = confident(points[7]) && confident(points[8])
    ? distance(projectPose(points[7], view), projectPose(points[8], view)) : 0
  const width = Math.max(eyeWidth * 2.75, Math.min(ears * 1.22, eyeWidth * 3.6))
  return {
    x: (eyes[0].x + eyes[1].x) / 2,
    y: (eyes[0].y + eyes[1].y) / 2,
    angle: Math.atan2(eyes[1].y - eyes[0].y, eyes[1].x - eyes[0].x),
    size: Math.min(width, Math.max(view.width, view.height) * .75),
  }
}

export function smoothAttachment(current: Attachment | null, target: Attachment, seconds: number): Attachment {
  if (!current) return { ...target }
  const dt = Math.min(.06, Math.max(0, seconds))
  const motion = Math.hypot(target.x - current.x, target.y - current.y) / Math.max(40, target.size)
  const positionAlpha = 1 - Math.exp(-dt * (12 + Math.min(26, motion * 35)))
  const angleAlpha = 1 - Math.exp(-dt * 18), sizeAlpha = 1 - Math.exp(-dt * 10)
  const delta = Math.atan2(Math.sin(target.angle - current.angle), Math.cos(target.angle - current.angle))
  return {
    x: current.x + (target.x - current.x) * positionAlpha,
    y: current.y + (target.y - current.y) * positionAlpha,
    angle: current.angle + delta * angleAlpha,
    size: current.size + (target.size - current.size) * sizeAlpha,
  }
}
