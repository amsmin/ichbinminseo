import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { VOXEL_COLORS } from './minecraft-voxel-data'

export type GearSlot = 2 | 3 | 4 | 5

function box(parts: THREE.BufferGeometry[], x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz)
  geometry.translate(x, y, z)
  const tint = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  parts.push(geometry)
}

function createHelmet(texture?: THREE.Texture): THREE.Mesh {
  // Front silhouette and UVs come from the existing helmet.png cutout.
  // No painted substitute, random palette or rounded/deformed crown.
  const width = .198, top = .092, height = .118, front = .085, back = -.085
  const outline = [[0,0],[1,0],[1,.829],[.878,.829],[.878,.579],[.624,.579],
    [.624,1],[.374,1],[.374,.579],[.12,.579],[.12,.829],[0,.829]]
  const shape = new THREE.Shape()
  outline.forEach(([x,y],i) => {
    const px = (x-.5)*width, py = top-y*height
    if (i === 0) shape.moveTo(px,py); else shape.lineTo(px,py)
  })
  shape.closePath()
  const face = new THREE.ExtrudeGeometry(shape,{ depth:.008,bevelEnabled:false,steps:1,curveSegments:1 })
  face.translate(0,0,front-.008)
  const uv = face.attributes.uv, positions = face.attributes.position
  for (let i=0;i<uv.count;i++) {
    uv.setXY(i,(120+(positions.getX(i)/width+.5)*1014)/1254,
      1-(441+(top-positions.getY(i))/height*605)/1254)
  }
  const parts: THREE.BufferGeometry[] = [face]
  function panel(x:number,y:number,z:number,sx:number,sy:number,sz:number,kind:'side'|'back'|'top') {
    const indexed = new THREE.BoxGeometry(sx,sy,sz)
    const part = indexed.toNonIndexed(); indexed.dispose()
    part.translate(x,y,z)
    const p=part.attributes.position, uv=part.attributes.uv
    for(let i=0;i<uv.count;i++) {
      if(kind==='top') {
        const t=THREE.MathUtils.clamp((p.getZ(i)-back)/(front-back),0,1)
        const left=228+(120-228)*t, right=1026+(1134-1026)*t
        uv.setXY(i,(left+(p.getX(i)/width+.5)*(right-left))/1254,1-(230+211*t)/1254)
      } else {
        // Sample the opaque cyan forehead, not the transparent eye openings.
        const u=kind==='back' ? p.getX(i)/width+.5 : (p.getZ(i)-back)/(front-back)
        uv.setXY(i,(130+THREE.MathUtils.clamp(u,0,1)*980)/1254,
          1-(452+THREE.MathUtils.clamp((top-p.getY(i))/.11,0,1)*315)/1254)
      }
    }
    parts.push(part)
  }
  panel(0,top-.004,0,width,.008,.17,'top')
  panel(0,top-.055,back+.004,width,.11,.008,'back')
  panel(-width/2+.004,top-.049,0,.008,.098,.17,'side')
  panel(width/2-.004,top-.049,0,.008,.098,.17,'side')
  const geometry=mergeGeometries(parts)!
  parts.forEach(part=>part.dispose())
  const material=new THREE.MeshStandardMaterial({ map:texture ?? null,color:texture ? 0xffffff : 0x12b9b2,
    roughness:.72,metalness:.04,alphaTest:.35 })
  const model=new THREE.Mesh(geometry,material)
  model.name='voxel-helmet'; model.renderOrder=1
  return model
}

export function createGearModel(slot: GearSlot, helmetTexture?: THREE.Texture): THREE.Mesh {
  if (slot === 5) return createHelmet(helmetTexture)
  const parts: THREE.BufferGeometry[] = []
  {
    const name = slot === 2 ? 'torch' : slot === 3 ? 'pickaxe' : 'sword'
    const grid = VOXEL_COLORS[name]
    const anchor = slot === 2 ? [.5, 7.4] : slot === 3 ? [2, 10] : [3, 12]
    const unit = slot === 2 ? .019 : .0175
    for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
      const color = grid[y][x]
      if (!color) continue
      box(parts, (x - anchor[0]) * unit, (anchor[1] - y) * unit, 0, unit, unit, slot === 2 ? .034 : .026, color)
    }
  }
  const geometry = mergeGeometries(parts)!
  parts.forEach(part => part.dispose())
  // All handles share local +Y; the origin is inside the grip, not at the wrist.
  if (slot === 3 || slot === 4) geometry.rotateZ(Math.PI / 4)
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: slot === 2 ? .88 : .44, metalness: slot === 2 ? 0 : .24 })
  const model = new THREE.Mesh(geometry, material)
  model.name = ['','','voxel-torch','voxel-pickaxe','voxel-sword','voxel-helmet'][slot]
  model.renderOrder = 1
  return model
}
