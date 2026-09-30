import * as THREE from 'three'
import { createGearModel, type GearSlot } from './minecraft-models'
import { GEAR_FOV, smoothGear, type GearTransform } from './minecraft-tracking3d'
import { EquipmentGrip } from './minecraft-grip'
import { assetUrl } from './asset-url'

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20]]

export class MinecraftGearStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(GEAR_FOV, 1, .025, 10)
  private models = new Map<GearSlot, THREE.Mesh>()
  private model: THREE.Mesh | null = null
  private grips = new Map<GearSlot,EquipmentGrip>()
  private grip: EquipmentGrip | null = null
  private current: GearTransform | null = null
  private depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide })
  private handMask = new THREE.Group()
  private joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6), this.depthMaterial, 42)
  private fingers = new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,6), this.depthMaterial, BONES.length*2)
  private palm: THREE.Mesh
  private head = new THREE.Mesh(new THREE.SphereGeometry(1,20,14), this.depthMaterial)
  private dummy = new THREE.Object3D()
  private delta = new THREE.Quaternion()
  private up = new THREE.Vector3(0,1,0)
  private point = new THREE.Vector3()
  private width = 0
  private height = 0
  private helmetTexture: THREE.Texture | null = null

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'minecraft-equipment'
    this.renderer.domElement.setAttribute('aria-hidden','true')
    parent.append(this.renderer.domElement)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x68757f, 2.1))
    const light = new THREE.DirectionalLight(0xfff3de, 2.3)
    light.position.set(-1,2,3)
    this.scene.add(light)
    const fill = new THREE.DirectionalLight(0x9edcff, .8)
    fill.position.set(2,.5,0)
    this.scene.add(fill)
    const palmGeometry = new THREE.BufferGeometry()
    palmGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30),3))
    palmGeometry.setIndex([0,1,2,0,2,3,0,3,4,5,6,7,5,7,8,5,8,9])
    this.palm = new THREE.Mesh(palmGeometry, this.depthMaterial)
    this.palm.frustumCulled = false
    for (const mesh of [this.joints,this.fingers,this.palm,this.head]) mesh.renderOrder = -10
    this.joints.frustumCulled = this.fingers.frustumCulled = false
    this.joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.fingers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.handMask.add(this.joints,this.fingers,this.palm)
    this.scene.add(this.handMask,this.head)
    this.hide()
  }

  select(slot: GearSlot) {
    this.hide()
    if (slot === 5 && !this.helmetTexture) {
      this.helmetTexture = new THREE.TextureLoader().load(assetUrl('/minecraft-equipment/helmet.png'),undefined,undefined,() => {
        const helmet=this.models.get(5)
        if (helmet) {
          const material=helmet.material as THREE.MeshStandardMaterial
          material.map=null; material.color.setHex(0x12b9b2); material.needsUpdate=true
        }
      })
      this.helmetTexture.colorSpace=THREE.SRGBColorSpace
      this.helmetTexture.magFilter=THREE.NearestFilter
      this.helmetTexture.minFilter=THREE.NearestMipmapNearestFilter
    }
    this.model = this.models.get(slot) ?? createGearModel(slot,this.helmetTexture ?? undefined)
    if (!this.model.geometry.boundingSphere) this.model.geometry.computeBoundingSphere()
    if (!this.models.has(slot)) {
      this.models.set(slot,this.model)
      if(slot===5)this.scene.add(this.model)
      else {
        const grip=new EquipmentGrip(this.model,slot)
        this.grips.set(slot,grip)
        this.scene.add(grip.root)
      }
    }
    this.grip=this.grips.get(slot)??null
    this.grip?.reset()
    this.model.visible = false
  }

  hide() {
    this.current = null
    this.grip?.reset()
    if (this.model) this.model.visible = false
    this.handMask.visible = this.head.visible = false
    if (!this.renderer.domElement.hidden) this.renderer.clear()
    this.renderer.domElement.hidden = true
  }

  render(target: GearTransform, seconds: number, width: number, height: number) {
    if (!this.model || width <= 0 || height <= 0) return
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height
      this.renderer.setSize(width,height,false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.current = null
    }
    const current = this.current = smoothGear(this.current,target,seconds)
    // Preserve perspective but cap extreme close-up enlargement so the small
    // hand-held tools don't fill/cross the entire camera viewport.
    const helmet = this.model.name === 'voxel-helmet'
    const radius = this.model.geometry.boundingSphere!.radius
    const focal = height / (2*Math.tan(THREE.MathUtils.degToRad(GEAR_FOV)/2))
    const screenScale = Math.min(width,height)*.52*Math.max(.12,-current.position.z)/(2*radius*focal)
    if(this.grip && current.wrists) {
      this.grip.update(current.position,current.rotation,current.wrists,Math.min(1,screenScale),seconds)
    } else {
      this.model.position.copy(current.position)
      this.model.quaternion.copy(current.rotation)
      this.model.scale.setScalar(1)
    }
    this.model.visible = true
    this.handMask.visible = target.hands.length>0
    this.head.visible = helmet
    if (target.hands.length) this.updateHands(target,current)
    else if (this.head.visible) {
      this.head.position.set(0,-.035,0).applyQuaternion(current.rotation).add(current.position)
      this.head.quaternion.copy(current.rotation)
      this.head.scale.set(.084,.105,.078)
    }
    this.renderer.domElement.hidden = false
    this.renderer.render(this.scene,this.camera)
  }

  private updateHands(target: GearTransform, current: GearTransform) {
    this.delta.copy(current.rotation).multiply(target.rotation.clone().invert())
    const vertices = this.palm.geometry.attributes.position as THREE.BufferAttribute
    const hands=target.hands.slice(0,2)
    this.joints.count=hands.length*21
    this.fingers.count=hands.length*BONES.length
    this.palm.geometry.setDrawRange(0,hands.length*9)
    hands.forEach((hand,index)=>{
      const points=hand.map(p=>p.clone().sub(target.position).applyQuaternion(this.delta).add(current.position))
      const radius=THREE.MathUtils.clamp(points[5].distanceTo(points[17])*.115,.005,.011)
      // Independent depth-only masks for BOTH hands, not just the old right hand.
      points.forEach((p,i)=>{
        this.dummy.position.copy(p); this.dummy.position.z+=radius*.45
        this.dummy.quaternion.identity();this.dummy.scale.setScalar(radius)
        this.dummy.updateMatrix();this.joints.setMatrixAt(index*21+i,this.dummy.matrix)
      })
      BONES.forEach(([a,b],i)=>{
        this.point.subVectors(points[b],points[a])
        const length=this.point.length()
        this.dummy.position.copy(points[a]).add(points[b]).multiplyScalar(.5)
        this.dummy.position.z+=radius*.45
        this.dummy.quaternion.setFromUnitVectors(this.up,length>1e-6?this.point.normalize():this.up)
        this.dummy.scale.set(radius*.86,Math.max(.001,length),radius*.86)
        this.dummy.updateMatrix();this.fingers.setMatrixAt(index*BONES.length+i,this.dummy.matrix)
      })
      ;[0,5,9,13,17].forEach((point,i)=>vertices.setXYZ(index*5+i,points[point].x,points[point].y,points[point].z+.004))
    })
    this.joints.instanceMatrix.needsUpdate = this.fingers.instanceMatrix.needsUpdate = true
    vertices.needsUpdate = true
  }

  dispose() {
    this.hide()
    this.models.forEach(model => { model.geometry.dispose(); (model.material as THREE.Material).dispose() })
    this.models.clear()
    this.grips.clear()
    this.grip=null
    for (const mesh of [this.joints,this.fingers,this.palm,this.head]) mesh.geometry.dispose()
    this.depthMaterial.dispose()
    this.helmetTexture?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
