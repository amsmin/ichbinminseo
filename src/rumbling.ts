import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildRumblingTitan } from './rumbling-titan'
import { RumblingCapture } from './rumbling-capture'
import { createTitanFace, TitanSteam } from './rumbling-effects'
import { TitanSurfaceMotion } from './rumbling-motion'
import { buildWallTitan } from './rumbling-wall-titan'
import { RumblingArrival, ARRIVAL_REVEAL_START, ARRIVAL_END } from './rumbling-arrival'
import { RumblingTrail } from './rumbling-trail'
import { landscape } from './rumbling-landscape'
import { ErenConversation } from './rumbling-dialogue'
import './rumbling.css'

const R = 50
const WALK_SPEED = 2.4 // Heavy walking, ~3.7× faster without changing world scale.
const TAU = Math.PI * 2
const river = (longitude: number) => -.1 + .24 * Math.sin(longitude * 2 + .3) + .075 * Math.cos(longitude * 3 + .5)
const riverWidth = (longitude: number) => .145 + .035 * Math.sin(longitude * 3 - .6) + .018 * Math.cos(longitude * 5)
const normal = (lon: number, lat: number) => new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))

// One continuous, seeded world; no repeated city tiles or per-frame mesh generation.
export class RumblingScene {
  private root: HTMLElement
  private view: HTMLElement
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private observer: ResizeObserver | null = null
  private textures: THREE.Texture[] = []
  private dirty = true
  private lastFrame = 0
  private seed = 16092026
  private capture: RumblingCapture
  private phase: 'idle' | 'rising' | 'rumbling' = 'idle'
  private titan: THREE.Group | null = null
  private steam: TitanSteam | null = null
  private skyBlend = { value: 0 }
  private elapsed = 0
  private keys = new Set<string>()
  private events: AbortController | null = null
  private sunlight: THREE.DirectionalLight | null = null
  private ambient: THREE.HemisphereLight | null = null
  private motion = new TitanSurfaceMotion()
  private surfaceUp = new THREE.Vector3()
  private conversation: ErenConversation
  private raycaster = new THREE.Raycaster()
  private wallTitans: { root: THREE.Group; up: THREE.Vector3; steam: TitanSteam; offset: THREE.Vector3; distance: number; steps: number; left: THREE.Object3D; right: THREE.Object3D }[] = []
  private trail: RumblingTrail | null = null
  private arrival: RumblingArrival | null = null
  private flash: HTMLElement
  private flashStrength = 0
  private cameraRotation = new THREE.Quaternion()
  private reducedMotion = false

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section')
    this.root.className = 'rumbling-root'
    this.root.hidden = true
    this.root.innerHTML = `<div class="rumbling-view" aria-label="드래그로 회전하고 휠로 확대하는 서울 지구본"></div>
      <aside class="rumbling-caption"><small>SEOUL · A SMALL WORLD</small><h2>도시를 손안에.</h2><p>한강과 숲, 수천 개의 일상이 모인 작은 구.</p><span>서울의 풍경을 재구성한 상상 지도</span></aside>
      <div class="rumbling-tools"><p>드래그로 회전 · 휠 / 두 손가락으로 확대</p><button type="button" class="rumbling-reset">전체 보기 ↗</button></div>
      <button type="button" class="rumbling-start">땅울림 하기</button>
      <div class="rumbling-flash" aria-hidden="true"></div>`
    parent.append(this.root)
    this.view = this.root.querySelector('.rumbling-view')!
    this.flash = this.root.querySelector('.rumbling-flash')!
    this.root.querySelector('.rumbling-reset')!.addEventListener('click', () => this.fit())
    this.capture = new RumblingCapture(this.root, face => this.startRumbling(face))
    this.conversation = new ErenConversation(this.root)
    this.root.querySelector('.rumbling-start')!.addEventListener('click', () => {
      if (this.phase === 'idle' && this.renderer) void this.capture.open()
    })
  }

  private random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  activate() {
    if (this.renderer) return
    this.root.hidden = false
    this.seed = 16092026
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.scene = new THREE.Scene()
    this.trail = new RumblingTrail(R)
    this.scene.add(this.trail.group)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    this.view.append(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(38, 1, .1, 6000)
    this.ambient = new THREE.HemisphereLight(0xe4f2ff, 0x6c7562, 2.5)
    this.scene.add(this.ambient)
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.2)
    sun.position.set(-18, 25, 20)
    this.scene.add(sun)
    this.sunlight = sun
    this.buildWorld()
    this.buildSky(sun.position.clone().normalize())
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = .085
    this.controls.rotateSpeed = .6
    this.controls.zoomSpeed = .7
    this.controls.minDistance = R + 8
    this.controls.maxDistance = 110
    this.controls.addEventListener('change', () => { this.dirty = true })
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.view)
    this.resize()
    this.events = new AbortController()
    const signal = this.events.signal
    const canvas = this.renderer.domElement
    let press: { id: number; x: number; y: number; moved: boolean } | null = null
    canvas.addEventListener('pointerdown', event => {
      if (press) { press.moved = true; return }
      if (event.button !== 0) return
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }, { signal })
    canvas.addEventListener('pointermove', event => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true
    }, { signal })
    canvas.addEventListener('pointercancel', () => { press = null }, { signal })
    canvas.addEventListener('pointerup', event => {
      if (!press || press.id !== event.pointerId) return
      const clicked = !press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 6
      press = null
      if (clicked) this.pickFounder(event.clientX, event.clientY)
    }, { signal })
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.conversation.active) { event.preventDefault(); this.conversation.close() }
    }, { signal })
    window.addEventListener('keydown', event => {
      if (this.phase !== 'rumbling' || this.capture.dialog.open || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return
      event.preventDefault(); this.keys.add(event.code)
    }, { signal })
    window.addEventListener('keyup', event => { this.keys.delete(event.code) }, { signal })
    window.addEventListener('blur', () => this.keys.clear(), { signal })
    document.addEventListener('visibilitychange', () => { this.keys.clear(); this.lastFrame = 0 }, { signal })
  }

  private pickFounder(x: number, y: number) {
    if (this.phase !== 'rumbling' || !this.titan?.visible || !this.camera || !this.controls || !this.renderer || this.conversation.active || this.capture.dialog.open) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.scene!.updateMatrixWorld(true); this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera)
    const targets: THREE.Object3D[] = []
    this.titan.traverse(object => { if (object instanceof THREE.Mesh) targets.push(object) })
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return
    const globe = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), R), new THREE.Vector3())
    if (globe && globe.distanceTo(this.raycaster.ray.origin) < hit.distance - .05) return
    // A foreground wall titan must not trigger the founder's dialogue through its body.
    const walls: THREE.Object3D[] = []
    this.wallTitans.forEach(({ root }) => root.traverse(object => { if (object instanceof THREE.Mesh) walls.push(object) }))
    const wallHit = this.raycaster.intersectObjects(walls, false)[0]
    if (wallHit && wallHit.distance < hit.distance) return
    this.conversation.begin(this.titan, this.camera, this.controls)
    this.dirty = true
  }

  private texture(canvas: HTMLCanvasElement) {
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(4, this.renderer!.capabilities.getMaxAnisotropy())
    this.textures.push(texture)
    return texture
  }

  private startRumbling(face: HTMLCanvasElement) {
    if (!this.scene || this.phase !== 'idle') return
    const titan = buildRumblingTitan(R)
    titan.userData.titanKind = '시조의 거인'
    const faceMesh = createTitanFace(face)
    titan.add(faceMesh)
    this.textures.push(faceMesh.material.map!)
    this.steam = new TitanSteam()
    titan.add(this.steam.mesh)
    // Fixed world-space tangent frame: never faces or follows the camera.
    const longitude = -.35, latitude = .85
    const up = normal(longitude, latitude)
    const east = new THREE.Vector3(Math.cos(longitude), 0, -Math.sin(longitude))
    const facing = new THREE.Vector3().crossVectors(east, up).normalize()
    titan.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, facing))
    // Its highest bones start below the ground. No model exists in the idle scene.
    titan.position.copy(up).multiplyScalar(R - 31)
    titan.visible = false
    this.titan = titan
    this.scene!.add(titan)
    this.addWallTitans(up, east, facing, titan.quaternion)
    this.arrival = new RumblingArrival(R, titan.quaternion)
    this.scene.add(this.arrival.group)
    this.phase = 'rising'; this.elapsed = 0; this.dirty = true
    const button = this.root.querySelector<HTMLButtonElement>('.rumbling-start')!
    button.disabled = true; button.textContent = '땅울림이 시작됩니다…'
  }

  private addWallTitans(baseUp: THREE.Vector3, right: THREE.Vector3, forward: THREE.Vector3, orientation: THREE.Quaternion) {
    const template = buildWallTitan()
    // Every member is ahead of the founder (+Z), with distinct lateral/forward slots.
    const offsets = [[-13, 15], [-4, 17], [6, 14], [15, 19], [-20, 25], [-10, 27], [1, 26], [12, 30], [-15, 37], [7, 38]]
    offsets.forEach(([x, z], index) => {
      const up = baseUp.clone().multiplyScalar(R).addScaledVector(right, x!).addScaledVector(forward, z!).normalize()
      const root = template.clone(true)
      root.name = `wall-titan-${index + 1}`
      root.userData.titanKind = '벽거인'
      root.quaternion.copy(orientation).premultiply(new THREE.Quaternion().setFromUnitVectors(baseUp, up))
      root.scale.setScalar(.88 + (index % 4) * .055)
      root.position.copy(up).multiplyScalar(R - 13)
      root.visible = false
      const steam = new TitanSteam()
      steam.mesh.scale.set(.19, .48, .2)
      steam.mesh.position.z = .4
      root.add(steam.mesh)
      this.wallTitans.push({ root, up, steam, offset: new THREE.Vector3(x!, R, z!), distance: 0, steps: 0,
        left: root.getObjectByName('left-leg')!, right: root.getObjectByName('right-leg')! })
      this.scene!.add(root)
    })
    // The clones intentionally share the template's three geometries/materials.
    template.clear()
  }

  private moveHerd() {
    if (!this.titan) return
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.titan.quaternion)
    const side = new THREE.Vector3(), facing = new THREE.Vector3(), basis = new THREE.Matrix4()
    const sample = new THREE.Vector3(), foot = new THREE.Vector3()
    for (const member of this.wallTitans) {
      const previous = member.root.position.clone()
      member.up.copy(member.offset).normalize().applyQuaternion(this.titan.quaternion)
      member.root.position.copy(member.up).multiplyScalar(R)
      facing.copy(forward).addScaledVector(member.up, -forward.dot(member.up)).normalize()
      side.crossVectors(member.up, facing).normalize()
      member.root.quaternion.setFromRotationMatrix(basis.makeBasis(side, member.up, facing))
      const distance = previous.distanceTo(member.root.position)
      if (distance < 1e-6) continue
      // Sweep the entire body path, including long lateral travel during a turn.
      const samples = Math.max(1, Math.ceil(distance / .5))
      for (let i = 1; i <= samples; i++) {
        sample.lerpVectors(previous, member.root.position, i / samples).normalize().multiplyScalar(R)
        this.trail?.crush(sample, 1.9 * member.root.scale.x)
      }
      member.distance += distance
      const phase = member.distance / 2.1 * Math.PI
      member.left.rotation.x = Math.sin(phase) * .19
      member.right.rotation.x = -Math.sin(phase) * .19
      member.root.updateMatrixWorld(true)
      const steps = Math.floor(member.distance / 2.1)
      if (steps > member.steps) {
        const left = steps % 2 === 0
        const leg = left ? member.left : member.right
        foot.set(left ? -.05 : .05, -4.96, .25)
        leg.localToWorld(foot)
        this.trail?.stamp(foot, member.root.quaternion, member.root.scale.x * 1.35, left)
        member.steps = steps
      }
    }
    this.trail?.flush()
  }

  private buildSky(sunDirection: THREE.Vector3) {
    // World-space sky: orbiting changes the sun/horizon direction, not a screen overlay.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { sunDirection: { value: sunDirection }, rumbling: this.skyBlend },
      vertexShader: `varying vec3 skyPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          skyPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `uniform vec3 sunDirection; uniform float rumbling;
        varying vec3 skyPosition;
        void main() {
          vec3 direction = normalize(skyPosition - cameraPosition);
          float elevation = abs(direction.y);
          vec3 sky = mix(vec3(.36,.65,.88), vec3(.018,.16,.48), pow(elevation,.48));
          float sunlight = max(dot(direction, sunDirection), 0.0);
          sky += vec3(.36,.34,.24) * pow(sunlight, 18.0);
          sky += vec3(1.5,1.35,1.05) * pow(sunlight, 650.0);
          vec3 redSky = mix(vec3(.24,.036,.023), vec3(.022,.006,.014), pow(elevation,.55));
          redSky += vec3(.26,.035,.009) * pow(sunlight,28.0);
          sky = mix(sky, redSky, rumbling);
          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }))
    sky.renderOrder = -1
    this.scene!.add(sky)

    // Actual shaded geometry, not camera-facing cloud cards. One instanced draw call.
    const clusters = 46, lobes = 9
    const clouds = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshStandardMaterial({ color: '#eff7ff', roughness: 1 }),
      clusters * lobes,
    )
    const transform = new THREE.Object3D()
    const up = new THREE.Vector3(0, 1, 0)
    for (let cluster = 0; cluster < clusters; cluster++) {
      const lon = cluster * 2.3999632297
      const lat = Math.asin(1 - 2 * (cluster + .5) / clusters)
      const outward = normal(lon, lat)
      const orientation = new THREE.Quaternion().setFromUnitVectors(up, outward)
      const center = outward.clone().multiplyScalar(600 + this.random() * 160)
      const size = 15 + this.random() * 18
      for (let lobe = 0; lobe < lobes; lobe++) {
        const offset = new THREE.Vector3((this.random() - .5) * size * 4, (this.random() - .5) * size * .5, (this.random() - .5) * size * 1.5)
        transform.position.copy(offset.applyQuaternion(orientation)).add(center)
        transform.quaternion.copy(orientation)
        const radius = size * (.55 + this.random() * .65)
        transform.scale.set(radius * 1.5, radius * .6, radius)
        transform.updateMatrix()
        clouds.setMatrixAt(cluster * lobes + lobe, transform.matrix)
      }
    }
    clouds.computeBoundingSphere()
    this.scene!.add(clouds)
  }

  private facade(glass: boolean, floors = 21) {
    const canvas = document.createElement('canvas')
    canvas.width = 128; canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = glass ? '#9aabb2' : '#e4e2dc'; ctx.fillRect(0, 0, 128, 256)
    const rowHeight = 256 / floors
    for (let y = 3; y < 256; y += rowHeight) {
      for (let x = 3; x < 128; x += glass ? 16 : 32) {
        const light = 65 + Math.floor(this.random() * 65)
        ctx.fillStyle = `rgb(${light},${light + 14},${light + 21})`
        ctx.fillRect(x, y, glass ? 13 : 12, rowHeight * .65)
        ctx.fillStyle = '#ffffff38'; ctx.fillRect(x, y, 1, rowHeight * .65)
      }
      ctx.fillStyle = '#59636a25'; ctx.fillRect(0, y + rowHeight * .8, 128, 1)
    }
    return this.texture(canvas)
  }

  private buildWorld() {
    const scene = this.scene!
    const ground = document.createElement('canvas')
    ground.width = 2048; ground.height = 1024
    const ctx = ground.getContext('2d')!
    ctx.fillStyle = '#dad8cf'; ctx.fillRect(0, 0, ground.width, ground.height)
    for (let i = 0; i < 22000; i++) {
      ctx.fillStyle = ['#c5c4bd', '#e4e0d5', '#babeb5', '#d2d2c8'][i % 4]!
      ctx.fillRect(this.random() * 2048, this.random() * 1024, 1 + this.random() * 4, 1 + this.random() * 3)
    }
    const terrain = new THREE.SphereGeometry(R, 192, 128)
    const vertices = terrain.getAttribute('position'), colors = new Float32Array(vertices.count * 3)
    const earth = new THREE.Color('#b5b58b'), forest = new THREE.Color('#658441'), shade = new THREE.Color()
    for (let i = 0; i < vertices.count; i++) {
      const field = landscape(vertices.getX(i) / R, vertices.getY(i) / R, vertices.getZ(i) / R)
      shade.copy(earth).lerp(forest, THREE.MathUtils.smoothstep(field.green, .36, .64))
      shade.toArray(colors, i * 3)
    }
    terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    scene.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ map: this.texture(ground), vertexColors: true, roughness: 1 })))

    const roadMat = new THREE.MeshStandardMaterial({ color: '#747b7b', roughness: 1 })
    const bankMat = new THREE.MeshStandardMaterial({ color: '#8b9e62', roughness: 1 })
    const waterMat = new THREE.MeshStandardMaterial({ color: '#286675', roughness: .26, metalness: .32 })
    const embankment = new THREE.MeshStandardMaterial({ color: '#c9ba93', roughness: 1 })
    // Spherical strips follow the surface, including across the longitude seam.
    const ribbon = (path: (t: number) => [number, number], width: number | ((t: number) => number), material: THREE.Material, radius: number, steps = 384) => {
      const positions: number[] = [], indices: number[] = []
      // Wide water needs cross-river subdivisions, otherwise its flat triangles
      // cut through the sphere and leave only thin shoreline strips visible.
      const across = typeof width === 'number' && width < .02 ? 1 : 24
      for (let i = 0; i <= steps; i++) {
        const [lon, lat] = path(i / steps)
        const halfWidth = typeof width === 'number' ? width : width(i / steps)
        for (let j = 0; j <= across; j++) positions.push(...normal(lon, lat + halfWidth * (j / across * 2 - 1)).multiplyScalar(radius).toArray())
        if (i < steps) for (let j = 0; j < across; j++) {
          const a = i * (across + 1) + j, b = a + across + 1
          indices.push(a, a + 1, b, a + 1, b + 1, b)
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setIndex(indices); geometry.computeVertexNormals()
      // Path direction varies, so surface strips are explicitly double-sided.
      material.side = THREE.DoubleSide
      scene.add(new THREE.Mesh(geometry, material))
    }
    ribbon(t => { const lon = t * TAU; return [lon, river(lon)] }, t => riverWidth(t * TAU) + .065, bankMat, R + .015)
    ribbon(t => { const lon = t * TAU; return [lon, river(lon)] }, t => riverWidth(t * TAU) + .009, embankment, R + .02)
    ribbon(t => { const lon = t * TAU; return [lon, river(lon)] }, t => riverWidth(t * TAU), waterMat, R + .035)
    for (const side of [-1, 1]) ribbon(t => { const lon = t * TAU; return [lon, river(lon) + side * (riverWidth(lon) + .052)] }, .005, roadMat, R + .025)
    for (let district = 0; district < 16; district++) {
      const longitude = district * 2.39996, latitude = -.9 + (district % 5) * .4
      ribbon(t => [longitude + t * .45, latitude + .014 * Math.sin(t * 8 + district)], .003, roadMat, R + .014, 40)
    }

    type Placement = { lon: number; lat: number; width: number; height: number; depth: number; color: THREE.Color; turn: number }
    const blocks: Placement[][] = [[], [], [], [], []]
    const trees: Placement[] = []
    const palette = ['#d6d5cf', '#b6bdc0', '#e0ddd3', '#a9b7bd', '#c2c7c4', '#bdb5a8']
    const count = 62000 // Dense urban corridors, with hills/parks and streets explicitly excluded.
    const hills = [
      { lon: .12, lat: .62, width: .23, height: 2.5 }, // Namsan
      { lon: -.58, lat: .99, width: .26, height: 4.2 },
      { lon: .73, lat: 1.04, width: .25, height: 3.8 },
      { lon: -1.1, lat: -.95, width: .3, height: 3.1 },
      { lon: 1.55, lat: -.75, width: .27, height: 3.6 },
      { lon: 2.45, lat: .78, width: .29, height: 4.1 },
      { lon: 3.6, lat: -.68, width: .25, height: 3.2 },
      { lon: 4.8, lat: .85, width: .26, height: 3.8 },
    ].map(hill => ({ ...hill, up: normal(hill.lon, hill.lat) }))
    const districts = [
      [-.42, -.43, .27, 1], [.66, -.29, .23, 1], [-.1, .37, .2, 1],
      [.72, .45, .25, 0], [-.65, .37, .23, 0], [.22, -.62, .26, 0],
      [-1.1, .2, .3, 4], [1.35, .39, .29, 4], [1.9, -.5, .26, 0],
      [2.6, .1, .31, 4], [3.4, .53, .29, 1], [4.2, -.42, .3, 0], [5.1, -.38, .31, 4],
    ].map(([lon, lat, radius, kind]) => ({ up: normal(lon!, lat!), radius: radius!, kind: kind! }))
    const hillHeight = (u: number, v: number, height: number) => {
      const edge = Math.max(0, 1 - u * u - v * v)
      const ridge = .72 * Math.exp(-((u + .12) ** 2 * 5 + (v - .04) ** 2 * 17))
        + .36 * Math.exp(-((u - .36) ** 2 * 20 + (v + .2) ** 2 * 7))
        + .26 * Math.exp(-((u + .35) ** 2 * 18 + (v + .28) ** 2 * 12))
      return height * .8 * edge ** 2 * ridge * (1 + .08 * Math.sin(u * 19) * Math.cos(v * 15))
    }
    // Rectangular terrain patches with asymmetric ridges, zero-height feathered edges.
    // This is not a scaled sphere/hemisphere: it shares the globe's base curvature.
    for (const hill of hills) {
      const geometry = new THREE.PlaneGeometry(2, 2, 48, 48)
      const p = geometry.getAttribute('position')
      const tint = new Float32Array(p.count * 3)
      const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hill.up)
      const point = new THREE.Vector3(), color = new THREE.Color(), green = new THREE.Color('#607f36')
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i), v = p.getY(i)
        const x = u * hill.width * R, z = -v * hill.width * R
        const elevation = hillHeight(u, -v, hill.height)
        const surface = Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R
        p.setXYZ(i, x, surface + elevation + .012, z)
        point.set(x, surface, z).applyQuaternion(orientation).addScaledVector(hill.up, R).normalize()
        const field = landscape(point.x, point.y, point.z)
        color.copy(earth).lerp(forest, THREE.MathUtils.smoothstep(field.green, .36, .64))
        color.lerp(green, THREE.MathUtils.smoothstep(elevation, 0, .65))
        color.multiplyScalar(.96 + .08 * field.city).toArray(tint, i * 3)
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3))
      geometry.computeVertexNormals()
      // Match the base's average texture tint at the flat seam; avoid tiled hill imagery.
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, color: '#dad8cf', roughness: 1, side: THREE.DoubleSide }))
      mesh.quaternion.copy(orientation)
      mesh.position.copy(hill.up).multiplyScalar(R)
      mesh.name = hill.lon === .12 ? 'namsan-green-mountain' : 'broad-green-ridge'
      scene.add(mesh)
    }
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < count; i++) {
      const baseLat = Math.asin(1 - 2 * (i + .5) / count)
      const lat = baseLat + (this.random() - .5) * .0017
      const lon = (i * goldenAngle) % TAU + (this.random() - .5) * .0017 / Math.max(.1, Math.cos(baseLat))
      const bankDistance = Math.abs(lat - river(lon))
      if (bankDistance < riverWidth(lon) + .045) continue
      const n = normal(lon, lat), field = landscape(n.x, n.y, n.z)
      const mountain = hills.some(hill => n.dot(hill.up) > Math.cos(hill.width + .025))
      const district = districts.find(district => n.dot(district.up) > Math.cos(district.radius * 1.35))
      const riverside = bankDistance < riverWidth(lon) + .37
      const neighborhood = field.city > .35 && field.green < .58
      const park = mountain || (!district && !riverside && !neighborhood) || field.green > .67
      if (park) {
        // A few park trees for scale; the green land itself carries the silhouette.
        if (!mountain && trees.length < 180 && this.random() < .012) {
          const crown = .35 + this.random() * .2
          trees.push({ lon, lat, width: crown, height: .4, depth: crown, color: new THREE.Color('#587b3c'), turn: this.random() * TAU })
        }
        continue
      }
      // Narrow street gaps and taller, tightly packed blocks form urban canyons.
      if (Math.abs(Math.sin(lon * 22)) < .15 || Math.abs(Math.sin(lat * 23 + lon * .8)) < .14) continue
      const core = district && n.dot(district.up) > Math.cos(district.radius * .62)
      const highrise = district?.kind === 1 && core && this.random() > .15
      const apartment = !highrise && ((district?.kind === 0 && this.random() > .22) || (riverside && field.city > .55))
      const height = highrise ? 1.05 + this.random() ** 1.5 * 1.4 : apartment ? .6 + this.random() * .95 : .14 + this.random() ** 1.5 * .48
      const width = apartment ? .3 + this.random() * .08 : .28 + this.random() * .15
      const depth = apartment ? .55 + this.random() * .12 : .27 + this.random() * .14
      const item: Placement = { lon, lat, width, height, depth, color: new THREE.Color(palette[Math.floor(this.random() * palette.length)]!), turn: Math.round(lon * 18) * .11 + Math.round(lat * 16) * .07 }
      blocks[highrise ? 1 : apartment ? 0 : 4]!.push(item)
    }
    // Distinct Seoul-inspired landmarks: gold tower, tapered skyscraper, Namsan mast.
    blocks[2]!.push({ lon: -.38, lat: -.43, width: .43, height: 2.1, depth: .28, color: new THREE.Color('#c9ac79'), turn: -.2 })
    blocks[3]!.push({ lon: .73, lat: .38, width: 1.4, height: 8.5, depth: 1.4, color: new THREE.Color('#c8d9dd'), turn: .1 })

    const dummy = new THREE.Object3D()
    const up = new THREE.Vector3(0, 1, 0)
    const batch = (items: Placement[], geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], lift = 0) => {
      const mesh = new THREE.InstancedMesh(geometry, material, items.length)
      items.forEach((item, index) => {
        const n = normal(item.lon, item.lat)
        dummy.position.copy(n).multiplyScalar(R + lift + item.height / 2)
        dummy.quaternion.setFromUnitVectors(up, n); dummy.rotateY(item.turn)
        dummy.scale.set(item.width, item.height, item.depth)
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix); mesh.setColorAt(index, item.color)
        this.trail?.register(mesh, index, n.clone().multiplyScalar(R))
      })
      mesh.computeBoundingSphere(); scene.add(mesh)
      return mesh
    }
    const wall = new THREE.MeshStandardMaterial({ map: this.facade(false), roughness: .85 })
    const glass = new THREE.MeshStandardMaterial({ map: this.facade(true), roughness: .48, metalness: .18 })
    const roof = new THREE.MeshStandardMaterial({ color: '#c8cbc6', roughness: 1 })
    const box = new THREE.BoxGeometry(1, 1, 1)
    for (let i = 0; i < 3; i++) {
      const side = i === 0 ? wall : glass
      batch(blocks[i]!, box, [side, side, roof, roof, side, side])
    }
    batch(blocks[3]!, new THREE.CylinderGeometry(.045, .5, 1, 8), glass)
    const lowrise = new THREE.MeshStandardMaterial({ color: '#cbc4b6', roughness: .95 })
    const lowriseWall = new THREE.MeshStandardMaterial({ map: this.facade(false, 3), roughness: .95 })
    batch(blocks[4]!, box, [lowriseWall, lowriseWall, lowrise, lowrise, lowriseWall, lowriseWall])
    // Rounded, subtly irregular crowns replace pointed low-poly cones.
    const canopy = new THREE.IcosahedronGeometry(.7, 1)
    const leafPositions = canopy.getAttribute('position')
    for (let i = 0; i < leafPositions.count; i++) {
      const x = leafPositions.getX(i), y = leafPositions.getY(i), z = leafPositions.getZ(i)
      const variation = 1 + .1 * Math.sin(x * 23 + z * 11) * Math.cos(y * 19)
      leafPositions.setXYZ(i, x * variation, y * variation, z * variation)
    }
    // Preserve the smooth radial normals instead of faceting the non-indexed crown.
    batch(trees, canopy, new THREE.MeshStandardMaterial({ roughness: 1 }))
    // Roof equipment shares one instance batch, positioned at the actual building tops.
    const buildings = [...blocks[0]!, ...blocks[1]!]
    const equippedBuildings = buildings.filter((_, index) => index % 8 === 0)
    const equipment = equippedBuildings.map(item => ({ ...item, width: item.width * .35, depth: item.depth * .5, height: .045, color: new THREE.Color('#9ba5a0') }))
    const equipmentMesh = batch(equipment, box, roof)
    equippedBuildings.forEach((item, index) => {
      equipmentMesh.getMatrixAt(index, dummy.matrix); dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      dummy.position.addScaledVector(normal(item.lon, item.lat), item.height)
      dummy.updateMatrix(); equipmentMesh.setMatrixAt(index, dummy.matrix)
    })
    equipmentMesh.instanceMatrix.needsUpdate = true; equipmentMesh.computeBoundingSphere()

    const tower = (lat: number, height: number, width: number, lift: number, color: string) => batch([{ lon: .12, lat, height, width, depth: width, color: new THREE.Color(color), turn: 0 }], new THREE.CylinderGeometry(.5, .5, 1, 12), roof, lift)
    const namsanTop = hillHeight(0, 0, hills[0]!.height)
    tower(.62, 2.8, .18, namsanTop, '#e0ddd4'); tower(.62, .55, 1, namsanTop + 2.3, '#b7c7c9'); tower(.62, 1.4, .055, namsanTop + 2.7, '#deddd6')
    // Bridges follow the globe rather than intersecting its surface.
    for (const lon of [.05, .46, 1.04, 1.7, 2.6, 3.25, 4.2, 5.2, 5.83]) {
      const span = riverWidth(lon) + .058
      const points = Array.from({ length: 33 }, (_, i) => normal(lon, river(lon) - span + i / 32 * span * 2).multiplyScalar(R + .22))
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, .16, 4, false), roadMat))
      for (const offset of [-.7, -.35, 0, .35, .7]) batch([{ lon, lat: river(lon) + offset * span, width: .14, depth: .3, height: .26, color: new THREE.Color('#bdc5c3'), turn: 0 }], box, roof)
    }
  }

  private resize() {
    if (!this.renderer || !this.camera) return
    const width = this.view.clientWidth, height = this.view.clientHeight
    if (!width || !height) return
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (!this.conversation.active) this.fit()
  }

  private fit() {
    if (!this.camera || !this.controls) return
    if (this.conversation.active) return
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2)
    // Full-bleed sky, with the globe still framed clear of the header/footer UI.
    const availableHeight = Math.max(.35, (this.view.clientHeight - (this.view.clientWidth <= 600 ? 335 : 230)) / this.view.clientHeight)
    const angle = Math.min(Math.atan(Math.tan(vertical) * availableHeight), Math.atan(Math.tan(vertical) * this.camera.aspect * .94))
    const distance = (R + 3.2) / Math.sin(angle) * 1.08
    this.controls.maxDistance = Math.max(110, distance * 1.5)
    this.camera.position.set(.15, .33, 1).normalize().multiplyScalar(distance)
    this.controls.target.set(0, 0, 0)
    this.controls.update(); this.dirty = true
  }

  render(now: number) {
    if (!this.renderer || !this.scene || !this.camera || !this.controls || document.hidden || now - this.lastFrame < 1000 / 40) return
    const delta = this.lastFrame ? Math.min(.1, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now
    if (this.phase !== 'idle' && this.titan) {
      this.elapsed += delta
      const blend = Math.min(1, this.elapsed / 2.7)
      this.skyBlend.value = blend * blend * (3 - 2 * blend)
      this.sunlight!.color.setRGB(1, 1 - .65 * this.skyBlend.value, 1 - .77 * this.skyBlend.value)
      this.sunlight!.intensity = 3.2 - 1.1 * this.skyBlend.value
      this.ambient!.intensity = 2.5 - 1.4 * this.skyBlend.value
      this.flashStrength = this.arrival?.update(this.elapsed) ?? 0
      this.flash.style.opacity = String(this.flashStrength * (this.reducedMotion ? .07 : .32))
      this.sunlight!.intensity += this.flashStrength * 5
      if (this.phase === 'rising') {
        const t = THREE.MathUtils.clamp((this.elapsed - ARRIVAL_REVEAL_START) / 4, 0, 1)
        const rise = t * t * (3 - 2 * t)
        this.titan.visible = this.elapsed >= ARRIVAL_REVEAL_START
        this.surfaceUp.set(0, 1, 0).applyQuaternion(this.titan.quaternion)
        this.titan.position.copy(this.surfaceUp).multiplyScalar(R - 31 * (1 - rise))
        this.wallTitans.forEach(({ root, up }) => {
          root.visible = this.titan!.visible
          root.position.copy(up).multiplyScalar(R - 13 * (1 - rise))
        })
        if (this.elapsed >= ARRIVAL_END) {
          this.phase = 'rumbling'
          this.root.querySelector('.rumbling-start')!.textContent = '시조의 거인 · 방향키로 이동'
        }
      } else {
        const x = Number(this.keys.has('ArrowRight')) - Number(this.keys.has('ArrowLeft'))
        const z = Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'))
        this.motion.step(this.titan, x, z, delta, R, WALK_SPEED)
        this.moveHerd()
      }
      this.steam?.update(delta, this.view.clientHeight * this.renderer.getPixelRatio(), this.camera.fov)
      this.wallTitans.forEach(({ steam }) => steam.update(delta, this.view.clientHeight * this.renderer!.getPixelRatio(), this.camera!.fov))
      this.dirty = true
    }
    if (this.conversation.active) this.dirty = this.conversation.update(delta, R) || this.dirty
    else this.controls.update()
    if (!this.dirty) return
    // A temporary view-only rotation: OrbitControls and the next frame keep the original pose.
    this.cameraRotation.copy(this.camera.quaternion)
    if (this.flashStrength > 0 && !this.reducedMotion) {
      this.camera.rotateX(Math.sin(now * .14) * .004 * this.flashStrength)
      this.camera.rotateZ(Math.sin(now * .11) * .003 * this.flashStrength)
    }
    try { this.renderer.render(this.scene, this.camera) }
    finally { this.camera.quaternion.copy(this.cameraRotation); this.camera.updateMatrixWorld() }
    this.dirty = false
  }

  deactivate() {
    this.conversation.reset()
    this.capture.close(); this.events?.abort(); this.events = null; this.keys.clear()
    this.motion.reset()
    this.observer?.disconnect(); this.observer = null
    this.controls?.dispose(); this.controls = null
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    this.scene?.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry)
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
        if (object instanceof THREE.InstancedMesh) object.dispose()
      }
    })
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose())
    this.textures.forEach(texture => texture.dispose()); this.textures = []
    this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer?.domElement.remove()
    this.renderer = null; this.scene = null; this.camera = null
    this.titan = null; this.steam = null; this.sunlight = null; this.ambient = null
    this.trail?.dispose(); this.trail = null
    this.wallTitans = []; this.arrival = null; this.flashStrength = 0; this.flash.style.opacity = '0'
    this.phase = 'idle'; this.elapsed = 0; this.skyBlend.value = 0
    const button = this.root.querySelector<HTMLButtonElement>('.rumbling-start')!
    button.disabled = false; button.textContent = '땅울림 하기'
    this.root.hidden = true; this.dirty = true; this.lastFrame = 0
  }
}
