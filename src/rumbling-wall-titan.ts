import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Wall Titan: separate, fully volumetric humanoid, 10.9 world units tall. */
export function buildWallTitan() {
  const group = new THREE.Group()
  group.name = 'wall-titan'
  group.userData.titanKind = '벽거인'
  const muscle: THREE.BufferGeometry[] = [], tendon: THREE.BufferGeometry[] = [], recess: THREE.BufferGeometry[] = []
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const lobe = (parts: THREE.BufferGeometry[], x: number, y: number, z: number, sx: number, sy: number, sz: number, tilt = 0) => {
    const g = sphere.clone()
    g.applyMatrix4(new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), tilt), v(sx, sy, sz)))
    parts.push(g)
  }
  const strand = (parts: THREE.BufferGeometry[], points: THREE.Vector3[], radius: number) => {
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, radius, 4, false))
  }
  // Torso and pelvis have mass on both sides; rear trapezius, lats and glutes are distinct.
  lobe(muscle, 0, 7.1, 0, 1.15, 1.75, .53)
  lobe(muscle, 0, 5.45, -.02, .88, .76, .53)
  lobe(tendon, 0, 7.55, .55, .065, 1.12, .045)
  lobe(tendon, 0, 7.65, -.56, .065, 1.12, .055)
  for (const side of [-1, 1]) {
    lobe(muscle, side * .68, 8.1, .35, .76, .54, .34, side * .12)
    lobe(muscle, side * .67, 7.9, -.36, .69, .9, .32, -side * .25)
    lobe(muscle, side * .61, 5.45, -.35, .53, .52, .34)
    lobe(muscle, side * 1.35, 8.23, 0, .51, .69, .57)
    lobe(muscle, side * 1.61, 7.14, .06, .34, .77, .35, side * .13)
    lobe(muscle, side * 1.71, 6.67, -.14, .28, .66, .28)
    lobe(tendon, side * 1.79, 6.22, 0, .25, .23, .27)
    lobe(muscle, side * 1.84, 5.46, .11, .26, .77, .29, side * .035)
    lobe(tendon, side * 1.9, 4.65, .11, .2, .18, .22)
    lobe(muscle, side * 1.93, 4.23, .11, .25, .39, .16)
    for (let finger = 0; finger < 5; finger++) lobe(muscle, side * (1.74 + finger * .085), 3.82 - .08 * Math.sin(finger), .13, .048, .25, .065)
    lobe(muscle, side * .56, 4.02, .11, .49, 1.21, .53, side * .035)
    lobe(muscle, side * .76, 4.06, -.22, .27, 1.14, .35)
    lobe(tendon, side * .59, 2.77, .29, .31, .34, .22)
    lobe(muscle, side * .61, 1.65, -.11, .31, 1, .4)
    lobe(tendon, side * .6, 1.58, .29, .095, .9, .08)
    lobe(tendon, side * .61, .56, .04, .23, .2, .27)
    lobe(muscle, side * .61, .24, .25, .33, .24, .55)
    for (let toe = 0; toe < 5; toe++) lobe(muscle, side * .61 + (toe - 2) * .115, .15, .73, .065, .13, .18)
    for (let row = 0; row < 4; row++) {
      lobe(muscle, side * .26, 7.35 - row * .38, .56, .24, .17, .18)
      lobe(muscle, side * .85, 7.3 - row * .32, .3, .3, .14, .25, -side * .35)
    }
    // Fine pale-red muscle fibers, rather than smooth red mannequin surfaces.
    for (let i = 0; i < 10; i++) {
      strand(tendon, [v(side * .1, 8.5 - i * .08, .6), v(side * .6, 8.2 - i * .045, .69), v(side * 1.18, 8.3 - i * .05, .4)], .012)
      strand(tendon, [v(side * (.3 + i * .048), 5, .41), v(side * (.29 + i * .055), 4.08, .62), v(side * .58, 3.02, .41)], .01)
      strand(tendon, [v(side * .08, 8.68 - i * .11, -.58), v(side * .55, 8.2 - i * .08, -.69), v(side * 1.02, 7.3 - i * .06, -.44)], .012)
    }
    strand(tendon, [v(side * .16, 9.62, .24), v(side * .34, 8.9, .23), v(side * 1.08, 8.55, .1)], .05)
  }
  lobe(muscle, 0, 9.08, 0, .34, .64, .32)
  lobe(tendon, 0, 10.17, .02, .51, .71, .46)
  lobe(muscle, 0, 9.76, .18, .36, .29, .32)
  for (const side of [-1, 1]) {
    lobe(recess, side * .19, 10.24, .43, .15, .12, .065)
    lobe(muscle, side * .3, 9.97, .38, .15, .2, .12)
    lobe(tendon, side * .19, 10.41, .42, .19, .075, .08)
  }
  lobe(recess, 0, 9.76, .46, .23, .065, .035)
  lobe(tendon, 0, 10.06, .47, .075, .17, .1)
  for (let i = 0; i < 7; i++) lobe(tendon, (i - 3) * .06, 9.78, .49, .024, .043, .024)
  sphere.dispose()
  const legs = [-1, 1].map(side => {
    const leg = new THREE.Group(); leg.name = side < 0 ? 'left-leg' : 'right-leg'
    leg.position.set(side * .56, 5.2, 0)
    group.add(leg); return leg
  })
  for (const [name, parts, color] of [['exposed-red-muscles', muscle, '#972c25'], ['tendons-and-muscle-fibers', tendon, '#bd9982'], ['eye-mouth-cavities', recess, '#281414']] as const) {
    const buckets: THREE.BufferGeometry[][] = [[], [], []]
    parts.forEach(part => {
      part.computeBoundingBox()
      const center = part.boundingBox!.getCenter(new THREE.Vector3())
      const slot = center.y < 5.3 && Math.abs(center.x) < 1.35 ? (center.x < 0 ? 1 : 2) : 0
      if (slot) part.translate(-legs[slot - 1]!.position.x, -5.2, 0)
      buckets[slot]!.push(part)
    })
    const material = new THREE.MeshStandardMaterial({ color, roughness: .77 })
    buckets.forEach((pieces, slot) => {
      if (!pieces.length) return
      const geometry = mergeGeometries(pieces, false)!
      pieces.forEach(part => part.dispose())
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name
      ;(slot ? legs[slot - 1]! : group).add(mesh)
    })
  }
  return group
}
