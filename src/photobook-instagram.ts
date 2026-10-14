import { mapQuad, type Quad } from './photobook-geometry'

const HANDLE = '@gaeyoeul'
const FONT = '400 22px Arial, Helvetica, sans-serif'
const CENTER_X = 130
const CENTER_Y = 530

/** Sheet two's reverse is the left-hand page beside the third-page portrait. */
export function createInstagramBack(blank: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = blank.width
  canvas.height = blank.height
  const context = canvas.getContext('2d')!
  context.drawImage(blank, 0, 0)
  context.scale(canvas.width / 700, canvas.height / 600)
  // The reverse is viewed from the opposite side; compensate for its mirrored UVs.
  context.translate(700, 0)
  context.scale(-1, 1)
  context.font = FONT
  context.fillStyle = '#080808'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(HANDLE, CENTER_X, CENTER_Y)
  return canvas
}

export function mountInstagramLink(stage: HTMLElement, projection: string, isAvailable: () => boolean) {
  const matrix = new DOMMatrix(projection)
  const context = document.createElement('canvas').getContext('2d')!
  context.font = FONT
  const width = context.measureText(HANDLE).width + 20
  const height = 44
  const link = document.createElement('a')
  link.className = 'project-page-link instagram-page-link'
  link.href = 'https://instagram.com/gaeyoeul?dlrf=dmVyNHRvamp3cGJk&utm_source=qr'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.setAttribute('aria-label', `${HANDLE} — Instagram, 새 탭에서 열기`)
  link.title = `${HANDLE} Instagram`
  link.style.width = `${width}px`
  link.style.height = `${height}px`
  link.hidden = true
  link.addEventListener('click', event => {
    if (!isAvailable()) event.preventDefault()
  })
  stage.append(link)

  const resize = () => {
    const ratio = stage.getBoundingClientRect().width / 1536
    const source: Quad = [[0, 0], [width, 0], [width, height], [0, height]]
    const target = source.map(([u, v]) => {
      const x = 700 - (CENTER_X - width / 2 + u)
      const y = CENTER_Y - height / 2 + v
      // Match FlexiblePaper at progress=1: negative x and an 82px paper arch.
      const point = matrix.transformPoint(new DOMPoint(-x, y, 82 * Math.sin(Math.PI * x / 700)))
      return [point.x / point.w * ratio, point.y / point.w * ratio]
    }) as Quad
    link.style.transform = mapQuad(source, target)
  }
  new ResizeObserver(resize).observe(stage)
  resize()
  return { update() { link.hidden = !isAvailable() } }
}
