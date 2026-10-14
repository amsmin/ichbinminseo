export type FlowerPosition = { x: number; y: number }
export const FLOWER_WIDTH_RATIO = 0.23
export const FLOWER_STORAGE_KEY = 'lemon:photobook:photo-flower:v1'

const petals = Array.from({ length: 10 }, (_, i) =>
  `<ellipse cx="32" cy="16" rx="6" ry="12" transform="rotate(${i * 36} 32 32)" fill="#ffd631" stroke="#080808" stroke-width="2"/>`,
).join('')
export const FLOWER_URL = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${petals}<circle cx="32" cy="32" r="12" fill="#8c542d" stroke="#080808" stroke-width="2.4"/></svg>`)}`

export function photoLayout(photo: HTMLImageElement) {
  const fit = Math.min(380 / photo.naturalWidth, 360 / photo.naturalHeight) * 0.5
  const width = photo.naturalWidth * fit
  const height = photo.naturalHeight * fit
  return { x: (700 - width) / 2, y: (600 - height) / 2 - 18, width, height }
}

export function clampFlower(position: FlowerPosition, photo: HTMLImageElement): FlowerPosition {
  const radiusX = FLOWER_WIDTH_RATIO / 2
  const radiusY = Math.min(0.5, radiusX * photo.naturalWidth / photo.naturalHeight)
  return {
    x: Math.max(radiusX, Math.min(1 - radiusX, position.x)),
    y: Math.max(radiusY, Math.min(1 - radiusY, position.y)),
  }
}

export function readFlower(photo: HTMLImageElement): FlowerPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(FLOWER_STORAGE_KEY) ?? 'null')
    if (value && typeof value.x === 'number' && typeof value.y === 'number'
      && Number.isFinite(value.x) && Number.isFinite(value.y)) return clampFlower(value, photo)
  } catch { /* Storage may be unavailable; editing still works for this visit. */ }
  return null
}
