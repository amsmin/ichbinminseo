// Start Vite first. Run: node scripts/test-photobook-surface.mjs
// Optional: PHOTOBOOK_TEST_ORIGIN, CHROME_BIN. Uses an isolated headless browser.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const origin = process.env.PHOTOBOOK_TEST_ORIGIN || 'https://localhost:5173'
const profile = await mkdtemp(join(tmpdir(), 'lemon-paper-check-'))
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
let socket
const pending = new Map()
let id = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 15000)
    chrome.stderr.on('data', chunk => {
      stderr += chunk
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    chrome.once('error', reject)
    chrome.once('exit', code => { clearTimeout(timer); reject(Error(`Chrome exited ${code}`)) })
  })
  socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(key, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: key, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const shot = async () => { await frames(); return (await call('Page.captureScreenshot', { format: 'png' })).data }
  const sameFrame = async (before, after, label) => {
    if (before === after) return
    // Compare decoded pixels, not PNG encoding. GPU layer promotion can also
    // change a few antialiased edge pixels without moving the page at all.
    const difference = await evaluate(`(async()=>{
      const images=await Promise.all(${JSON.stringify([before, after])}.map(async data=>{
        const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();return image;
      }));
      const canvas=document.createElement('canvas');canvas.width=images[0].width;canvas.height=images[0].height;
      const context=canvas.getContext('2d');
      context.drawImage(images[0],0,0);const a=context.getImageData(0,0,canvas.width,canvas.height).data;
      context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(images[1],0,0);
      const b=context.getImageData(0,0,canvas.width,canvas.height).data;
      let changed=0,visible=0;
      for(let i=0;i<a.length;i+=4){
        const delta=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
        if(delta)changed++;if(delta>32)visible++;
      }
      return {changed,visible,total:canvas.width*canvas.height};
    })()`)
    console.log({ label, difference })
    const continuous = difference.visible / difference.total < 0.0001
    if (!continuous) {
      await writeFile(join(profile, 'before.png'), Buffer.from(before, 'base64'))
      await writeFile(join(profile, 'after.png'), Buffer.from(after, 'base64'))
      console.log('Failure frames:', profile)
    }
    assert.ok(continuous, label)
  }
  const begin = async direction => {
    await evaluate(`document.querySelector('#${direction}-button').click();window.turn=document.getAnimations()[0];turn.pause();turn.currentTime=0`)
    await frames()
  }
  const finish = async () => { await evaluate('turn.finish()'); await frames() }

  for (const dpr of [1, 1.25, 2]) {
    await call('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1024, deviceScaleFactor: dpr, mobile: false })
    await call('Page.navigate', { url: origin + '/?experience=photobook' })
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (await evaluate('!!document.querySelector("#next-button") && !document.querySelector("#next-button").disabled')) { ready = true; break }
      await delay(100)
    }
    assert.ok(ready, 'Book did not initialize')
    assert.equal(await evaluate('document.querySelectorAll(".paper-strip").length'), 0, 'DOM slices reintroduced')
    assert.equal(await evaluate('document.querySelectorAll(".paper-surface").length'), 14)
    await begin('next'); await finish()
    await evaluate(`(async()=>{
      const {createPaperMaterials}=await import('/src/photobook-material.ts');
      const image=new Image(); image.src='/book3.png'; await image.decode();
      const materials=await createPaperMaterials(image,[[639,241],[1126,93],[1454,598],[902,782]],[[4,3],[697,3],[697,597],[4,597]]);
      window.inkFixture=materials.front.getContext('2d').getImageData(0,0,1400,1200).data;
    })()`)
    const before = await shot()
    await begin('next')
    await sameFrame(before, await shot(), 'First sheet pops in at the start')
    for (const time of [0, 250, 400, 500]) {
      await evaluate(`turn.currentTime=${time}`); await frames()
      const result = await evaluate(`(()=>{
        const host=document.querySelector('[data-page="1"]');
        const canvas=host.querySelector('canvas'),gl=canvas.getContext('webgl');
        const pixels=new Uint8Array(canvas.width*canvas.height*4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        const projection=new DOMMatrix(document.querySelector('.cover-projection').style.transform);
        const p=Number(host.dataset.progress),edges=[[0,0]],lift=14+68*p;
        let x=0,z=0;
        for(let i=0;i<28;i++){
          const u=i/28,v=(i+1)/28,angle=-Math.PI*p+.82*Math.sin(Math.PI*p)*(u+v)/2;
          x+=Math.cos(angle)*25;z+=-Math.sin(angle)*25+lift*(Math.sin(Math.PI*v)-Math.sin(Math.PI*u));edges.push([x,z]);
        }
        let checked=0,missing=0;
        for(let y=80;y<520;y+=3)for(let u=150;u<650;u+=3){
          const source=((y*2)*1400+u*2)*4;
          if(inkFixture[source]>40||inkFixture[source+3]<250)continue;
          const i=Math.min(27,Math.floor(u/25)),t=(u-i*25)/25;
          const q=projection.transformPoint(new DOMPoint(edges[i][0]*(1-t)+edges[i+1][0]*t,y,edges[i][1]*(1-t)+edges[i+1][1]*t,1));
          const px=Math.round(q.x/q.w/1536*canvas.width),py=canvas.height-1-Math.round(q.y/q.w/1024*canvas.height);
          let dark=false;
          for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
            const at=((py+oy)*canvas.width+px+ox)*4;
            if(pixels[at]<150&&pixels[at+3]>200)dark=true;
          }
          checked++;if(!dark)missing++;
        }
        return {checked,missing,ratio:missing/checked,error:gl.getError()};
      })()`)
      assert.ok(result.checked > 300, 'Caption fixture is empty')
      assert.equal(result.error, 0)
      assert.ok(result.ratio < 0.015, `White bands at DPR ${dpr}, time ${time}: ${JSON.stringify(result)}`)
      console.log({ dpr, time, ...result })
    }
    const forwardMiddle = await shot()
    await finish()
    const secondBefore = await shot()
    await begin('next'); await sameFrame(secondBefore, await shot(), 'Second sheet pops in')
    await finish()
    await begin('previous'); await finish()
    await begin('previous'); await evaluate('turn.currentTime=500')
    await sameFrame(forwardMiddle, await shot(), 'Reverse turn changes the surface')
    await finish()
  }
  console.log('PASS: continuous caption at 3 display scales; first/second page continuity; reverse turn.')
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
}
