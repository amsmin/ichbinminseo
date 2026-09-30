import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ForestAdmission } from './forest-admission'
import { animateResident, buildResident as buildSilhouetteResident, type ResidentModel } from './forest-resident'
import { buildSculptedResident } from './forest-sculpture'
import type { ResidentAnalysis } from './forest-resident.types'
import './forest.css'

type Obstacle = { x:number; z:number; radius:number }
type Resident = { id:number; name:string; data:ResidentAnalysis; x:number; z:number; angle:number; model:ResidentModel|null }
type Arrival = { resident:Resident; startedAt:number; from:THREE.Vector3; to:THREE.Vector3; rotation:THREE.Quaternion }

function buildResident(data:ResidentAnalysis,name:string) {
  return data.recognition&&data.recognition.kind!=='object'
    ? buildSculptedResident(data,name)
    : buildSilhouetteResident(data,name)
}

export class ForestScene {
  private root:HTMLElement
  private view:HTMLElement
  private admission:ForestAdmission
  private reveal:HTMLElement
  private residentList:HTMLElement
  private renderer:THREE.WebGLRenderer|null=null
  private scene:THREE.Scene|null=null
  private camera:THREE.PerspectiveCamera|null=null
  private controls:OrbitControls|null=null
  private obstacles:Obstacle[]=[]
  private water:THREE.Mesh|null=null
  private active=false
  private keys=new Set<string>()
  private events:AbortController|null=null
  private resizeObserver:ResizeObserver|null=null
  private lastFrame=0
  private jumpVelocity=0
  private ground=.22
  private residents:Resident[]=[]
  private selected:Resident|null=null
  private arrival:Arrival|null=null
  private geometries=new Set<THREE.BufferGeometry>()
  private materials=new Map<string,THREE.MeshStandardMaterial>()
  private nextResidentId=1

  constructor(parent:HTMLElement) {
    this.root=document.createElement('section')
    this.root.className='forest-root'
    this.root.hidden=true
    this.root.innerHTML=`
      <div class="forest-view" aria-label="마우스로 회전하는 3D 마을"></div>
      <aside class="forest-postcard"><small>A LITTLE PLACE OF YOUR OWN</small><h2 class="forest-greeting">오늘부터, 우리 마을.</h2><p>드래그로 둘러보기 · 휠로 확대<br>방향키로 산책 · 스페이스로 점프</p></aside>
      <div class="forest-residents" aria-label="조작할 주민 선택"></div>
      <button class="forest-secondary forest-reset" type="button">시점 초기화 ↺</button>
      <div class="forest-actions"><button class="forest-primary forest-move-in" type="button"><span>＋</span> 입주하기</button><p>새로운 모습, 새로운 이웃.</p></div>
      <div class="forest-reveal" hidden><div><small>HELLO, NEW NEIGHBOR</small><h2></h2><p class="forest-reveal-detail"></p></div><p class="forest-arrival-hint">잠시 후 마을로 입주합니다.</p></div>`
    parent.append(this.root)
    this.view=this.root.querySelector('.forest-view')!
    this.reveal=this.root.querySelector('.forest-reveal')!
    this.residentList=this.root.querySelector('.forest-residents')!
    this.admission=new ForestAdmission(this.root,(data,name)=>this.addResident(data,name))
    this.root.querySelector('.forest-move-in')!.addEventListener('click',()=>{
      if(!this.active||this.arrival)return
      this.keys.clear()
      this.admission.open(this.nextResidentId)
    })
    this.root.querySelector('.forest-reset')!.addEventListener('click',()=>{if(!this.arrival)this.resetView()})
  }

  activate() {
    this.active=true;this.root.hidden=false
    try {
      this.build()
      this.residents.forEach(resident=>{
        resident.model=buildResident(resident.data,resident.name)
        resident.model.group.position.set(resident.x,this.ground,resident.z)
        resident.model.group.rotation.y=resident.angle
        resident.model.group.scale.setScalar(.9)
        this.scene!.add(resident.model.group)
      })
    }catch(error) {
      this.deactivate();this.root.hidden=false
      this.root.querySelector('.forest-greeting')!.textContent='3D 화면을 시작할 수 없어요.'
      console.error('Forest WebGL initialization failed',error)
      return
    }
    this.updateResidents()
    this.events=new AbortController()
    const signal=this.events.signal
    window.addEventListener('keydown',event=>{
      if(this.admission.dialog.open||this.arrival||!this.selected?.model||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))return
      event.preventDefault();this.keys.add(event.code)
      if(event.code==='Space'&&!event.repeat&&this.selected.model.group.position.y<=this.ground+.001)this.jumpVelocity=5.5
    },{signal})
    window.addEventListener('keyup',event=>this.keys.delete(event.code),{signal})
    window.addEventListener('blur',()=>this.keys.clear(),{signal})
    document.addEventListener('visibilitychange',()=>{this.keys.clear();this.lastFrame=0},{signal})
    this.resizeObserver=new ResizeObserver(()=>this.resize())
    this.resizeObserver.observe(this.view)
  }

  private material(color: string) {
    let material = this.materials.get(color)
    if (!material) { material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 }); this.materials.set(color, material) }
    return material
  }

  private mesh(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = this.scene!) {
    this.geometries.add(geometry)
    const mesh = new THREE.Mesh(geometry, this.material(color))
    mesh.position.set(x,y,z)
    parent.add(mesh)
    return mesh
  }

  private box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, parent?: THREE.Object3D) {
    return this.mesh(new THREE.BoxGeometry(w,h,d),color,x,y,z,parent)
  }

  private ball(radius: number, color: string, x: number, y: number, z: number, parent?: THREE.Object3D) {
    return this.mesh(new THREE.SphereGeometry(radius,12,8),color,x,y,z,parent)
  }

  private build() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#c7e5e7')
    this.scene.fog = new THREE.Fog('#c7e5e7',36,75)
    this.camera = new THREE.PerspectiveCamera(38,1,0.1,100)
    this.renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.view.append(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera,this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 12
    this.controls.maxDistance = 40
    this.controls.minPolarAngle = 0.35
    this.controls.maxPolarAngle = Math.PI * 0.46
    this.resetView()
    this.scene.add(new THREE.HemisphereLight('#fff8dd','#719876',2.7))
    const sun = new THREE.DirectionalLight('#fff0ce',3)
    sun.position.set(-10,18,8)
    this.scene.add(sun)
    this.box(23,1.4,20,'#bfa16b',0,-0.8,0)
    this.box(23,0.3,20,'#84bf68',0,0.05,0)
    // River cuts through the island; only the bridge is walkable.
    this.water = this.box(3.1,0.07,20.1,'#66c8d6',3.2,0.24,0)
    this.box(0.22,0.12,20,'#d4dca0',1.56,0.22,0)
    this.box(0.22,0.12,20,'#d4dca0',4.84,0.22,0)
    this.box(2,0.04,18,'#e0cc96',-2,0.23,0)
    this.box(18,0.04,1.9,'#e0cc96',0,0.24,2)
    for (let i=0;i<13;i++) this.box(0.3,0.22,2.15,'#c59b65',1.35+i*0.3,0.35,2)
    for (const z of [0.9,3.1]) {
      this.box(4,0.13,0.13,'#f1d7a0',3.2,1,z)
      for (const x of [1.35,3.2,5.05]) this.box(0.13,0.8,0.13,'#a57850',x,0.62,z)
    }
    this.house(-6,-5,'#e5b978','#c77457')
    this.house(8,-5,'#e9cf94','#658c9b')
    this.house(-6,6,'#e7cd9b','#7c9f78')
    const trees = [[-9,-8],[-3,-8],[0,-7],[6,-8],[10,-8],[-9,-1],[-6,-.5],[0,-2],[7,-.5],[10,0],[-9,8],[-1,7],[1,8],[7,7],[10,7],[-10,4]]
    trees.forEach(([x,z],index) => this.tree(x,z,index))
    for (let i=0;i<75;i++) {
      const x = Math.sin(i*127.1)*10.8, z = Math.cos(i*71.7)*9.2
      if (x>1.3&&x<5.2 || Math.abs(x+2)<1.3 || Math.abs(z-2)<1.3 || this.obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+0.4)) continue
      const flower = this.ball(0.085,['#fff4b9','#f4ada0','#ffdc69'][i%3],x,0.35,z)
      flower.scale.set(1.6,0.7,1.6)
      this.box(0.025,0.18,0.025,'#5c9859',x,0.28,z)
    }
    for(let i=0;i<12;i++) this.box(0.45+(i%3)*.18,0.012,0.045,'#b5e9e8',2.2+(i%3)*0.8,0.285,-8+i*1.5)
    for (let i=0;i<6;i++) {
      const cloud = new THREE.Group()
      cloud.position.set(-18+i*7,9+(i%2)*2,-15)
      this.scene.add(cloud)
      for(let j=0;j<3;j++) { const puff=this.ball(1,'#f7fcf5',j*1.1,Math.sin(j)*.25,0,cloud); puff.scale.set(1.4,.65,.7) }
    }
    this.mergeScenery()
    this.resize()
    this.lastFrame = 0
  }

  private mergeScenery() {
    if (!this.scene) return
    this.scene.updateMatrixWorld(true)
    const batches=new Map<THREE.Material, THREE.Mesh[]>()
    this.scene.traverse(object=>{
      if (!(object instanceof THREE.Mesh) || object===this.water || Array.isArray(object.material)) return
      const meshes=batches.get(object.material)??[]
      meshes.push(object)
      batches.set(object.material,meshes)
    })
    batches.forEach((meshes,material)=>{
      const pieces=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))
      const geometry=mergeGeometries(pieces)
      pieces.forEach(piece=>piece.dispose())
      if (!geometry) return
      meshes.forEach(mesh=>{ mesh.removeFromParent(); mesh.geometry.dispose(); this.geometries.delete(mesh.geometry) })
      this.geometries.add(geometry)
      this.scene!.add(new THREE.Mesh(geometry,material))
    })
  }

  private tree(x: number,z: number,index: number) {
    this.mesh(new THREE.CylinderGeometry(.18,.3,1.8,8),'#ad8054',x,1.05,z)
    for (let i=0;i<4;i++) {
      const angle=i*2.4
      this.ball(0.95,['#71ab5a','#83b960','#659f58'][index%3],x+Math.cos(angle)*.45,2+Math.sin(i)*.35,z+Math.sin(angle)*.4)
    }
    for (let i=0;i<3;i++) this.ball(.19,'#ed7853',x+Math.cos(i*2.1)*.82,2.25,z+Math.sin(i*2.1)*.82)
    this.obstacles.push({x,z,radius:.55})
    const shade=this.mesh(new THREE.CircleGeometry(1.4,16),'#75af5c',x,.215,z)
    shade.rotation.x=-Math.PI/2
  }

  private house(x: number,z: number,wall: string,roof: string) {
    this.box(3,2.35,2.65,wall,x,1.4,z)
    const top = this.mesh(new THREE.ConeGeometry(2.45,1.55,4),roof,x,3.25,z)
    top.rotation.y=Math.PI/4
    this.box(.75,1.3,.1,'#966346',x,.92,z+1.37)
    this.ball(.055,'#eecb79',x+.22,.98,z+1.45)
    for (const dx of [-.98,.98]) {
      this.box(.65,.72,.09,'#fff0cf',x+dx,1.6,z+1.37)
      this.box(.48,.55,.1,'#8ebfc2',x+dx,1.6,z+1.43)
      this.box(.045,.6,.11,'#fff0cf',x+dx,1.6,z+1.49)
    }
    this.box(1.4,.2,.65,'#b69c7b',x,.25,z+1.55)
    this.box(.45,.9,.45,'#c99473',x+.8,3.4,z-.5)
    this.obstacles.push({x,z,radius:2.05})
  }

  private resetView() {
    this.camera?.position.set(20,19,25)
    this.controls?.target.set(0,0.8,0)
    this.controls?.update()
  }

  private resize() {
    if (!this.renderer || !this.camera) return
    const {width,height}=this.view.getBoundingClientRect()
    this.renderer.setSize(width,height)
    this.camera.aspect=width/Math.max(height,1)
    this.camera.updateProjectionMatrix()
  }

  private addResident(data:ResidentAnalysis,name:string) {
    if(!this.active||!this.scene||!this.camera||!this.controls)return
    let spawn:THREE.Vector3|null=null
    for(let i=0;i<160;i++) {
      const radius=Math.sqrt(i)*.62,angle=i*2.39996
      const x=-2+Math.cos(angle)*radius,z=3.8+Math.sin(angle)*radius
      if(this.walkable(x,z)&&!this.residents.some(r=>Math.hypot(r.x-x,r.z-z)<1.05)){spawn=new THREE.Vector3(x,this.ground,z);break}
    }
    if(!spawn)throw new Error('입주할 빈 공간을 찾지 못했어요. 기존 주민을 이동한 뒤 다시 시도해주세요.')
    const model=buildResident(data,name)
    const resident:Resident={id:this.nextResidentId++,name,data,x:spawn.x,z:spawn.z,angle:this.controls.getAzimuthalAngle(),model}
    this.residents.push(resident);this.selected=resident;this.keys.clear();this.jumpVelocity=0
    const forward=this.camera.getWorldDirection(new THREE.Vector3())
    const up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion)
    const from=this.camera.position.clone().addScaledVector(forward,9).addScaledVector(up,-model.height*1.6*.5)
    model.group.position.copy(from);model.group.scale.setScalar(1.6);model.group.quaternion.copy(this.camera.quaternion)
    model.group.getObjectByName('resident-name')!.visible=false
    this.scene.add(model.group)
    this.arrival={resident,startedAt:performance.now(),from,to:spawn,rotation:this.camera.quaternion.clone()}
    this.controls.enabled=false
    this.root.classList.add('is-revealing')
    this.reveal.hidden=false
    this.reveal.querySelector('h2')!.textContent=`${name}님의 새로운 모습`
    const form=data.recognition?.source==='silhouette'?'윤곽을 살린 미니어처':`${data.recognition?.label??'나만의'} 미니어처`
    this.reveal.querySelector('.forest-reveal-detail')!.textContent=model.mappedParts.length
      ? `${form} · ${model.mappedParts.join(' · ')} 위치 반영`
      : `${form} · 사람 사진 텍스처`
    this.updateResidents()
  }

  private updateResidents() {
    this.residentList.replaceChildren()
    this.residentList.hidden=this.residents.length===0
    for(const resident of this.residents) {
      const button=document.createElement('button')
      button.type='button';button.className='forest-resident-chip'
      button.textContent=resident.name
      button.setAttribute('aria-pressed',String(resident===this.selected))
      button.addEventListener('click',()=>{
        if(this.arrival)return
        if(this.selected?.model){this.selected.model.group.position.y=this.ground;animateResident(this.selected.model,0,false)}
        this.selected=resident;this.keys.clear();this.jumpVelocity=0
        this.root.querySelector('.forest-greeting')!.textContent=`${resident.name}님과 산책 중`
        this.updateResidents()
      })
      this.residentList.append(button)
    }
  }

  private renderArrival(now:number) {
    const arrival=this.arrival
    if(!arrival?.resident.model)return
    const group=arrival.resident.model.group
    const elapsed=now-arrival.startedAt
    if(elapsed<2800) {
      const spin=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.sin(elapsed/1000)*.24)
      group.quaternion.copy(arrival.rotation).multiply(spin)
      return
    }
    const t=Math.min(1,(elapsed-2800)/1900)
    const ease=t*t*(3-2*t)
    group.position.lerpVectors(arrival.from,arrival.to,ease)
    group.position.y+=Math.sin(t*Math.PI)*1.1
    group.scale.setScalar(1.6+(.9-1.6)*ease)
    const target=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),arrival.resident.angle)
    group.quaternion.copy(arrival.rotation).slerp(target,ease)
    this.reveal.style.opacity=String(1-ease)
    if(t===1) {
      group.getObjectByName('resident-name')!.visible=true
      this.arrival=null;this.reveal.hidden=true;this.reveal.style.opacity=''
      this.root.classList.remove('is-revealing')
      this.controls!.enabled=true
      this.root.querySelector('.forest-greeting')!.textContent=`${arrival.resident.name}님, 입주를 환영해요!`
    }
  }

  render(now:number) {
    if(!this.active||!this.renderer||!this.scene||!this.camera||document.hidden)return
    if(this.lastFrame&&now-this.lastFrame<1000/30)return
    const dt=Math.min((now-(this.lastFrame||now))/1000,.05)
    this.lastFrame=now
    if(this.arrival)this.renderArrival(now)
    const model=this.selected?.model
    if(model&&!this.admission.dialog.open&&!this.arrival) {
      const dx=Number(this.keys.has('ArrowRight'))-Number(this.keys.has('ArrowLeft'))
      const dz=Number(this.keys.has('ArrowDown'))-Number(this.keys.has('ArrowUp'))
      const direction=new THREE.Vector3(dx,0,dz)
      let moved=false
      if(direction.lengthSq()>0) {
        direction.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),this.controls!.getAzimuthalAngle())
        const x=model.group.position.x+direction.x*3.3*dt,z=model.group.position.z+direction.z*3.3*dt
        if(this.walkable(x,model.group.position.z)){model.group.position.x=x;moved=true}
        if(this.walkable(model.group.position.x,z)){model.group.position.z=z;moved=true}
        model.group.rotation.y=Math.atan2(direction.x,direction.z)
      }
      animateResident(model,now,moved)
      this.jumpVelocity-=13*dt
      model.group.position.y=Math.max(this.ground,model.group.position.y+this.jumpVelocity*dt)
      if(model.group.position.y===this.ground)this.jumpVelocity=0
      this.selected!.x=model.group.position.x;this.selected!.z=model.group.position.z;this.selected!.angle=model.group.rotation.y
    }
    if(this.water)this.water.position.y=.24+Math.sin(now*.0015)*.009
    if(!this.arrival)this.controls?.update()
    this.renderer.render(this.scene,this.camera)
  }

  private walkable(x:number,z:number) {
    return Math.abs(x)<10.8&&Math.abs(z)<9.3&&!(x>1.3&&x<5.1&&Math.abs(z-2)>.7)
      &&!this.obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+.3)
  }

  deactivate() {
    this.active=false;this.admission.close();this.keys.clear()
    this.arrival=null;this.reveal.hidden=true;this.reveal.style.opacity=''
    this.root.classList.remove('is-revealing')
    this.events?.abort();this.resizeObserver?.disconnect();this.controls?.dispose()
    this.residents.forEach(resident=>{resident.model?.dispose();resident.model=null})
    this.geometries.forEach(geometry=>geometry.dispose());this.geometries.clear()
    this.materials.forEach(material=>material.dispose());this.materials.clear()
    this.renderer?.dispose();this.renderer?.forceContextLoss();this.renderer?.domElement.remove()
    this.renderer=null;this.scene=null;this.camera=null;this.controls=null;this.water=null
    this.obstacles=[];this.root.hidden=true
  }
}
