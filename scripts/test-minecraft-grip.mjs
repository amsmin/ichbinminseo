import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as THREE from 'three'

const read=name=>fs.readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8')
const url=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')
const three=source=>source.replace("'three'",JSON.stringify(import.meta.resolve('three')))
const {createGearModel}=await import(url(three(read('minecraft-models'))
  .replace("'three/addons/utils/BufferGeometryUtils.js'",JSON.stringify(import.meta.resolve('three/addons/utils/BufferGeometryUtils.js')))
  .replace("'./minecraft-voxel-data'",JSON.stringify(url(read('minecraft-voxel-data'))))))
const {EquipmentGrip}=await import(url(three(read('minecraft-grip'))))
const hash=geometry=>{
  const h=createHash('sha256')
  for(const attribute of [...Object.values(geometry.attributes),geometry.index].filter(Boolean))
    h.update(Buffer.from(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength))
  return h.digest('hex')
}
const centre=new THREE.Vector3(.03,.08,-.8)
const up=new THREE.Vector3(0,1,0)
for(const slot of [2,3,4]) {
  const model=createGearModel(slot),original=hash(model.geometry)
  model.updateMatrixWorld()
  const grip=new EquipmentGrip(model,slot), c=grip.calibration
  // Grip is on an actual solid handle pixel, not the mesh/bounding-box centre.
  const ray=new THREE.Raycaster(c.point.clone().add(new THREE.Vector3(0,0,.1)),new THREE.Vector3(0,0,-1))
  const untransformed=new THREE.Mesh(model.geometry,model.material)
  untransformed.updateMatrixWorld()
  // Adjacent Float32 voxel faces can leave a sub-micron numerical seam.
  const onHandle=[0,1e-6,-1e-6].some(dx=>[0,1e-6,-1e-6].some(dy=>{
    ray.ray.origin.copy(c.point).add(new THREE.Vector3(dx,dy,.1))
    return ray.intersectObject(untransformed).length>0
  }))
  assert.ok(onHandle,`Slot ${slot}: grip must be inside the original handle`)
  for(const vector of [[0,1,0],[0,-1,0],[.5,.8,.3],[-.5,-.8,-.3],[1,0,0],[.03,.2,.97]]) {
    for(const scale of [.45,1]) {
      grip.reset()
      const line=new THREE.Vector3(...vector).normalize()
      const wrists=[centre.clone().addScaledVector(line,-.018),centre.clone().addScaledVector(line,.018)]
      const expected=line.clone();if(expected.y<0)expected.negate()
      // Regression: tracking roll or an erroneous quarter-turn must NOT turn
      // the long handle perpendicular to the wrist line.
      const tracking=new THREE.Quaternion().setFromUnitVectors(up,line)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2))
      grip.update(centre,tracking,wrists,scale,1/30)
      grip.root.updateMatrixWorld(true)
      const worldGrip=model.localToWorld(c.point.clone())
      const q=model.getWorldQuaternion(new THREE.Quaternion())
      const worldAxis=c.axis.clone().applyQuaternion(q)
      assert.ok(worldAxis.dot(expected)>.999999,`Slot ${slot}: actual handle axis must match wrist vector`)
      assert.ok(worldGrip.distanceTo(centre)<1e-9,`Slot ${slot}: actual grip, not mesh origin, must be the midpoint`)
      const worldTip=model.localToWorld(c.tip.clone())
      assert.ok(worldTip.clone().sub(worldGrip).dot(expected)>.018,`Slot ${slot}: head/blade extends beyond upper hand`)
      const final=grip.root.quaternion.clone().multiply(c.baseRotation)
      assert.ok(final.angleTo(q)<1e-7,'Final rotation is tracking rotation × model base rotation')
      assert.ok(model.getWorldScale(new THREE.Vector3()).distanceTo(new THREE.Vector3(scale,scale,scale))<1e-9,'Existing size is unchanged')
      assert.equal(hash(model.geometry),original,'No geometry/UV/colour/index edits during pivot/orientation correction')
    }
  }
  model.geometry.dispose();model.material.dispose()
}
console.log('PASS: all 3 grip axes align for either upper hand, tilt/depth and erroneous 90° input; exact grip pivot, tip direction, scale and geometry preserved.')
