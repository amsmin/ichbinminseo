import * as THREE from 'three'
import { personSampler, type ResidentModel } from './forest-resident'
import type { ResidentAnalysis } from './forest-resident.types'

type Part='body'|'face'|'hair'|'muzzle'|'leftArm'|'rightArm'|'leftLeg'|'rightLeg'|'whole'
type V3=[number,number,number]
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v))

/** Shape parameters come from the selected object's silhouette, not a random character preset. */
function proportions(data:ResidentAnalysis) {
  const n=data.maskSize,mask=data.silhouette
  let left=n,right=0,top=n,bottom=0,sumX=0,sumY=0,count=0
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(mask[y*n+x]>.5){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);sumX+=x;sumY+=y;count++}
  if(!count)throw new Error('대상의 형태를 찾지 못했어요. 다른 이미지를 넣어주세요.')
  const width=right-left+1,height=bottom-top+1
  const rows:number[]=[]
  for(let i=0;i<20;i++){
    const y=Math.min(n-1,Math.round(top+(bottom-top)*i/19))
    let a=n,b=-1
    for(let x=left;x<=right;x++)if(mask[y*n+x]>.5){a=Math.min(a,x);b=Math.max(b,x)}
    rows.push(b>=a?(b-a+1)/width:0)
  }
  const headWidth=Math.max(...rows.slice(1,9)),bodyWidth=Math.max(.2,...rows.slice(9,16))
  return {rows,
    aspect:width*data.referenceWidth/(height*data.referenceHeight),
    head:clamp(headWidth/bodyWidth,.8,1.4),body:clamp(bodyWidth,.55,1),
    ear:clamp((1-(rows[1]+rows[2])/2)*1.3,.65,1.3),
    asymmetry:clamp((sumX/count-(left+right)/2)/width,-.15,.15),
    fullness:clamp(count/(width*height),.25,.85),
    center:clamp((sumY/count-top)/height,.3,.7),
  }
}

export function buildSculptedResident(data:ResidentAnalysis,name:string):ResidentModel {
  const kind=data.recognition?.kind??'human',shape=proportions(data),source=personSampler(data)
  const group=new THREE.Group(),rig=new THREE.Group();group.add(rig)
  const geometries=new Set<THREE.BufferGeometry>(),textures=new Set<THREE.Texture>(),materials=new Map<Part,THREE.MeshStandardMaterial>()
  const mapped=new Set<string>(),pivots:{group:THREE.Group;sign:number;axis:'x'|'z';amount:number}[]=[]
  let primary:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>|null=null
  const faceBox=source.regions.find(r=>r.part==='face')?.box
  const bodyBox=source.regions.find(r=>r.part==='body')?.box??source.box

  function material(part:Part) {
    const cached=materials.get(part);if(cached)return cached
    const canvas=document.createElement('canvas');canvas.width=canvas.height=part==='face'?256:128
    const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(canvas.width,canvas.height)
    let box=part==='whole'?source.box:bodyBox
    if(faceBox&&['face','hair','muzzle'].includes(part)) {
      box={...faceBox}
      const h=faceBox.bottom-faceBox.top
      if(part==='hair'){box.top=clamp(faceBox.top-h*.22,0,1);box.bottom=faceBox.top+h*.16}
      if(part==='muzzle'){box.top=faceBox.top+h*.55;box.bottom=faceBox.bottom}
      if(part==='face')mapped.add('얼굴')
    }
    const chain=source.segments.filter(segment=>segment.part===part)
    if(chain.length)mapped.add(part.includes('Arm')?'팔':'다리')
    if(part==='body'&&source.regions.some(r=>r.part==='body'))mapped.add('몸통')
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const u=x/(canvas.width-1),v=y/(canvas.height-1)
      let sx=box.left+(box.right-box.left)*u,sy=box.top+(box.bottom-box.top)*v
      if(chain.length){
        const progress=v*chain.length,index=Math.min(chain.length-1,Math.floor(progress)),t=Math.min(1,progress-index),segment=chain[index]
        const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y,len=Math.max(.001,Math.hypot(dx,dy))
        sx=segment.a.x+dx*t-dy/len*(u-.5)*segment.width*1.5
        sy=segment.a.y+dy*t+dx/len*(u-.5)*segment.width*1.5
      }
      const i=source.sample(sx,sy),out=(y*canvas.width+x)*4
      pixels.data[out]=source.pixels[i];pixels.data[out+1]=source.pixels[i+1];pixels.data[out+2]=source.pixels[i+2];pixels.data[out+3]=255
    }
    ctx.putImageData(pixels,0,0)
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.add(texture)
    const result=new THREE.MeshStandardMaterial({map:texture,roughness:.84,metalness:0})
    materials.set(part,result);return result
  }

  function mesh(geometry:THREE.BufferGeometry,part:Part,position:V3,scale:V3=[1,1,1],parent:THREE.Object3D=rig) {
    geometries.add(geometry)
    const result=new THREE.Mesh(geometry,material(part))
    result.position.set(...position);result.scale.set(...scale);parent.add(result)
    primary??=result
    return result
  }
  function ball(part:Part,p:V3,s:V3,parent:THREE.Object3D=rig) {
    const geometry=new THREE.SphereGeometry(1,24,16)
    // Project each body-part crop onto the volume instead of squeezing it around a longitude seam.
    const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv')
    for(let i=0;i<positions.count;i++)uv.setXY(i,clamp(positions.getX(i)*.5+.5,0,1),clamp(positions.getY(i)*.5+.5,0,1))
    return mesh(geometry,part,p,s,parent)
  }
  function head(p:V3,s:V3) {
    // Keep the person's face on the front; use cropped hair pixels on the rear hemisphere.
    const geometry=new THREE.SphereGeometry(1,32,24).toNonIndexed()
    const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv')
    const frontIndices:number[]=[],backIndices:number[]=[]
    for(let i=0;i<positions.count;i+=3){
      const front=(positions.getZ(i)+positions.getZ(i+1)+positions.getZ(i+2))/3>.23
      ;(front?frontIndices:backIndices).push(i,i+1,i+2)
      for(let j=0;j<3;j++)uv.setXY(i+j,clamp(positions.getX(i+j)*.62+.5,0,1),clamp(positions.getY(i+j)*.59+.5,0,1))
    }
    geometry.setIndex([...frontIndices,...backIndices]);geometry.clearGroups()
    geometry.addGroup(0,frontIndices.length,0);geometry.addGroup(frontIndices.length,backIndices.length,1)
    geometries.add(geometry)
    const result=new THREE.Mesh(geometry,[material('face'),material('hair')])
    result.position.set(...p);result.scale.set(...s);rig.add(result)
    return result
  }
  function tube(part:Part,points:V3[],radius:number) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),20,radius,8,false),part,[0,0,0])
  }
  function ear(p:V3,s:V3,tilt:number,pointed=false) {
    let result:THREE.Mesh
    if(pointed){
      const profile=[new THREE.Vector2(.12,-.2),new THREE.Vector2(.2,-.12),new THREE.Vector2(.18,.02),new THREE.Vector2(.11,.21),new THREE.Vector2(.015,.4),new THREE.Vector2(0,.42)]
      result=mesh(new THREE.LatheGeometry(profile,16),'hair',p,s)
    }else result=ball('hair',p,s)
    result.rotation.z=tilt
  }
  function limb(side:number,arm:boolean,x:number,y:number,length:number,width:number,wing=false) {
    const pivot=new THREE.Group();pivot.position.set(side*x,y,0);rig.add(pivot)
    const part:Part=arm?(side>0?'leftArm':'rightArm'):(side>0?'leftLeg':'rightLeg')
    const segment=ball(part,[0,-length*.5,0],[width,length*.62,wing?width*.45:width],pivot)
    segment.rotation.z=arm?-side*.18:0
    if(!arm)ball(part,[0,-length,.075],[width*1.16,width*.64,width*1.6],pivot)
    pivots.push({group:pivot,sign:side*(arm?-1:1),axis:wing?'z':'x',amount:wing?.25:.42})
  }

  const bodyWidth=.35+shape.body*.12,headWidth=.55+shape.head*.13,headY=1.62
  const mammal=['human','cat','dog','fox','rabbit','bear','squirrel','pig','cow','horse','deer','elephant'].includes(kind)
  if(mammal){
    ball('body',[0,.85,0],[bodyWidth,.52,.32+shape.fullness*.09])
    head([shape.asymmetry*.2,headY,0],[headWidth,kind==='horse'?.76:.64+shape.center*.07,.53+shape.fullness*.1])
    for(const side of [-1,1]){limb(side,false,.22,.47,.32,.14);limb(side,true,bodyWidth+.07,1.14,.4,.13)}
    if(kind==='human'){
      for(const side of [-1,1])ear([side*headWidth*.94,headY,.015],[.12,.18,.11],0)
      ball('hair',[0,headY+.47,-.1],[headWidth*.99,.28,.52])
    }else if(kind==='rabbit'){
      for(const side of [-1,1])ear([side*.36,headY+.82,0],[.17,.5*shape.ear,.14],-side*.13)
      ball('hair',[0,.6,-.45],[.22,.22,.2])
    }else if(kind==='cat'||kind==='fox'){
      for(const side of [-1,1])ear([side*headWidth*.69,headY+.52,0],[1.0,shape.ear,1],-side*.23,true)
      tube('hair',[[0,.55,-.28],[.3,.45,-.7],[.66,.85,-.8],[.57,1.12,-.67]],kind==='fox'?.17:.09)
    }else if(kind==='dog'){
      for(const side of [-1,1])ear([side*headWidth*.91,headY+.12,-.04],[.19,.4*shape.ear,.16],side*.18)
      ball('muzzle',[0,headY-.15,.48],[.3,.2,.24]);tube('hair',[[0,.55,-.3],[.16,.62,-.65],[.23,.92,-.7]],.08)
    }else if(kind==='bear'||kind==='squirrel'){
      for(const side of [-1,1])ear([side*headWidth*.75,headY+.54,-.02],[.23,.24*shape.ear,.16],0)
      ball('muzzle',[0,headY-.19,.47],[.3,.2,.18])
      if(kind==='squirrel')tube('hair',[[0,.45,-.35],[.45,.5,-.75],[.56,1.3,-.75],[.14,1.7,-.7],[-.13,1.36,-.63]],.22)
    }else if(kind==='pig'){
      for(const side of [-1,1])ear([side*.48,headY+.51,0],[1,.8,1],-side*.6,true)
      ball('muzzle',[0,headY-.1,.56],[.3,.23,.18]);tube('hair',[[0,.55,-.32],[.13,.58,-.57],[.24,.73,-.55],[.12,.82,-.55]],.045)
    }else if(kind==='elephant'){
      for(const side of [-1,1])ear([side*headWidth*.97,headY-.03,-.03],[.37,.45,.12],side*.1)
      tube('muzzle',[[0,headY,.52],[0,headY-.28,.7],[0,headY-.6,.75],[.22,headY-.71,.83]],.13)
    }else{
      for(const side of [-1,1])ear([side*headWidth*.87,headY+.31,0],[.24,.13,.12],side*.3)
      ball('muzzle',[0,headY-.25,.47],[kind==='horse'?.29:.37,.27,.27])
      if(kind==='cow'||kind==='deer')for(const side of [-1,1]){
        tube('hair',[[side*.38,headY+.49,0],[side*.5,headY+.76,-.03],[side*.58,headY+.91,.03]],.055)
        if(kind==='deer')tube('hair',[[side*.49,headY+.72,0],[side*.7,headY+.84,.03]],.042)
      }
      tube('hair',[[0,.52,-.3],[.16,.37,-.6],[.2,.22,-.64]],.065)
    }
  }else if(['bird','duck','penguin'].includes(kind)){
    ball('body',[0,.88,0],[kind==='penguin'?.53:.43,.65,.4])
    head([0,1.67,.04],[.57+shape.head*.08,.58,.51])
    if(kind==='duck')ball('muzzle',[0,1.5,.57],[.35,.13,.33])
    else{const beak=mesh(new THREE.ConeGeometry(.18,.36,16),'muzzle',[0,1.53,.64]);beak.rotation.x=Math.PI/2}
    for(const side of [-1,1]){limb(side,true,.46,1.18,.46,.21,true);limb(side,false,.23,.3,.16,.14)}
    ball('hair',[0,.69,-.48],[.17,.17,.32])
  }else if(kind==='frog'){
    ball('body',[0,.79,0],[.45,.47,.36]);head([0,1.48,0],[.76,.52,.52])
    for(const side of [-1,1]){ball('face',[side*.45,1.91,.15],[.25,.26,.23]);limb(side,true,.5,1,.4,.12);limb(side,false,.3,.44,.26,.16)}
  }else if(kind==='fish'){
    ball('whole',[0,1,0],[.76,.58,.42])
    head([.43,1.07,.04],[.41,.46,.4])
    const tail=mesh(new THREE.ConeGeometry(.45,.55,3),'whole',[-.86,1,0],[1,1,.4]);tail.rotation.z=-Math.PI/2
    ball('whole',[0,1.49,0],[.35,.23,.1]);ball('whole',[0,.55,.04],[.3,.18,.1])
  }else if(kind==='turtle'){
    ball('body',[0,.7,-.12],[.65,.55,.51]);head([0,1.23,.33],[.46,.43,.4])
    for(const side of [-1,1]){limb(side,true,.54,.91,.27,.15);limb(side,false,.33,.29,.16,.17)}
  }else if(kind==='octopus'){
    head([0,1.35,0],[.72,.75,.61])
    for(let i=0;i<8;i++){const a=i*Math.PI/4; tube('body',[[Math.cos(a)*.35,.85,Math.sin(a)*.3],[Math.cos(a)*.7,.4,Math.sin(a)*.55],[Math.cos(a)*.92,.27,Math.sin(a)*.73],[Math.cos(a)*1.04,.43,Math.sin(a)*.85]],.12)}
    ball('body',[0,.84,0],[.5,.3,.4])
  }else if(kind==='insect'){
    ball('body',[0,.7,-.08],[.39,.55,.31]);head([0,1.5,.02],[.56,.53,.44])
    for(const side of [-1,1]){
      tube('hair',[[side*.25,1.93,0],[side*.35,2.17,.02],[side*.49,2.22,.08]],.04)
      for(let i=0;i<3;i++)tube('body',[[side*.27,.95-i*.23,0],[side*.6,.86-i*.25,.02],[side*.75,.73-i*.27,.16]],.045)
      const wing=new THREE.Group();wing.position.set(side*.3,1.12,-.12);rig.add(wing)
      ball('body',[side*.31,0,-.08],[.42,.62,.07],wing)
      pivots.push({group:wing,sign:side,axis:'z',amount:.15})
    }
  }else if(kind==='vessel'){
    const profile=[new THREE.Vector2(0,0)]
    for(let i=19;i>=1;i--)profile.push(new THREE.Vector2(Math.max(.1,shape.rows[i]*.63),.12+(19-i)/18*1.75))
    const rim=profile[profile.length-1];profile.push(new THREE.Vector2(Math.max(.02,rim.x-.08),rim.y),new THREE.Vector2(Math.max(.02,rim.x-.1),rim.y-.2))
    mesh(new THREE.LatheGeometry(profile,32),'whole',[0,0,0])
    if(shape.aspect>.72){const handle=mesh(new THREE.TorusGeometry(.36,.085,10,24),'whole',[.61,1.05,0],[.8,1,1]);handle.rotation.y=.15}
  }else if(kind==='vehicle'){
    ball('whole',[0,.62,0],[.98,.42,.48]);ball('whole',[0,.98,-.08],[.6,.38,.4])
    for(const side of [-1,1])for(const x of [-.61,.61]){const wheel=mesh(new THREE.CylinderGeometry(.23,.23,.14,20),'whole',[x,.28,side*.44]);wheel.rotation.x=Math.PI/2}
  }else if(kind==='plant'){
    mesh(new THREE.CylinderGeometry(.33,.26,.53,24),'whole',[0,.3,0])
    tube('whole',[[0,.5,0],[shape.asymmetry,.96,0],[0,1.6,0]],.055)
    for(const side of [-1,1]){const leaf=ball('whole',[side*.29,1.06,0],[.38,.17,.09]);leaf.rotation.z=side*.45}
    for(let i=0;i<6;i++){const a=i*Math.PI/3;ball('whole',[Math.cos(a)*.28,1.65+Math.sin(a)*.28,0],[.26,.25,.12])}
    ball('whole',[0,1.65,.13],[.23,.23,.15])
  }else{
    ball('whole',[0,.82,0],[.65+shape.asymmetry,.7+shape.center*.3,.57])
    tube('whole',[[0,1.53,0],[.07,1.72,0],[.14,1.78,.02]],.04)
    const leaf=ball('whole',[.28,1.71,0],[.23,.08,.09]);leaf.rotation.z=.3
  }

  rig.updateMatrixWorld(true)
  const bounds=new THREE.Box3().setFromObject(rig),size=bounds.getSize(new THREE.Vector3()),height=2.15
  const scale=height/Math.max(.1,size.y)
  rig.scale.setScalar(scale);rig.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,0)
  const restY=rig.position.y
  const label=document.createElement('canvas');label.width=512;label.height=96
  const labelContext=label.getContext('2d')!
  labelContext.fillStyle='#fffbed';labelContext.beginPath();labelContext.roundRect(8,8,496,80,40);labelContext.fill()
  labelContext.fillStyle='#345441';labelContext.textAlign='center';labelContext.textBaseline='middle';labelContext.font='600 30px sans-serif';labelContext.fillText(name,256,49,450)
  const labelTexture=new THREE.CanvasTexture(label);labelTexture.colorSpace=THREE.SRGBColorSpace;textures.add(labelTexture)
  const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture,depthTest:false}));tag.name='resident-name';tag.position.y=height+.3;tag.scale.set(1.8,.3375,1);group.add(tag)
  return {group,mesh:primary!,rest:new Float32Array(),gait:new Float32Array(),height,mappedParts:[...mapped],
    animate:(now,moving)=>{
      const wave=moving?Math.sin(now*.014):0
      pivots.forEach(pivot=>{pivot.group.rotation[pivot.axis]=wave*pivot.sign*pivot.amount})
      rig.position.y=restY+(moving?Math.abs(wave)*.035:0)
      rig.rotation.z=moving?Math.sin(now*.007)*.025:0
    },
    dispose:()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());tag.material.dispose();group.removeFromParent()},
  }
}
