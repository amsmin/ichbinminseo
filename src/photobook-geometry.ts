export type Quad = [[number, number], [number, number], [number, number], [number, number]]

// Solve the eight homography coefficients mapping the measured PNG corners.
// This registers textures once. It never changes the book geometry mid-turn.
function homography(source: Quad, destination: Quad): number[] {
  const rows: number[][] = []
  for (let index = 0; index < 4; index++) {
    const [x, y] = source[index]
    const [u, v] = destination[index]
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    const pivotRow = rows[pivot]
    rows[pivot] = rows[column]
    rows[column] = pivotRow
    const divisor = rows[column][column]
    if (Math.abs(divisor) < 1e-10) throw new Error('Book surface has degenerate corners')
    rows[column] = rows[column].map(value => value / divisor)
    for (let row = 0; row < 8; row++) {
      if (row === column) continue
      const factor = rows[row][column]
      rows[row] = rows[row].map((value, index) => value - factor * rows[column][index])
    }
  }
  return rows.map(row => row[8])
}

function matrix(source: Quad, destination: Quad, lifted: boolean) {
  const [a, b, c, d, e, f, g, h] = homography(source, destination)
  // The depth axis projects upward along the illustrated spine. At 90° the
  // cover is edge-on; both hinge endpoints remain fixed at every angle.
  const zx = lifted ? -(destination[3][0] - destination[0][0]) / 600 * 0.35 : 0
  const zy = lifted ? -(destination[3][1] - destination[0][1]) / 600 * 0.35 : 0
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, zx, zy, 1, 0, c, f, 0, 1].join(',')})`
}

export function mapQuad(source: Quad, destination: Quad) {
  return matrix(source, destination, false)
}

export function projectionMatrix(source: Quad, destination: Quad) {
  return matrix(source, destination, true)
}
