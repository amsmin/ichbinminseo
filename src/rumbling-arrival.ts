import * as THREE from 'three'

export const ARRIVAL_REVEAL_START = 4.5
export const ARRIVAL_END = 11

export class RumblingArrival {
  readonly group = new THREE.Group()
  private fog: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private bolts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
  private flashes = [2.8, 3.65, 4.5]

  constructor(radius: number, orientation: THREE.Quaternion) {
    this.group.name = 'rumbling-lightning-and-surface-fog'
    this.fog = new THREE.Mesh(new THREE.SphereGeometry(radius + 8, 64, 40), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { opacity: { value: 0 }, time: { value: 0 } },
      vertexShader: `varying vec3 spherePoint; void main(){spherePoint=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 spherePoint;uniform float opacity;uniform float time;
        float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        void main(){vec3 p=spherePoint*.23+vec3(time*.07,time*.025,0);
          float n=noise(p)*.65+noise(p*2.1)*.35;
          gl_FragColor=vec4(mix(vec3(.7,.76,.79),vec3(1.),n),opacity*(.72+.28*n));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }))
    this.group.add(this.fog)
    for (let bolt = 0; bolt < 3; bolt++) {
      const x = [-17, 20, -4][bolt]!, z = [-12, -22, -5][bolt]!
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= 12; i++) {
        points.push(new THREE.Vector3(x + Math.sin(i * 8.4 + bolt) * 2.1, radius + 52 - i * 4.15, z + Math.sin(i * 2.8) * 1.7).applyQuaternion(orientation))
      }
      // Linear lightning kinks, not a smooth curved tube.
      const path = new THREE.CurvePath<THREE.Vector3>()
      for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1]!, points[i]!))
      const material = new THREE.MeshBasicMaterial({ color: '#ebf6ff', transparent: true, opacity: 0, toneMapped: false })
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 60, .18, 5, false), material)
      mesh.name = `lightning-${bolt + 1}`; mesh.visible = false
      this.group.add(mesh); this.bolts.push(mesh)
    }
  }

  update(seconds: number) {
    // Sky turns first, fog builds during strikes, then reveals the whole group slowly.
    const build = THREE.MathUtils.smoothstep(seconds, 1.4, 3.2)
    const clear = 1 - THREE.MathUtils.smoothstep(seconds, 5, ARRIVAL_END)
    this.fog.material.uniforms.opacity!.value = build * clear * .98
    this.fog.material.uniforms.time!.value = seconds
    this.fog.visible = seconds < ARRIVAL_END && seconds > 1.4
    let flash = 0
    this.bolts.forEach((bolt, i) => {
      const age = seconds - this.flashes[i]!
      const strength = age >= 0 && age < .2 ? Math.exp(-age * 22) : 0
      bolt.visible = strength > .015
      bolt.material.opacity = strength
      flash = Math.max(flash, strength)
    })
    return flash
  }
}
