import { mapQuad, type Quad } from './photobook-geometry'
import { PAPER_SHAPE } from './photobook-surface'
import { photoLayout, FLOWER_WIDTH_RATIO, type FlowerPosition } from './photobook-photo'

export const TEXT_PAGE_FONT = '400 64px Arial, Helvetica, sans-serif'

// Flatten the original paper and lettering once, before bending the sheet.
// Nested SVG projective transforms inside moving CSS clips can lose tiles in
// browser compositing. A single lossless surface per side avoids those bands.
export async function createPaperMaterials(
  image: HTMLImageElement,
  source: Quad,
  target: Quad,
  options: {
    captionBounds?: readonly [number, number, number, number]
    paperImage?: HTMLImageElement
  } = {},
) {
  const [left, top, right, bottom] = options.captionBounds ?? [795, 285, 1255, 555]
  const paperImage = options.paperImage ?? image
  const scale = 2
  const width = 700 * scale
  const height = 600 * scale
  const original = document.createElement('canvas')
  original.width = image.naturalWidth
  original.height = image.naturalHeight
  const originalContext = original.getContext('2d')!
  originalContext.drawImage(image, 0, 0)
  const pixels = originalContext.getImageData(0, 0, original.width, original.height).data
  const inverse = new DOMMatrix(mapQuad(source, target)).inverse()
  const ink = document.createElement('canvas')
  ink.width = width
  ink.height = height
  const inkContext = ink.getContext('2d')!
  const projected = inkContext.createImageData(width, height)

  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) / scale
    for (let column = 0; column < width; column++) {
      const x = (column + 0.5) / scale
      const w = inverse.m14 * x + inverse.m24 * y + inverse.m44
      const sx = (inverse.m11 * x + inverse.m21 * y + inverse.m41) / w
      const sy = (inverse.m12 * x + inverse.m22 * y + inverse.m42) / w
      // The original caption only; the sheet's contour is drawn continuously.
      if (sx < left || sx >= right || sy < top || sy >= bottom) continue
      const ix = Math.floor(sx)
      const iy = Math.floor(sy)
      const fx = sx - ix
      const fy = sy - iy
      const offset = (iy * original.width + ix) * 4
      const below = offset + original.width * 4
      const out = (row * width + column) * 4
      for (let channel = 0; channel < 4; channel++) {
        projected.data[out + channel] =
          (pixels[offset + channel] * (1 - fx) + pixels[offset + 4 + channel] * fx) * (1 - fy) +
          (pixels[below + channel] * (1 - fx) + pixels[below + 4 + channel] * fx) * fy
      }
    }
  }
  inkContext.putImageData(projected, 0, 0)

  const surface = (withCaption: boolean) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.scale(scale, scale)
    const outline = new Path2D(PAPER_SHAPE)
    context.save()
    context.clip(outline)
    context.drawImage(paperImage, 1000, 240, 38, 38, 0, 0, 700, 600)
    if (withCaption) context.drawImage(ink, 0, 0, 700, 600)
    context.restore()
    context.strokeStyle = '#080808'
    context.lineWidth = 4.8
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.stroke(outline)
    return canvas
  }
  const front = surface(true)
  const back = surface(false)
  return { front, back }
}

/** Printed directly onto the sheet, so titles share its perspective and bend. */
export function createTextPage(blank: HTMLCanvasElement, title: string) {
  const canvas = document.createElement('canvas')
  canvas.width = blank.width
  canvas.height = blank.height
  const context = canvas.getContext('2d')!
  context.drawImage(blank, 0, 0)
  context.scale(canvas.width / 700, canvas.height / 600)
  context.fillStyle = '#080808'
  context.font = TEXT_PAGE_FONT
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  const metrics = context.measureText(title)
  const centerBaseline = 300 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
  context.fillText(title, 350, centerBaseline)
  return canvas
}

/** Compose on the existing paper so the photo and caption bend with the sheet. */
export function createPhotoPage(blank: HTMLCanvasElement, photo: HTMLImageElement,
  decoration?: { image: HTMLImageElement; position: FlowerPosition | null }) {
  const canvas = document.createElement('canvas')
  canvas.width = blank.width
  canvas.height = blank.height
  const context = canvas.getContext('2d')!
  context.drawImage(blank, 0, 0)
  context.scale(canvas.width / 700, canvas.height / 600)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  // Contain the entire decoded image, including its EXIF orientation. Never
  // crop it or stretch the two axes independently; leave room for the caption.
  const { x, y, width, height } = photoLayout(photo)
  context.drawImage(photo, x, y, width, height)
  if (decoration?.position) {
    const size = width * FLOWER_WIDTH_RATIO
    context.drawImage(decoration.image, x + width * decoration.position.x - size / 2,
      y + height * decoration.position.y - size / 2, size, size)
  }
  context.fillStyle = '#080808'
  context.font = '400 22px Arial, Helvetica, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillText('Und das bin ich :)', 350, y + height + 18)
  return canvas
}
