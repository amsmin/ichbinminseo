/** Extend only the blue margins; the original stage (including arrows) stays intact. */
export function extendBackground(image: HTMLImageElement, stage: HTMLElement) {
  const host = stage.parentElement!
  const canvas = document.createElement('canvas')
  canvas.className = 'background-extension'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')
  if (!context) return
  host.prepend(canvas)

  const draw = () => {
    const bounds = host.getBoundingClientRect()
    const rect = stage.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.ceil(bounds.width * ratio)
    canvas.height = Math.ceil(bounds.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const x = rect.left - bounds.left
    const y = rect.top - bounds.top
    const right = x + rect.width
    const bottom = y + rect.height
    const width = image.naturalWidth
    const height = image.naturalHeight

    // Reflect the original edge into each margin. This preserves the actual
    // edge colors and texture instead of introducing a mismatched flat panel.
    // These source bands contain blue only, never the baked-in arrows.
    const sideBand = Math.min(384, width / 4)
    const topBand = Math.min(96, height / 16)
    const bottomBand = Math.min(64, height / 16)
    context.drawImage(image, x, y, rect.width, rect.height)
    if (x > 0) {
      context.save()
      context.translate(x, y)
      context.scale(-1, 1)
      context.drawImage(image, 0, 0, sideBand, height, 0, 0, x, rect.height)
      context.restore()
    }
    if (right < bounds.width) {
      context.save()
      context.translate(bounds.width, y)
      context.scale(-1, 1)
      context.drawImage(image, width - sideBand, 0, sideBand, height,
        0, 0, bounds.width - right, rect.height)
      context.restore()
    }
    if (y > 0) {
      context.save()
      context.translate(x, y)
      context.scale(1, -1)
      context.drawImage(image, 0, 0, width, topBand, 0, 0, rect.width, y)
      context.restore()
    }
    if (bottom < bounds.height) {
      context.save()
      context.translate(x, bounds.height)
      context.scale(1, -1)
      context.drawImage(image, 0, height - bottomBand, width, bottomBand,
        0, 0, rect.width, bounds.height - bottom)
      context.restore()
    }
  }
  const observer = new ResizeObserver(draw)
  observer.observe(host)
  observer.observe(stage)
  window.addEventListener('resize', draw)
  draw()
}
