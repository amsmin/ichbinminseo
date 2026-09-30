// Continuous world-space fields: no longitude seams or repeated city tiles.
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz)
  const hash = (a: number, b: number, c: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
    return value - Math.floor(value)
  }
  let sum = 0
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    sum += hash(ix + a, iy + b, iz + c) * (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (c ? fz : 1 - fz)
  }
  return sum
}
export function landscape(x: number, y: number, z: number) {
  const green = noise(x * 5 + 11, y * 5, z * 5) * .7 + noise(x * 13, y * 13 + 7, z * 13) * .3
  const city = noise(x * 7 - 9, y * 7, z * 7 + 18)
  return { green, city }
}
