// One coordinate contract for the camera alignment, curved photo surface and 3D eyes.
export const TITAN_FACE = {
  width: 288, height: 400,
  radiusX: .9, radiusY: 1.24, radiusZ: .73,
  centerY: 4.95, centerZ: 7.8,
  halfPhi: .84, thetaStart: .87, thetaLength: 1.25,
  eyeX: .34, eyeY: 5.06,
}
const theta = Math.acos((TITAN_FACE.eyeY - TITAN_FACE.centerY) / TITAN_FACE.radiusY)
const phi = Math.asin(TITAN_FACE.eyeX / (TITAN_FACE.radiusX * Math.sin(theta)))
export const TITAN_EYES = {
  leftU: .5 - phi / (TITAN_FACE.halfPhi * 2),
  rightU: .5 + phi / (TITAN_FACE.halfPhi * 2),
  v: (theta - TITAN_FACE.thetaStart) / TITAN_FACE.thetaLength,
  z: TITAN_FACE.centerZ + TITAN_FACE.radiusZ * Math.sin(theta) * Math.cos(phi) + .055,
}

export type EyePoint = { x: number; y: number }
export function eyeAlignment(left: EyePoint, right: EyePoint) {
  const dx = right.x - left.x, dy = right.y - left.y
  const distance = Math.hypot(dx, dy)
  if (distance < 18) throw new Error('눈이 너무 작게 보여요. 카메라에 조금 더 가까이 다가와주세요.')
  return {
    x: (left.x + right.x) / 2, y: (left.y + right.y) / 2,
    angle: Math.atan2(dy, dx),
    scale: (TITAN_EYES.rightU - TITAN_EYES.leftU) * TITAN_FACE.width / distance,
    targetX: TITAN_FACE.width / 2, targetY: TITAN_EYES.v * TITAN_FACE.height,
  }
}
