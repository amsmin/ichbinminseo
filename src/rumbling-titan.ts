import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TITAN_FACE, TITAN_EYES } from './rumbling-face-layout'

/** Static, volumetric reference-inspired skeleton. No image planes or billboards. */
export function buildRumblingTitan(worldRadius = 10) {
  const group = new THREE.Group()
  group.name = 'founding-titan-3d'
  const bone: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], eyes: THREE.BufferGeometry[] = []
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const ellipsoid = (target: THREE.BufferGeometry[], position: THREE.Vector3, scale: THREE.Vector3) => {
    const geometry = sphere.clone()
    geometry.applyMatrix4(new THREE.Matrix4().compose(position, new THREE.Quaternion(), scale))
    target.push(geometry)
  }
  const tube = (target: THREE.BufferGeometry[], points: THREE.Vector3[], radius: number, endRadius = radius, segments = 20) => {
    const curve = new THREE.CatmullRomCurve3(points)
    const geometry = new THREE.TubeGeometry(curve, segments, 1, 7, false)
    const position = geometry.getAttribute('position')
    for (let ring = 0; ring <= segments; ring++) {
      const t = ring / segments, center = curve.getPointAt(t)
      const thickness = THREE.MathUtils.lerp(radius, endRadius, t)
      for (let side = 0; side <= 7; side++) {
        const index = ring * 8 + side
        const point = new THREE.Vector3().fromBufferAttribute(position, index).sub(center).multiplyScalar(thickness).add(center)
        position.setXYZ(index, point.x, point.y, point.z)
      }
    }
    geometry.computeVertexNormals()
    target.push(geometry)
  }
  // Rounded back rises above the city; local +Z is the head, -Z is the tail.
  const spineAt = (t: number) => v(0, 8.5 + 8.6 * Math.sin(t * Math.PI * .86), 5.3 - t * 14.5)
  tube(bone, Array.from({ length: 12 }, (_, i) => spineAt(i / 11)), .46, .27, 64)
  const groundAt = (x: number, z: number) => Math.sqrt(Math.max(.3, worldRadius * worldRadius - x * x - z * z)) - worldRadius + .3
  for (let i = 0; i < 28; i++) {
    const t = i / 27, center = spineAt(t)
    ellipsoid(bone, center, v(.64, .46, .36))
    // Individual vertebral processes make the spine legible from behind and above.
    const spike = 2.4 + 4.5 * Math.sin(t * Math.PI)
    tube(bone, [center, center.clone().add(v(0, spike * .5, -.45)), center.clone().add(v(0, spike, -1.25))], .24, .025, 10)
    for (const side of [-1, 1]) {
      const spread = 5.6 + 4.4 * Math.sin(t * Math.PI * .88)
      const endX = side * (4.7 + 1.6 * Math.sin(t * Math.PI))
      const endZ = center.z * .84
      const endY = groundAt(endX, endZ)
      tube(bone, [
        center.clone().add(v(side * .25, -.15, 0)),
        center.clone().add(v(side * spread * .55, -.7, -.25)),
        v(side * spread, center.y * .62, endZ - .5),
        v(side * spread * .87, center.y * .21, endZ - .25),
        v(endX, endY, endZ),
      ], .25 - t * .04, .095, 28)
      ellipsoid(bone, center.clone().add(v(side * .6, -.15, .06)), v(.36, .28, .3))
    }
  }
  // Forward-curving neck, suspended skull and long skeletal arms.
  tube(bone, [spineAt(0), v(0, 7.9, 6.2), v(0, 6.5, 7.4), v(0, 5.5, 7.8)], .35, .28)
  for (const side of [-1, 1]) {
    const shoulder = v(side * 2.1, 8.2, 5.8)
    const elbow = v(side * 5.2, 7.1, 7.1)
    const wrist = v(side * 5.5, 1.2, 7.7)
    tube(bone, [v(0, 8.4, 5.5), shoulder, elbow], .24, .2)
    ellipsoid(bone, shoulder, v(.45, .8, .35))
    ellipsoid(bone, elbow, v(.34, .35, .36))
    for (const offset of [-.15, .15]) tube(bone, [elbow.clone().add(v(offset, 0, 0)), v(side * 5.4 + offset, 4, 7.4), wrist.clone().add(v(offset, 0, 0))], .13, .095)
    ellipsoid(bone, wrist, v(.3, .35, .2))
    for (let finger = 0; finger < 5; finger++) {
      const x = wrist.x + (finger - 2) * .14
      tube(bone, [v(x, 1.1, 7.7), v(x + side * .08, .25 - Math.sin(finger) * .1, 7.9), v(x + side * .05, -.13, 8.1)], .07, .025, 8)
    }
  }
  // Solid skull, jaw, cheek bones and teeth — visible from every azimuth.
  ellipsoid(bone, v(0, 4.95, 7.8), v(.88, 1.22, .69))
  ellipsoid(bone, v(0, 4.05, 7.88), v(.63, .53, .56))
  for (const side of [-1, 1]) {
    ellipsoid(dark, v(side * .34, 5.05, 8.38), v(.28, .21, .13))
    ellipsoid(eyes, v(side * TITAN_FACE.eyeX, TITAN_FACE.eyeY, TITAN_EYES.z), v(.09, .055, .045))
    tube(bone, [v(side * .65, 4.85, 8.18), v(side * .69, 4.38, 8.24), v(side * .35, 3.95, 8.35)], .13, .11, 12)
  }
  ellipsoid(dark, v(0, 4.28, 8.39), v(.48, .16, .095))
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * .098
    ellipsoid(bone, v(x, 4.32, 8.47 - x * x * .16), v(.04, .085, .06))
  }
  // Hair is a 3D cap plus thick tapered locks, open at the face (not a flat texture).
  ellipsoid(dark, v(0, 5.69, 7.67), v(.95, .74, .74))
  for (let i = 0; i < 38; i++) {
    const angle = i / 38 * Math.PI * 2
    const x = Math.sin(angle), z = Math.cos(angle)
    if (z > .65 && Math.abs(x) < .72) continue
    const endY = -1.4 - .9 * Math.sin(i * 2.1) ** 2
    tube(dark, [v(x * .79, 5.9, 7.7 + z * .59), v(x * 1.02, 4.7, 7.7 + z * .77), v(x * 1.04, 1.2, 7.8 + z * .83), v(x * .85, endY, 7.9 + z * .72)], .115, .025, 18)
  }
  sphere.dispose()
  const addBatch = (name: string, pieces: THREE.BufferGeometry[], material: THREE.Material) => {
    const merged = mergeGeometries(pieces, false)!
    pieces.forEach(piece => piece.dispose())
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, material); mesh.name = name
    group.add(mesh)
  }
  addBatch('spine-ribs-skull-arms', bone, new THREE.MeshStandardMaterial({ color: '#c5bba5', roughness: .84, metalness: .02 }))
  addBatch('volumetric-hair-and-sockets', dark, new THREE.MeshStandardMaterial({ color: '#201d1b', roughness: .92 }))
  addBatch('eyes', eyes, new THREE.MeshStandardMaterial({ color: '#62c9b8', emissive: '#247d70', emissiveIntensity: .7, roughness: .6 }))
  return group
}
