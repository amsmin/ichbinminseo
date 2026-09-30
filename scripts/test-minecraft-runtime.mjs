import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
// Mirrors the real ESM loader: its global assignment only executes ONCE.
const loader=url(`function factory(){};globalThis.ModuleFactory=factory;export default factory;`)
const dependency=url(`export const FilesetResolver={forVisionTasks:async()=>({wasmLoaderPath:${JSON.stringify(loader)},wasmBinaryPath:'test.wasm'})}`)
const source=fs.readFileSync(new URL('../src/minecraft-vision-runtime.ts',import.meta.url),'utf8')
  .replace("'@mediapipe/tasks-vision'",JSON.stringify(dependency))
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {createVisionTask}=await import(url(compiled))
const statuses=[], order=[]
let active=0,maxActive=0
const create=name=>async files=>{
  active++;maxActive=Math.max(active,maxActive)
  assert.equal(typeof globalThis.ModuleFactory,'function',`${name}: factory must exist even after previous task cleared it`)
  assert.equal(files.wasmLoaderPath,'','Do not rely on cached loader side effects')
  assert.equal(files.wasmBinaryPath,'test.wasm','Keep real WASM binary path')
  await new Promise(resolve=>setTimeout(resolve,5))
  globalThis.ModuleFactory=undefined // Exact clearing behaviour of tasks-vision.
  order.push(name);active--;return name
}
assert.deepEqual(await Promise.all(['pose','hand','face'].map(name=>createVisionTask(`${name}:init`,create(name),s=>statuses.push(s)))),['pose','hand','face'])
assert.deepEqual(order,['pose','hand','face'])
assert.equal(maxActive,1,'Initialization must serialize the shared global factory')
assert.equal(statuses.filter(s=>s==='wasm:module').length,1)
const failure=new Error('real model failure')
await assert.rejects(createVisionTask('hand:init',async()=>{throw failure},s=>statuses.push(s)),error=>error===failure,'Real failures must propagate, not fall back')
assert.equal(await createVisionTask('face:init',create('face-again'),s=>statuses.push(s)),'face-again')
console.log('PASS: cached ESM factory restored for Pose/Hand/Face, initialization serialized, real errors preserved.')
