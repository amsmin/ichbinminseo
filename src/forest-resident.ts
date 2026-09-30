import * as THREE from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { ResidentAnalysis } from './forest-resident.types'

type Point = { x:number; y:number }
type Box = { left:number; top:number; right:number; bottom:number }
type Part = 'body'|'face'|'leftArm'|'rightArm'|'leftLeg'|'rightLeg'
type Segment = { a:Point; b:Point; width:number; part:Part }
type Region = { part:Part; box:Box }
export type ResidentModel = {
  group:THREE.Group
  mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>
  rest:Float32Array
  gait:Float32Array
  height:number
  mappedParts:string[]
  animate?:(now:number,moving:boolean)=>void
  dispose:()=>void
}

const clamp=(v:number,a=0,b=1)=>Math.min(b,Math.max(a,v))
const mix=(a:number,b:number,t:number)=>a+(b-a)*t

function bounds(points: Point[], padding=0):Box {
  return {left:clamp(Math.min(...points.map(p=>p.x))-padding),right:clamp(Math.max(...points.map(p=>p.x))+padding),
    top:clamp(Math.min(...points.map(p=>p.y))-padding),bottom:clamp(Math.max(...points.map(p=>p.y))+padding)}
}

function visible(p: NormalizedLandmark | undefined):p is NormalizedLandmark {
  return !!p && (p.visibility??1)>.55 && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1
}

function segments(pose: NormalizedLandmark[]):Segment[] {
  const chains:[Part,number[]][]=[['leftArm',[11,13,15]],['rightArm',[12,14,16]],['leftLeg',[23,25,27]],['rightLeg',[24,26,28]]]
  const width=visible(pose[11])&&visible(pose[12]) ? Math.hypot(pose[11].x-pose[12].x,pose[11].y-pose[12].y)*.25 : .055
  return chains.flatMap(([part,ids])=>ids.slice(0,-1).flatMap((id,i)=>visible(pose[id])&&visible(pose[ids[i+1]])
    ? [{part,a:pose[id],b:pose[ids[i+1]],width:Math.max(.025,width)}] : []))
}

function project(p:Point,segment:Segment) {
  const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y
  const length=Math.max(.001,Math.hypot(dx,dy))
  const t=clamp(((p.x-segment.a.x)*dx+(p.y-segment.a.y)*dy)/(length*length))
  const x=segment.a.x+dx*t,y=segment.a.y+dy*t
  return {t,offset:((p.x-x)*-dy+(p.y-y)*dx)/length/segment.width,distance:Math.hypot(p.x-x,p.y-y)/segment.width}
}

function shapeLayout(data:ResidentAnalysis) {
  const n=data.maskSize,mask=data.silhouette
  let minX=n,minY=n,maxX=0,maxY=0
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(mask[y*n+x]>.5) {minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
  if(maxX-minX<5||maxY-minY<5) throw new Error('입체로 만들 윤곽이 너무 작아요. 대상이 크게 나온 이미지를 넣어주세요.')
  const box={left:minX/n,right:maxX/n,top:minY/n,bottom:maxY/n}
  const point=(x:number,y:number)=>({x:mix(box.left,box.right,x),y:mix(box.top,box.bottom,y)})
  const rowRuns=(y:number)=>{
    const row=Math.round(mix(minY,maxY,y)),runs:{left:number;right:number}[]=[]
    let start=-1
    for(let x=minX;x<=maxX+1;x++) {
      if(x<=maxX&&mask[row*n+x]>.5) { if(start<0)start=x }
      else if(start>=0) { if(x-start>2)runs.push({left:(start-minX)/(maxX-minX),right:(x-minX)/(maxX-minX)}); start=-1 }
    }
    return runs
  }
  const lower=rowRuns(.83)
  const targetPose=data.referencePose
  const detectedBody=visible(targetPose[11])&&visible(targetPose[12])&&visible(targetPose[23])&&visible(targetPose[24])
  const aspect=(maxX-minX)*data.referenceWidth/((maxY-minY)*data.referenceHeight)
  // Geometric limb hints are not semantic animal recognition. Keep non-anatomical objects intact.
  const inferredBody=!detectedBody&&aspect<1.25&&lower.length===2&&lower[0].right<.57&&lower[1].left>.43
  const anatomy=detectedBody||inferredBody
  const targetSegments=detectedBody ? segments(targetPose) : []
  if(inferredBody) {
    for(const [index,part] of ['rightLeg','leftLeg'].entries()) {
      const center=(lower[index].left+lower[index].right)/2
      targetSegments.push({part:part as Part,a:point(center,.65),b:point(center,.98),width:(box.right-box.left)*.12})
    }
    const middle=rowRuns(.57)
    if(middle.length>=3) {
      targetSegments.push({part:'rightArm',a:point(.3,.46),b:point(.09,.64),width:(box.right-box.left)*.13})
      targetSegments.push({part:'leftArm',a:point(.7,.46),b:point(.91,.64),width:(box.right-box.left)*.13})
    }
  }
  let faceBox:Box|null=null
  if(detectedBody&&visible(targetPose[0])) {
    const ears=[targetPose[7],targetPose[8]].filter(visible)
    const w=ears.length===2?Math.abs(ears[0].x-ears[1].x)*1.45:(box.right-box.left)*.5
    faceBox=bounds([{x:targetPose[0].x-w*.5,y:targetPose[0].y-w*.65},{x:targetPose[0].x+w*.5,y:targetPose[0].y+w*.6}])
  } else if(inferredBody) faceBox=bounds([point(.18,.07),point(.82,.43)])
  return {box,aspect,anatomy,targetSegments,faceBox}
}

export function personSampler(data:ResidentAnalysis) {
  const {width:w,height:h,data:pixels}=data.person
  const nearest=new Int32Array(w*h).fill(-1),queue=new Int32Array(w*h)
  let tail=0,head=0,minX=w,minY=h,maxX=0,maxY=0
  for(let i=0;i<w*h;i++) if(pixels[i*4+3]>200) {
    nearest[i]=i;queue[tail++]=i
    const x=i%w,y=Math.floor(i/w)
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)
  }
  if(!tail) throw new Error('사람 텍스처가 비어 있어요. 다시 촬영해주세요.')
  // Bleed only known person pixels across UV seams and occluded areas. No background RGB is used.
  while(head<tail) {
    const i=queue[head++],x=i%w
    for(const next of [x>0?i-1:-1,x<w-1?i+1:-1,i-w,i+w]) if(next>=0&&next<w*h&&nearest[next]<0) {
      nearest[next]=nearest[i];queue[tail++]=next
    }
  }
  const box={left:minX/w,right:maxX/w,top:minY/h,bottom:maxY/h}
  const regions:Region[]=[]
  if(data.face.length) regions.push({part:'face',box:bounds(data.face,.015)})
  const torso=[11,12,23,24].map(i=>data.pose[i])
  if(torso.every(visible)) regions.push({part:'body',box:bounds(torso,.02)})
  const sample=(x:number,y:number)=>nearest[Math.round(clamp(y)*(h-1))*w+Math.round(clamp(x)*(w-1))]*4
  return {box,regions,segments:segments(data.pose),pixels,sample}
}

export function buildResident(data:ResidentAnalysis,name:string):ResidentModel {
  const layout=shapeLayout(data),source=personSampler(data)
  const {box}=layout
  const textureCanvas=document.createElement('canvas');textureCanvas.width=textureCanvas.height=512
  const context=textureCanvas.getContext('2d')!,image=context.createImageData(512,512)
  const mapped=new Set<string>()
  const torso=source.regions.find(r=>r.part==='body')?.box??source.box
  const face=source.regions.find(r=>r.part==='face')?.box
  const mapPoint=(p:Point)=>{
    const u=clamp((p.x-box.left)/(box.right-box.left)),v=clamp((p.y-box.top)/(box.bottom-box.top))
    let sx=mix(source.box.left,source.box.right,u),sy=mix(source.box.top,source.box.bottom,v)
    if(!layout.anatomy)return {x:sx,y:sy,baseX:sx,baseY:sy,weight:1}
    sx=mix(torso.left,torso.right,u);sy=mix(torso.top,torso.bottom,clamp((v-.4)/.38))
    const baseX=sx,baseY=sy
    const head=layout.faceBox
    if(head&&face&&p.x>=head.left&&p.x<=head.right&&p.y>=head.top&&p.y<=head.bottom) {
      mapped.add('얼굴')
      const faceU=(p.x-head.left)/(head.right-head.left),faceV=(p.y-head.top)/(head.bottom-head.top)
      const weight=clamp(Math.min(faceU,1-faceU,faceV,1-faceV)/.1)
      return {x:mix(face.left,face.right,faceU),y:mix(face.top,face.bottom,faceV),baseX,baseY,weight:weight*weight*(3-2*weight)}
    }
    let best=1.6
    for(const target of layout.targetSegments) {
      const hit=project(p,target)
      if(hit.distance>=best)continue
      const matching=source.segments.filter(segment=>segment.part===target.part)
      if(!matching.length)continue
      const targetChain=layout.targetSegments.filter(segment=>segment.part===target.part)
      const progress=(targetChain.indexOf(target)+hit.t)/targetChain.length*matching.length
      const segment=matching[Math.min(matching.length-1,Math.floor(progress))]
      const t=clamp(progress-Math.min(matching.length-1,Math.floor(progress)))
      const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y,len=Math.max(.001,Math.hypot(dx,dy))
      sx=mix(segment.a.x,segment.b.x,t)-dy/len*hit.offset*segment.width
      sy=mix(segment.a.y,segment.b.y,t)+dx/len*hit.offset*segment.width
      best=hit.distance
      mapped.add(target.part.includes('Arm')?'팔':'다리')
    }
    return {x:sx,y:sy,baseX,baseY,weight:best<1.6?clamp((1.6-best)/.5):1}
  }
  for(let y=0;y<512;y++)for(let x=0;x<512;x++) {
    const sample=mapPoint({x:x/511,y:y/511}),i=source.sample(sample.x,sample.y),base=source.sample(sample.baseX,sample.baseY),out=(y*512+x)*4
    for(let channel=0;channel<3;channel++)image.data[out+channel]=mix(source.pixels[base+channel],source.pixels[i+channel],sample.weight)
    image.data[out+3]=255
  }
  context.putImageData(image,0,0)
  const texture=new THREE.CanvasTexture(textureCanvas)
  texture.colorSpace=THREE.SRGBColorSpace
  texture.anisotropy=2
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:.82,metalness:0,side:THREE.DoubleSide})

  // Two curved surfaces meet at the extracted contour, forming a closed volumetric mesh.
  const n=data.maskSize,mask=data.silhouette,dist=new Float32Array(n*n)
  for(let i=0;i<dist.length;i++) dist[i]=mask[i]>.5?1000:0
  for(let y=1;y<n;y++)for(let x=1;x<n;x++) { const i=y*n+x;dist[i]=Math.min(dist[i],dist[i-1]+1,dist[i-n]+1,dist[i-n-1]+1.414) }
  for(let y=n-2;y>=0;y--)for(let x=n-2;x>=0;x--) { const i=y*n+x;dist[i]=Math.min(dist[i],dist[i+1]+1,dist[i+n]+1,dist[i+n+1]+1.414) }
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[],gait:number[]=[]
  const vertices=new Map<string,number>()
  const height=2.15,width=height*clamp(layout.aspect,.28,1.6)
  type Vertex={x:number;y:number;value:number;depth:number}
  const make=(x:number,y:number):Vertex=>({x,y,value:mask[y*n+x],depth:dist[y*n+x]})
  const index=(p:Vertex,side:number)=>{
    const key=`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.depth<.001?0:side}`
    const existing=vertices.get(key);if(existing!==undefined)return existing
    const px=p.x/n,py=p.y/n,u=(px-box.left)/(box.right-box.left),v=(py-box.top)/(box.bottom-box.top)
    const vy=layout.anatomy ? v<.44?v/.44*.53:.53+(v-.44)/.56*.47 : v
    const breadth=layout.anatomy ? mix(1.08,.87,clamp((v-.38)/.25)) : 1
    const depth=Math.min(.48,Math.sqrt(Math.max(0,p.depth)/(n*(box.right-box.left)))*1.1)
    const id=positions.length/3
    positions.push((u-.5)*width*breadth,(1-vy)*height,depth*side)
    uvs.push(px,1-py)
    let weight=0
    for(const segment of layout.targetSegments) if(project({x:px,y:py},segment).distance<1.8) {
      const sign=segment.part.startsWith('left')?1:-1
      weight=segment.part.includes('Leg')?sign*clamp((v-.64)/.36):segment.part.includes('Arm')?-sign*.45:0
    }
    gait.push(weight)
    vertices.set(key,id);return id
  }
  const triangle=(points:Vertex[])=>{
    const clipped:Vertex[]=[]
    for(let i=0;i<3;i++) {
      const a=points[i],b=points[(i+1)%3]
      if(a.value>=.5)clipped.push(a)
      if((a.value>=.5)!==(b.value>=.5)) {
        const t=(.5-a.value)/(b.value-a.value)
        clipped.push({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),value:.5,depth:0})
      }
    }
    for(const side of [1,-1])for(let i=1;i<clipped.length-1;i++) {
      const a=index(clipped[0],side),b=index(clipped[i],side),c=index(clipped[i+1],side)
      if(side===1)indices.push(a,c,b);else indices.push(a,b,c)
    }
  }
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++) {
    if(Math.max(mask[y*n+x],mask[y*n+x+1],mask[(y+1)*n+x],mask[(y+1)*n+x+1])<.5)continue
    const a=make(x,y),b=make(x+1,y),c=make(x+1,y+1),d=make(x,y+1)
    triangle([a,b,c]);triangle([a,c,d])
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere()
  const mesh=new THREE.Mesh(geometry,material),group=new THREE.Group()
  group.add(mesh)

  const label=document.createElement('canvas');label.width=512;label.height=96
  const labelContext=label.getContext('2d')!
  labelContext.fillStyle='#fffbed';labelContext.beginPath();labelContext.roundRect(8,8,496,80,40);labelContext.fill()
  labelContext.fillStyle='#345441';labelContext.textAlign='center';labelContext.textBaseline='middle';labelContext.font='600 30px sans-serif';labelContext.fillText(name,256,49,450)
  const labelTexture=new THREE.CanvasTexture(label);labelTexture.colorSpace=THREE.SRGBColorSpace
  const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture,depthTest:false}))
  tag.name='resident-name';tag.position.y=height+.3;tag.scale.set(1.8,.3375,1);group.add(tag)
  return {group,mesh,rest:new Float32Array(positions),gait:new Float32Array(gait),height,mappedParts:[...mapped],dispose:()=>{
    geometry.dispose();material.dispose();texture.dispose();labelTexture.dispose();tag.material.dispose();group.removeFromParent()
  }}
}

export function animateResident(model:ResidentModel,now:number,moving:boolean) {
  if(model.animate){model.animate(now,moving);return}
  if(!moving&&!model.mesh.userData.walking)return
  model.mesh.userData.walking=moving
  const position=model.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const wave=moving?Math.sin(now*.014):0
  for(let i=0;i<position.count;i++) position.setZ(i,model.rest[i*3+2]+model.gait[i]*wave*.23)
  position.needsUpdate=true
  model.mesh.rotation.z=moving?Math.sin(now*.007)*.025:0
}
