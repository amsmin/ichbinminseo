// Uses an ALREADY RUNNING server; never starts Vite or accesses the real webcam.
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const origin = process.env.MINECRAFT_TEST_ORIGIN || 'https://localhost:5173'
const profile = await mkdtemp(join(tmpdir(),'lemon-camera-check-'))
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','--ignore-certificate-errors',
  '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader','about:blank',
],{stdio:['ignore','ignore','pipe']})
let socket
const pending=new Map(), listeners=new Map(); let id=0
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try {
  const endpoint=await new Promise((resolve,reject)=>{
    let stderr=''; const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),15000)
    chrome.stderr.on('data',chunk=>{stderr+=chunk; const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if(match){clearTimeout(timer);resolve(match[1])}})
    chrome.once('error',reject)
    chrome.once('exit',code=>{clearTimeout(timer);reject(Error(`Chrome exited ${code}: ${stderr}`))})
  })
  socket=new WebSocket(endpoint)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data)
    if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result)}}
    else for(const fn of listeners.get(message.method)??[]) fn(message.params,message.sessionId)
  })
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const key=++id, timer=setTimeout(()=>{pending.delete(key);reject(Error(`CDP timeout ${method}`))},20000)
    pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params,sessionId}))
  })
  const on=(name,fn)=>listeners.set(name,[...(listeners.get(name)??[]),fn])
  on('Runtime.consoleAPICalled',p=>{
    if(['error','warning','warn'].includes(p.type)) console.log('CONSOLE',p.type,p.args.map(a=>a.value??a.description).join(' '))
  })
  on('Runtime.exceptionThrown',p=>console.log('EXCEPTION',JSON.stringify(p.exceptionDetails)))
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  await send('Runtime.enable',{},sessionId)
  await send('Page.enable',{},sessionId)
  // Record original worker messages/errors without replacing its implementation.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__workerEvents=[];
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);
        this.addEventListener('message',e=>{
          const d=e.data;
          window.__workerEvents.push({type:d.type,mode:d.mode,stage:d.stage,message:d.message,stack:d.stack,
            frame:d.frame?{pose:d.frame.pose.length,hands:d.frame.hands.length,face:d.frame.face.length}:undefined});
          if(window.__workerEvents.length>400)window.__workerEvents.shift();
        });
        this.addEventListener('error',e=>window.__workerEvents.push({type:'native-error',message:e.message,filename:e.filename,line:e.lineno}));
      }
    };
  `},sessionId)
  await send('Page.navigate',{url:origin+'/?experience=minecraft'},sessionId)
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId)
    if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  for(let i=0;i<40;i++){if(await evaluate('!!document.querySelector("video")?.videoWidth'))break;await delay(250)}
  console.log('CAMERA',await evaluate('({width:document.querySelector("video")?.videoWidth,height:document.querySelector("video")?.videoHeight,error:document.querySelector(".minecraft-error")?.textContent})'))
  for(const slot of [2,5,3,4]){
    await evaluate(`window.__workerEvents=[];window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit${slot}',key:'${slot}',bubbles:true}))`)
    let result
    for(let i=0;i<100;i++){
      await delay(400)
      result=await evaluate('({events:window.__workerEvents,error:document.querySelector(".minecraft-error")?.textContent})')
      if(result.error||result.events.filter(e=>e.type==='tracking').length>=3)break
    }
    console.log('SLOT',slot,JSON.stringify(result))
    assert.equal(result.error,'',`Slot ${slot} failed`)
    assert.ok(result.events.some(e=>e.type==='tracking'),`Slot ${slot} produced no inference result`)
  }
  // Rapid mode changes while model creation is still pending share one Worker.
  await evaluate(`window.__workerEvents=[];for(const digit of [6,2,5,4])window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit'+digit,key:String(digit)}))`)
  let rapid
  for(let i=0;i<100;i++) {
    await delay(400)
    rapid=await evaluate('({events:window.__workerEvents,error:document.querySelector(".minecraft-error")?.textContent})')
    if(rapid.error||rapid.events.filter(e=>e.type==='tracking').length>=3)break
  }
  console.log('RAPID SWITCH',JSON.stringify(rapid))
  assert.equal(rapid.error,'')
  assert.ok(rapid.events.some(e=>e.type==='tracking'))
  // Real WebGL draws from synthetic paired wrist/finger data, independently of
  // the colour-bar webcam (which cannot validate real human detection quality).
  const rendered=await evaluate(`(async()=>{
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1',key:'1'}));
    const {MinecraftGearStage}=await import('/src/minecraft-gear-stage.ts');
    const {twoHandTransform}=await import('/src/minecraft-tracking3d.ts');
    const p=(x,y,z=0)=>({x,y,z,visibility:1});
    const pose=Array.from({length:33},()=>p(.5,.5));
    pose[11]=p(.42,.35);pose[12]=p(.65,.35);pose[15]=p(.48,.65);pose[16]=p(.54,.52);
    const hand=(w,label)=>({label,score:.99,world:[],points:Array.from({length:21},(_,i)=>i===0?w:p(w.x+(i%4-1.5)*.012,w.y-.06-(i%3)*.012))});
    const view={left:0,top:0,width:640,height:480,videoWidth:640,videoHeight:480};
    const stage=new MinecraftGearStage(document.body),out=[];
    try {for(const slot of [2,3,4]) for(const orientation of ['tilted','right-upper','left-upper']) {
      pose[15]=orientation==='tilted'?p(.48,.65):p(.5,orientation==='right-upper'?.68:.54);
      pose[16]=orientation==='tilted'?p(.54,.52):p(.5,orientation==='right-upper'?.54:.68);
      const hands=[hand(pose[15],'Right'),hand(pose[16],'Left')];
      const target=twoHandTransform({pose,hands,face:[]},view);
      if(!target)throw Error('Two-wrist fixture rejected');
      stage.select(slot);stage.render(target,1/30,640,480);
      const gl=stage.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
      const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])visible++;
      const calibration=stage.grip.calibration;
      const anchor=stage.model.localToWorld(calibration.point.clone());
      const axis=calibration.axis.clone().applyQuaternion(stage.model.getWorldQuaternion(target.rotation.clone()));
      const expected=target.wrists[1].clone().sub(target.wrists[0]).normalize();if(expected.y<0)expected.negate();
      out.push({slot,orientation,visiblePixels:visible,hands:target.hands.length,glError:gl.getError(),
        gripError:anchor.distanceTo(target.position),axisDot:axis.dot(expected)});
    }}finally{stage.dispose();}
    return out;
  })()`)
  console.log('WEBGL TWO-HAND RENDER',JSON.stringify(rendered))
  for(const r of rendered){assert.ok(r.visiblePixels>40);assert.equal(r.hands,2);assert.equal(r.glError,0);assert.ok(r.gripError<1e-8);assert.ok(r.axisDot>.99999)}
  console.log('PASS: real browser model init/inference, rapid reconfiguration, two-hand WebGL rendering (synthetic camera/landmarks; no real-person quality claim).')
} finally {
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Browser test ended'))}
  socket?.close();chrome.kill('SIGTERM')
}
