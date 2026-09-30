import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export const erenDialogues = [
  "한 마리도 남기지 않고… 구축해주겠어.",
  "나는 계속 나아갈 거야. …그러니까 비켜.",
  "자유를 위해서라면… 이 정도쯤은.",
  "모든 유미르의 백성들에게 고한다. 나의 이름은 에렌 예거.",
  "벽의 거인들은 이 섬 밖에 있는 모든 땅을 밟아 울릴 것이다.",
  "거기 있는 생명을, 이 세상에서 구축할 때까지.",
  "저 너머에 있는 적을 전부 없애면… 우리도 자유로워질까?",
  "멈출 생각 없어. 끝까지 간다.",
  "땅울림? 내가 시작했는데.",
  "오늘도 계속 전진한다.",
  "벽 밖에는 자유가 있다고 생각했어."
];

export class ErenConversation {
  private root: HTMLElement
  private bubble: HTMLButtonElement
  private text: HTMLElement
  private state: 'idle' | 'entering' | 'talking' | 'leaving' = 'idle'
  private time = 0
  private titan: THREE.Object3D | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private savedPosition = new THREE.Vector3()
  private savedTarget = new THREE.Vector3()
  private savedUp = new THREE.Vector3()
  private savedQuaternion = new THREE.Quaternion()
  private fromPosition = new THREE.Vector3()
  private fromTarget = new THREE.Vector3()
  private fromUp = new THREE.Vector3()
  private aim = new THREE.Vector3()
  private desiredPosition = new THREE.Vector3()
  private desiredTarget = new THREE.Vector3()
  private desiredUp = new THREE.Vector3()
  private previousFocus: HTMLElement | null = null
  private previousLine = -1

  constructor(root: HTMLElement) {
    this.root = root
    this.bubble = document.createElement('button')
    this.bubble.type = 'button'; this.bubble.className = 'eren-dialogue'; this.bubble.hidden = true
    this.bubble.setAttribute('aria-label', '에렌과 대화 종료')
    this.bubble.innerHTML = `<span class="eren-name">에렌</span><span class="eren-line" aria-live="polite"></span><span class="eren-continue" aria-hidden="true"></span>`
    this.text = this.bubble.querySelector('.eren-line')!
    root.append(this.bubble)
    this.bubble.addEventListener('click', () => this.close())
  }

  get active() { return this.state !== 'idle' }

  begin(titan: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    if (this.active) return
    // Drain only pending orbit inertia before taking a restorable snapshot.
    const damping = controls.enableDamping
    controls.enableDamping = false; controls.update(); controls.enableDamping = damping
    this.titan = titan; this.camera = camera; this.controls = controls
    this.savedPosition.copy(camera.position); this.savedTarget.copy(controls.target)
    this.savedUp.copy(camera.up); this.savedQuaternion.copy(camera.quaternion)
    this.fromPosition.copy(camera.position); this.fromTarget.copy(controls.target); this.fromUp.copy(camera.up)
    this.aim.copy(controls.target)
    controls.enabled = false
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Random selection with no immediate repeat when reopening a conversation.
    let index = Math.floor(Math.random() * (erenDialogues.length - (this.previousLine >= 0 ? 1 : 0)))
    if (this.previousLine >= 0 && index >= this.previousLine) index++
    this.previousLine = index; this.text.textContent = erenDialogues[index]!
    this.state = 'entering'; this.time = 0
    this.root.classList.add('is-conversing')
  }

  close() {
    if (this.state !== 'talking' && this.state !== 'entering') return
    this.bubble.classList.remove('is-visible')
    this.fromPosition.copy(this.camera!.position); this.fromTarget.copy(this.aim); this.fromUp.copy(this.camera!.up)
    this.state = 'leaving'; this.time = 0
  }

  update(delta: number, worldRadius: number) {
    if (!this.active || !this.camera || !this.controls || !this.titan) return false
    this.time += delta
    const camera = this.camera
    if (this.state === 'leaving') {
      const t = Math.min(1, this.time / 1.35), eased = t * t * (3 - 2 * t)
      camera.position.lerpVectors(this.fromPosition, this.savedPosition, eased)
      camera.up.lerpVectors(this.fromUp, this.savedUp, eased).normalize()
      this.aim.lerpVectors(this.fromTarget, this.savedTarget, eased)
      if (this.time > .3) this.bubble.hidden = true
      if (t === 1) { this.reset(); return true }
    } else {
      this.titan.updateWorldMatrix(true, false)
      this.desiredPosition.set(10, 12, Math.max(32, 22 / camera.aspect))
      this.desiredTarget.set(0, 3.5, 6)
      this.titan.localToWorld(this.desiredPosition); this.titan.localToWorld(this.desiredTarget)
      this.desiredUp.set(0, 1, 0).transformDirection(this.titan.matrixWorld)
      if (this.state === 'entering') {
        const t = Math.min(1, this.time / 1.65), eased = t * t * (3 - 2 * t)
        camera.position.lerpVectors(this.fromPosition, this.desiredPosition, eased)
        this.aim.lerpVectors(this.fromTarget, this.desiredTarget, eased)
        camera.up.lerpVectors(this.fromUp, this.desiredUp, eased).normalize()
        if (t === 1) {
          this.state = 'talking'; this.bubble.hidden = false
          // Flush the hidden layout before applying the entry transition.
          void this.bubble.offsetHeight
          this.bubble.classList.add('is-visible'); this.bubble.focus({ preventScroll: true })
        }
      } else {
        const blend = 1 - Math.exp(-4 * delta)
        camera.position.lerp(this.desiredPosition, blend)
        this.aim.lerp(this.desiredTarget, blend)
        camera.up.lerp(this.desiredUp, blend).normalize()
      }
    }
    // Prevent camera transitions cutting through the globe when clicking its far side.
    if (camera.position.length() < worldRadius + 4) camera.position.normalize().multiplyScalar(worldRadius + 4)
    camera.lookAt(this.aim)
    return true
  }

  reset() {
    if (this.active && this.camera && this.controls) {
      this.camera.position.copy(this.savedPosition); this.camera.up.copy(this.savedUp)
      this.camera.quaternion.copy(this.savedQuaternion)
      this.controls.target.copy(this.savedTarget); this.controls.enabled = true
      this.camera.updateMatrixWorld()
    }
    this.state = 'idle'; this.time = 0
    this.bubble.hidden = true; this.bubble.classList.remove('is-visible')
    this.root.classList.remove('is-conversing')
    this.previousFocus?.focus({ preventScroll: true }); this.previousFocus = null
    this.titan = null; this.camera = null; this.controls = null
  }
}
