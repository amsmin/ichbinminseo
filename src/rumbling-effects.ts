import * as THREE from 'three'
import { TITAN_FACE } from './rumbling-face-layout'

/** A photo mapped onto the existing skull curvature, underneath its hair and jaw. */
export function createTitanFace(photo: HTMLCanvasElement) {
  const geometry = new THREE.SphereGeometry(1, 24, 20, Math.PI / 2 - TITAN_FACE.halfPhi, TITAN_FACE.halfPhi * 2, TITAN_FACE.thetaStart, TITAN_FACE.thetaLength)
  // SphereGeometry's +Z side is phi=PI/2. Keep the image's left/right orientation.
  geometry.scale(TITAN_FACE.radiusX, TITAN_FACE.radiusY, TITAN_FACE.radiusZ)
  geometry.translate(0, TITAN_FACE.centerY, TITAN_FACE.centerZ)
  const map = new THREE.CanvasTexture(photo)
  map.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: .025, roughness: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'captured-face-on-skull'
  return mesh
}

/** Fixed particle pool: one draw call, no textures, no per-frame allocations. */
export class TitanSteam {
  readonly mesh: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private count = 120
  private time = 0
  private positions = new Float32Array(this.count * 3)
  private sizes = new Float32Array(this.count)
  private opacity = new Float32Array(this.count)
  private ages = new Float32Array(this.count)
  private lifetime = new Float32Array(this.count)
  private origin = new Float32Array(this.count * 3)

  constructor() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('puffSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('puffAlpha', new THREE.BufferAttribute(this.opacity, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('puffSeed', new THREE.Float32BufferAttribute(Array.from({ length: this.count }, (_, i) => (i * .61803398875) % 1), 1))
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { pixelScale: { value: 800 }, time: { value: 0 } },
      vertexShader: `attribute float puffSize; attribute float puffAlpha; attribute float puffSeed;
        uniform float pixelScale; varying float opacity; varying float seed;
        void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p;
          float scale=max(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));
          gl_PointSize=clamp(puffSize*scale*pixelScale/max(1.0,-p.z),1.0,180.0);
          opacity=puffAlpha;seed=puffSeed; }`,
      fragmentShader: `varying float opacity;varying float seed;uniform float time;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float puff(vec2 p,vec2 c,float width){vec2 d=p-c;return exp(-dot(d,d)*width);}
        void main(){
          vec2 uv=(gl_PointCoord-.5)*2.;float angle=seed*6.283+time*.08;
          vec2 p=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*uv;
          float billow=puff(p,vec2(-.28,.1),7.)+puff(p,vec2(.25,.15),9.)*.8
            +puff(p,vec2(.02,-.26),9.)*.85+puff(p,vec2(-.12,.4),14.)*.5;
          float turbulence=noise(p*4.+vec2(seed*29.+time*.09,-time*.12));
          float edge=1.-smoothstep(.66,1.,length(uv));
          float density=clamp(billow*(.65+.35*turbulence),0.,1.);
          vec3 shade=mix(vec3(.68,.73,.76),vec3(.99,.985,.96),clamp(.5+gl_PointCoord.y*.38+density*.22,0.,1.));
          gl_FragColor=vec4(shade,density*edge*opacity);
        }`,
    })
    this.mesh = new THREE.Points(geometry, material)
    this.mesh.name = 'continuous-white-steam'
    this.mesh.frustumCulled = false
    for (let i = 0; i < this.count; i++) { this.spawn(i); this.ages[i] = -i / this.count * 4 }
  }

  private spawn(i: number) {
    this.ages[i] = 0
    this.lifetime[i] = 3.5 + Math.random() * 3
    this.origin[i * 3] = (Math.random() - .5) * 14
    this.origin[i * 3 + 1] = 1 + Math.random() * 14
    this.origin[i * 3 + 2] = 5 - Math.random() * 14
  }

  update(delta: number, viewportHeight: number, fov: number) {
    this.time += delta
    this.mesh.material.uniforms.time!.value = this.time
    this.mesh.material.uniforms.pixelScale!.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)))
    for (let i = 0; i < this.count; i++) {
      this.ages[i]! += delta
      if (this.ages[i]! > this.lifetime[i]!) this.spawn(i)
      const age = Math.max(0, this.ages[i]!), t = age / this.lifetime[i]!
      this.positions[i * 3] = this.origin[i * 3]! + Math.sin(i * 2.4 + age * .6) * age * .35
      this.positions[i * 3 + 1] = this.origin[i * 3 + 1]! + age * 1.35
      this.positions[i * 3 + 2] = this.origin[i * 3 + 2]! + Math.cos(i + age * .4) * age * .35
      this.sizes[i] = 3.3 + age * 1.15
      this.opacity[i] = this.ages[i]! < 0 ? 0 : Math.sin(t * Math.PI) * .3
    }
    for (const name of ['position', 'puffSize', 'puffAlpha']) this.mesh.geometry.getAttribute(name).needsUpdate = true
  }
}
