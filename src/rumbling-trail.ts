import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type Building = { mesh: THREE.InstancedMesh; index: number; point: THREE.Vector3; gone: boolean }
/** Spatially indexed destruction plus append-only instanced footprint pages. */
export class RumblingTrail {
  readonly group = new THREE.Group()
  private cells = new Map<string, Building[]>()
  private dirty = new Set<THREE.InstancedMesh>()
  private zero = new THREE.Matrix4().makeScale(0, 0, 0)
  private point = new THREE.Vector3()
  private dummy = new THREE.Object3D()
  private page: THREE.InstancedMesh | null = null
  private used = 512
  private geometry: THREE.BufferGeometry
  private material = new THREE.MeshBasicMaterial({ color: '#251b16', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
  private radius: number

  constructor(radius: number) {
    this.radius = radius
    this.group.name = 'permanent-footprints'
    const shape = new THREE.Shape()
    shape.moveTo(-.2, -.5)
    shape.bezierCurveTo(-.43, -.4, -.22, .05, -.34, .33)
    shape.bezierCurveTo(-.43, .7, .33, .74, .34, .37)
    shape.bezierCurveTo(.31, .1, .26, -.6, -.2, -.5)
    const pieces: THREE.BufferGeometry[] = [new THREE.ShapeGeometry(shape, 12)]
    for (let i = 0; i < 5; i++) {
      const toe = new THREE.CircleGeometry(.1 - i * .009, 10)
      toe.translate(-.27 + i * .14, .79 - i * .055, 0); pieces.push(toe)
    }
    this.geometry = mergeGeometries(pieces, false)!
    pieces.forEach(piece => piece.dispose())
    this.geometry.rotateX(-Math.PI / 2)
    // Local toe direction is +Z, like the model's feet.
    this.geometry.rotateY(Math.PI)
  }

  register(mesh: THREE.InstancedMesh, index: number, point: THREE.Vector3) {
    const key = this.key(point)
    const cell = this.cells.get(key) ?? []
    cell.push({ mesh, index, point, gone: false }); this.cells.set(key, cell)
  }
  private key(p: THREE.Vector3) { return `${Math.floor(p.x / 3)},${Math.floor(p.y / 3)},${Math.floor(p.z / 3)}` }

  crush(point: THREE.Vector3, radius = 1.8) {
    const p = this.point.copy(point).normalize().multiplyScalar(this.radius)
    const x = Math.floor(p.x / 3), y = Math.floor(p.y / 3), z = Math.floor(p.z / 3)
    const range = Math.ceil((radius + .5) / 3)
    for (let dx = -range; dx <= range; dx++) for (let dy = -range; dy <= range; dy++) for (let dz = -range; dz <= range; dz++) {
      for (const building of this.cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
        if (!building.gone && building.point.distanceToSquared(p) < (radius + .3) ** 2) {
          building.gone = true
          building.mesh.setMatrixAt(building.index, this.zero)
          this.dirty.add(building.mesh)
        }
      }
    }
  }

  stamp(foot: THREE.Vector3, orientation: THREE.Quaternion, scale: number, left: boolean) {
    if (!this.page || this.used === 512) {
      this.page = new THREE.InstancedMesh(this.geometry, this.material, 512)
      this.page.count = 0; this.page.frustumCulled = false
      this.group.add(this.page); this.used = 0
    }
    const normal = foot.clone().normalize()
    const modelUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation)
    this.dummy.position.copy(normal).multiplyScalar(this.radius + .055)
    this.dummy.quaternion.copy(orientation).premultiply(new THREE.Quaternion().setFromUnitVectors(modelUp, normal))
    // Keep instance transforms positive (negative instance scales are unsupported).
    // Alternating feet use their own rig position, with a small natural toe-out.
    this.dummy.rotateY(left ? -.035 : .035)
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    this.page.setMatrixAt(this.used++, this.dummy.matrix)
    this.page.count = this.used; this.page.instanceMatrix.needsUpdate = true
    this.crush(foot, 1.35 * scale)
  }

  flush() { this.dirty.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true }); this.dirty.clear() }
  dispose() {
    this.cells.clear(); this.dirty.clear()
    this.geometry.dispose(); this.material.dispose()
  }
}
