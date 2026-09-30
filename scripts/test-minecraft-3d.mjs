import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'

const read = name => fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
const url = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')
const three = source => source.replace("'three'", JSON.stringify(import.meta.resolve('three')))
const poseURL = url(read('minecraft-pose'))
const trackingURL = url(three(read('minecraft-tracking3d')).replace("'./minecraft-pose'", JSON.stringify(poseURL)))
const tracking = await import(trackingURL)
const modelURL = url(three(read('minecraft-models'))
  .replace("'three/addons/utils/BufferGeometryUtils.js'", JSON.stringify(import.meta.resolve('three/addons/utils/BufferGeometryUtils.js')))
  .replace("'./minecraft-voxel-data'", JSON.stringify(url(read('minecraft-voxel-data')))))
const { createGearModel } = await import(modelURL)
const { projectPose } = await import(poseURL)
const view = { left: 0, top: 0, width: 1280, height: 720, videoWidth: 1920, videoHeight: 1080 }
for (const v of [view, { ...view, width: 390, height: 844 }]) {
  const camera = new THREE.PerspectiveCamera(tracking.GEAR_FOV, v.width / v.height, .025, 10)
  for (const p of [{ x: .25, y: .5, z: -.1 }, { x: .6, y: .2, z: .1 }]) {
    const projected = tracking.cameraPoint(p, .8, 0, v).project(camera), expected = projectPose(p, v)
    assert.ok(Math.abs((projected.x + 1) * v.width / 2 - expected.x) < 1e-8)
    assert.ok(Math.abs((1 - projected.y) * v.height / 2 - expected.y) < 1e-8)
  }
}
for (const slot of [2, 3, 4, 5]) {
  const mesh = createGearModel(slot)
  mesh.geometry.computeBoundingBox()
  const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3())
  assert.ok(size.x > .025 && size.y > .1 && size.z > .025, `Slot ${slot} has solid geometry`)
  assert.equal(mesh.material.map, null, 'No PNG billboard')
  if (slot === 5) {
    assert.ok(size.x < .20 && size.y < .13, 'Helmet reduced to natural head proportions')
    mesh.updateMatrixWorld()
    const ray = new THREE.Raycaster(new THREE.Vector3(-.055, .008, 1), new THREE.Vector3(0,0,-1))
    const hits = ray.intersectObject(mesh)
    assert.ok(hits.length && hits[0].point.z < 0, 'Open face: only rear wall is hit')
    ray.set(new THREE.Vector3(-.055,.07,1), new THREE.Vector3(0,0,-1))
    assert.ok(ray.intersectObject(mesh)[0].point.z > .08, 'Solid forehead band')
  }
  mesh.geometry.dispose(); mesh.material.dispose()
}
const point = (x,y,z=0) => ({ x,y,z,visibility: 1 })
const pose = Array.from({ length: 33 }, () => point(.5,.5))
pose[16] = point(.7,.65); pose[14] = point(.7,.8); pose[15] = point(.54,.72)
pose[11] = point(.42,.35); pose[12] = point(.65,.35)
const hand = Array.from({ length: 21 }, (_,i) => point(.67 + i % 4 * .018,.55 - i % 3 * .018))
hand[0] = point(.7,.65); hand[5] = point(.65,.54); hand[9] = point(.7,.52); hand[13] = point(.72,.54); hand[17] = point(.75,.56)
const right = { points: hand, world: [], label: 'Left', score: .99 }
const left = { ...right, points: hand.map(p => ({ ...p, x: p.x - .16,y:p.y+.07 })), label: 'Right' }
const body = { pose, hands: [left,right], face: [] }
assert.ok(tracking.twoHandTransform({ ...body, pose: [] },view),'Both Hand wrists work when torso is cropped')
assert.equal(tracking.twoHandTransform({ ...body, pose: [],hands:[left] },view),null,'One left hand cannot hold the equipment alone')
assert.equal(tracking.twoHandTransform({ ...body, pose: [],hands:[right] },view),null,'One right hand cannot hold the equipment alone')
const missing=pose.map((p,i)=>i===15?{...p,visibility:0}:p)
assert.equal(tracking.twoHandTransform({ ...body, pose: missing,hands:[right] },view),null)
assert.ok(tracking.twoHandTransform({ ...body, hands: [] },view),'Both Pose wrists work with closed/occluded fingers')
const grip = tracking.twoHandTransform(body,view)
assert.ok(grip && Math.abs(grip.rotation.length()-1) < 1e-8)
assert.equal(grip.hands.length,2,'Both hands have occlusion geometry')
assert.ok(grip.position.distanceTo(grip.wrists[0].clone().add(grip.wrists[1]).multiplyScalar(.5))<1e-9,'Grip is exactly the two-wrist midpoint')
const axis=new THREE.Vector3(0,1,0).applyQuaternion(grip.rotation)
assert.ok(axis.dot(grip.wrists[1].clone().sub(grip.wrists[0]).normalize())>.99999,'Local handle axis joins the two wrists')
assert.ok(tracking.twoHandTransform({...body,hands:[right,left]},view).rotation.angleTo(grip.rotation)<1e-7,'Detection order never flips the grip')
const moved=pose.map((p,i)=>i===15?{...p,x:p.x+.04,z:p.z-.035}:p)
const movedGrip=tracking.twoHandTransform({...body,pose:moved},view)
assert.ok(movedGrip.position.distanceTo(grip.position)>.01,'Moving only left wrist moves the equipment')
assert.ok(movedGrip.rotation.angleTo(grip.rotation)>.05,'Wrist depth/tilt changes orientation')
const coincident=pose.map((p,i)=>i===15?pose[16]:p)
assert.equal(tracking.twoHandTransform({...body,pose:coincident,hands:[]},view),null,'Coincident wrists do not create an invalid rotation')
const expand = p => ({ ...p, x: .7+(p.x-.7)*1.4, y: .65+(p.y-.65)*1.4 })
assert.ok(tracking.twoHandTransform({ ...body, pose: pose.map(expand), hands: body.hands.map(h=>({...h,points:h.points.map(expand)})) },view).position.z > grip.position.z)
const face = Array.from({ length: 468 }, () => point(.5,.4))
face[33]=point(.44,.4); face[263]=point(.56,.4); face[10]=point(.5,.26); face[152]=point(.5,.64)
face[234]=point(.4,.44); face[454]=point(.6,.44)
const helmet = tracking.helmetTransform({ ...body, face },view)
assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(helmet.rotation).z > .99)
const yawed = face.map(p => ({ ...p, z: (p.x-.5)*.8 }))
assert.ok(tracking.helmetTransform({ ...body, face: yawed },view).rotation.angleTo(helmet.rotation) > .2)
const smooth = tracking.smoothGear(null,grip,1/60)
const target = { ...grip, position: grip.position.clone().add(new THREE.Vector3(.1,.1,.1)), rotation: helmet.rotation }
tracking.smoothGear(smooth,target,1/60)
assert.ok(smooth.position.distanceTo(grip.position)>0 && smooth.position.distanceTo(target.position)>0)
assert.ok(smooth.rotation.angleTo(target.rotation)<grip.rotation.angleTo(target.rotation))

// Controller uses a fake GPU/camera; geometry and tracking math above use real Three.js.
let time = 1000, next = 1, bitmapClosed = 0
Object.defineProperty(globalThis,'performance',{ value:{ now:()=>time },configurable:true })
const frames = new Map(), timers = new Map(), workers = []
globalThis.window = new EventTarget()
window.setTimeout = fn => { const id=next++; timers.set(id,fn); return id }
window.clearTimeout = id => timers.delete(id)
globalThis.requestAnimationFrame = fn => { const id=next++; frames.set(id,fn); return id }
globalThis.cancelAnimationFrame = id => frames.delete(id)
globalThis.Element = class { closest() { return null } }
globalThis.document = new EventTarget(); document.hidden = false
globalThis.Worker = class {
  messages=[]; terminated=false
  constructor() { workers.push(this) }
  postMessage(message) { this.messages.push(message) }
  terminate() { this.terminated=true }
}
globalThis.createImageBitmap = async () => ({ close() { bitmapClosed++ } })
const stageURL = url(`export class MinecraftGearStage {
  hidden=true; disposed=false;
  constructor(parent) { parent.append(this) }
  select(slot) { this.hide(); this.slot=slot }
  hide() { this.hidden=true }
  render(target) { this.hidden=false; this.target=target }
  dispose() { this.hide(); this.disposed=true }
}`)
const source = read('minecraft-equipment').replace("import './minecraft-equipment.css'", '')
  .replace("'./minecraft-selection'", JSON.stringify(url(read('minecraft-selection'))))
  .replace("'./minecraft-gear-stage'", JSON.stringify(stageURL))
  .replace("'./minecraft-tracking3d'", JSON.stringify(trackingURL))
  .replace("new URL('./minecraft-pose.worker.ts', import.meta.url)", "'pose-worker'")
const { MinecraftEquipment } = await import(url(source))
const children=[], notices=[]
const video={ readyState:2, videoWidth:1920, videoHeight:1080, currentTime:1, getBoundingClientRect:()=>view }
const equipment=new MinecraftEquipment({ append: el=>children.push(el) },video,text=>notices.push(text))
const key = digit => {
  const event=new Event('keydown',{ cancelable:true }); Object.assign(event,{ code:`Digit${digit}`,key:String(digit) }); window.dispatchEvent(event)
}
const frame = () => { time+=60; video.currentTime+=.06; const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(fn=>fn(time)) }
const flush = () => new Promise(resolve=>setImmediate(resolve))
const result = (worker,selection,values=body) => worker.onmessage({ data:{ type:'tracking',frame:values,timestamp:time,selection } })
const ready = (worker,mode) => worker.onmessage({ data:{ type:'ready',mode } })
equipment.start()
assert.equal(workers.length,0); assert.equal(children.length,0)
key(2)
const worker=workers[0], stage=children[0]
assert.equal(worker.messages[0].mode,'hand')
ready(worker,'hand'); key(3)
assert.equal(workers.length,1); assert.equal(children.length,1)
assert.equal(stage.slot,3); assert.equal(stage.hidden,true)
result(worker,1); frame(); await flush(); assert.equal(stage.hidden,true)
result(worker,2); frame(); await flush(); assert.equal(stage.hidden,false)
worker.onmessage({ data:{ type:'tracking',frame:body,timestamp:time-800,selection:2 } })
frame(); await flush(); assert.equal(stage.hidden,false,'Slow but newly received successful inference is displayed')
result(worker,2,{ pose:[],hands:[],face:[] }); frame(); assert.equal(stage.hidden,false)
for(let i=0;i<7;i++) frame()
assert.equal(stage.hidden,true,'Hide after tracking grace expires')
key(5)
assert.equal(stage.hidden,true); assert.equal(stage.slot,5)
assert.equal(worker.messages.at(-1).mode,'head')
ready(worker,'head'); result(worker,3,{ ...body,face }); frame(); await flush()
assert.equal(stage.hidden,false); assert.equal(stage.target.wrists,null)
key(6)
assert.equal(stage.hidden,true); assert.equal(frames.size,0)
assert.ok(worker.messages.some(m=>m.type==='dispose'))
for(const fn of timers.values()) fn(); timers.clear()
assert.equal(worker.terminated,true)
key(2)
const second=workers.at(-1); ready(second,'hand')
frame(); equipment.stop(); await flush()
assert.ok(bitmapClosed>0,'Late bitmap closes after shutdown')
assert.equal(stage.disposed,true)
equipment.start(); assert.equal(children.length,2)
document.hidden=true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(frames.size,0)
document.hidden=false; document.dispatchEvent(new Event('visibilitychange')); assert.ok(frames.size>0)
equipment.dispose()
const count=workers.length; key(4); assert.equal(workers.length,count)
assert.equal(children.at(-1).disposed,true)
console.log('PASS: solid geometry, hollow helmet, mirrored perspective, two-wrist midpoint/axis, both-hand occlusion data, missing-hand rejection, depth/rotation, smoothing, slot switching, grace time and disposal.')
