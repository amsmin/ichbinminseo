import * as THREE from 'three'

/** Model front is +Z (skull/eyes), model up is +Y. Camera axes are never used. */
export class TitanSurfaceMotion {
  private input = ''
  private travel = new THREE.Vector3()
  private up = new THREE.Vector3()
  private axis = new THREE.Vector3()
  private forward = new THREE.Vector3()
  private heading = new THREE.Vector3()
  private right = new THREE.Vector3()
  private rotation = new THREE.Quaternion()
  private basis = new THREE.Matrix4()

  reset() { this.input = ''; this.travel.set(0, 0, 0) }

  step(body: THREE.Object3D, x: number, z: number, delta: number, radius: number, speed: number) {
    if ((!x && !z) || delta <= 0) { this.reset(); return }
    this.up.copy(body.position).normalize()
    const input = `${x},${z}`
    if (input !== this.input) {
      // Capture local intent when the keys change. Recomputing it from the turning
      // mesh every frame would make a held left/right key spiral indefinitely.
      this.travel.set(x, 0, z).normalize().applyQuaternion(body.quaternion)
      this.travel.addScaledVector(this.up, -this.travel.dot(this.up)).normalize()
      this.input = input
    }
    this.axis.crossVectors(this.up, this.travel).normalize()
    this.rotation.setFromAxisAngle(this.axis, speed * delta / radius)
    body.position.applyQuaternion(this.rotation).normalize().multiplyScalar(radius)
    body.quaternion.premultiply(this.rotation)
    this.travel.applyQuaternion(this.rotation).normalize()
    this.up.copy(body.position).normalize()

    // Down is a real back-step, not a 180° turn. Side/forward inputs turn the
    // complete skeleton toward travel; backward diagonals preserve reverse gait.
    this.heading.copy(this.travel).multiplyScalar(z < 0 ? -1 : 1)
    this.forward.set(0, 0, 1).applyQuaternion(body.quaternion)
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up)).normalize()
    this.axis.crossVectors(this.forward, this.heading)
    const angle = Math.atan2(this.axis.dot(this.up), THREE.MathUtils.clamp(this.forward.dot(this.heading), -1, 1))
    const limit = .55 * delta
    this.rotation.setFromAxisAngle(this.up, THREE.MathUtils.clamp(angle, -limit, limit))
    this.forward.applyQuaternion(this.rotation).normalize()
    this.right.crossVectors(this.up, this.forward).normalize()
    this.forward.crossVectors(this.right, this.up).normalize()
    body.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.right, this.up, this.forward))
  }
}
