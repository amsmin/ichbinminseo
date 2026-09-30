import * as THREE from 'three'

type HandSlot = 2 | 3 | 4
export type GripCalibration = {
  point: THREE.Vector3
  axis: THREE.Vector3
  tip: THREE.Vector3
  baseRotation: THREE.Quaternion
}
const UP = new THREE.Vector3(0,1,0)
const Z = new THREE.Vector3(0,0,1)

// Coordinates of the EXISTING mesh, including its baked 45-degree rotation.
// This only describes reference points; it never edits a geometry attribute.
function gridPoint(slot: HandSlot, x: number, y: number) {
  const origin=slot===2 ? [.5,7.4] : slot===3 ? [2,10] : [3,12]
  const unit=slot===2 ? .019 : .0175
  const p=new THREE.Vector3((x-origin[0])*unit,(origin[1]-y)*unit,0)
  return slot===2 ? p : p.applyAxisAngle(Z,Math.PI/4)
}

export function gripCalibration(slot: HandSlot): GripCalibration {
  // Grip points lie INSIDE the handle, never at the bounding-box centre.
  const grip=slot===2 ? [.5,6.5] : slot===3 ? [3,9] : [3.5,12.5]
  const butt=slot===2 ? [.5,9] : slot===3 ? [1,11] : [2.5,13.5]
  const neck=slot===2 ? [.5,2] : slot===3 ? [8,4] : [4.5,11.5]
  const head=slot===2 ? [.5,0] : slot===3 ? [8,0] : [14,1]
  const point=gridPoint(slot,...grip as [number,number])
  const tip=gridPoint(slot,...head as [number,number])
  const axis=gridPoint(slot,...neck as [number,number]).sub(gridPoint(slot,...butt as [number,number])).normalize()
  return {point,axis,tip,baseRotation:new THREE.Quaternion().setFromUnitVectors(axis,UP)}
}

export function alignedGripRotation(tracking: THREE.Quaternion, direction: THREE.Vector3) {
  // Retain tracking's roll, but constrain its swing to the actual wrist line.
  // Correct in WORLD space (premultiply), not by a model-local Euler 90° offset.
  const from=UP.clone().applyQuaternion(tracking)
  const correction=new THREE.Quaternion().setFromUnitVectors(from,direction.clone().normalize())
  return correction.multiply(tracking).normalize()
}

export class EquipmentGrip {
  readonly root=new THREE.Group()
  readonly basis=new THREE.Group()
  readonly calibration: GripCalibration
  private direction: THREE.Vector3 | null=null
  private order=0

  constructor(model: THREE.Mesh, slot: HandSlot) {
    this.calibration=gripCalibration(slot)
    this.root.name='two-hand-grip'
    this.basis.name='model-base-rotation'
    this.basis.quaternion.copy(this.calibration.baseRotation)
    // T(midpoint) * R(tracking) * S(existing scale) * R(base) * T(-grip).
    // Exact pivot compensation: model.localToWorld(grip) === midpoint.
    model.position.copy(this.calibration.point).negate()
    model.quaternion.identity()
    model.scale.setScalar(1)
    this.basis.add(model)
    this.root.add(this.basis)
  }

  reset() { this.direction=null;this.order=0 }

  update(position: THREE.Vector3, tracking: THREE.Quaternion,
    wrists: [THREE.Vector3,THREE.Vector3], scale: number, seconds: number) {
    const axis=wrists[1].clone().sub(wrists[0]).normalize()
    // The same handle axis is used for all three tools. Aim towards the upper
    // wrist, not always the anatomical right hand. Hysteresis near horizontal
    // avoids noise repeatedly flipping the tool by 180 degrees.
    if (!this.order || Math.abs(axis.y)>.15) this.order=axis.y<0 ? -1 : 1
    axis.multiplyScalar(this.order)
    if (!this.direction) this.direction=axis.clone()
    else {
      const alpha=1-Math.exp(-Math.min(.065,Math.max(0,seconds))*17)
      this.direction.lerp(axis,alpha)
      if(this.direction.lengthSq()<1e-8)this.direction.copy(axis)
      this.direction.normalize()
    }
    this.root.position.copy(position)
    this.root.quaternion.copy(alignedGripRotation(tracking,this.direction))
    this.root.scale.setScalar(scale)
  }
}
