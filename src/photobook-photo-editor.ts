import './photobook-photo-editor.css'
import { mapQuad, type Quad } from './photobook-geometry'
import { clampFlower, FLOWER_STORAGE_KEY, FLOWER_URL, FLOWER_WIDTH_RATIO, photoLayout, type FlowerPosition } from './photobook-photo'
import { trackEvent } from './analytics'

export function mountPhotoEditor(options: {
  photo: HTMLImageElement
  stage: HTMLElement
  projection: string
  initialPosition: FlowerPosition | null
  canOpen: () => boolean
  setArtwork: (position: FlowerPosition | null, hidden: boolean) => void
}) {
  const { photo, stage } = options
  const layout = photoLayout(photo)
  const groupWidth = Math.max(220, layout.width)
  const groupHeight = layout.height + 44
  const groupX = (700 - groupWidth) / 2
  const matrix = new DOMMatrix(options.projection)
  let position = options.initialPosition
  let preview: FlowerPosition | null = null
  let armed = false
  let dragging = false
  let active = false
  let busy = false
  let scale = 1
  let selected = false
  let dragOffset = { x: 0, y: 0 }
  let camera = new DOMMatrix()

  // Only the book is inside this temporary camera rig. Its page-turn code,
  // background, arrows, and resting geometry remain unchanged.
  const book = stage.querySelector<HTMLElement>('.book-scene')!
  const rig = document.createElement('div')
  rig.className = 'photo-camera-rig'
  book.replaceWith(rig)
  rig.append(book)

  const hotspot = document.createElement('button')
  hotspot.type = 'button'
  hotspot.className = 'photo-open-hotspot'
  hotspot.setAttribute('aria-label', '사진 확대하고 꽃 스티커 꾸미기')
  hotspot.setAttribute('aria-haspopup', 'dialog')
  hotspot.style.width = `${layout.width}px`
  hotspot.style.height = `${layout.height}px`
  // Keep the button outside the book's role="img" accessibility subtree.
  stage.append(hotspot)

  const dialog = document.createElement('dialog')
  dialog.className = 'photo-editor'
  dialog.setAttribute('aria-label', '사진 꾸미기')
  dialog.innerHTML = `
    <figure class="photo-editor-card">
      <div class="photo-editor-picture" tabindex="0" role="group" aria-label="사진 위에 꽃을 붙일 위치 선택">
        <img class="photo-editor-original" alt="민서의 사진" draggable="false" />
        <button type="button" class="flower-sticker" aria-label="꽃 위치 이동. 방향키로도 움직일 수 있습니다." hidden><img src="${FLOWER_URL}" alt="" draggable="false" /></button>
        <button type="button" class="flower-remove" aria-label="꽃 삭제" hidden>×</button>
      </div>
      <figcaption class="photo-editor-caption">Und das bin ich :)</figcaption>
    </figure>
    <div class="photo-editor-tools" hidden>
      <button type="button" class="photo-flower-tool" aria-label="노란 꽃 선택" aria-pressed="false"><img src="${FLOWER_URL}" alt="" draggable="false" /></button>
      <label class="photo-editor-done"><input type="checkbox" aria-label="완료하고 책으로 돌아가기" /><span class="photo-editor-check" aria-hidden="true"><svg viewBox="0 0 28 28"><path pathLength="1" d="M5 5 Q13 13 23 23"/><path pathLength="1" d="M23 5 Q15 13 5 23"/></svg></span><span lang="de">Fertig</span></label>
    </div>
    <p class="photo-editor-hint" aria-live="polite" lang="de"></p>`
  document.body.append(dialog)
  const card = dialog.querySelector<HTMLElement>('.photo-editor-card')!
  const picture = dialog.querySelector<HTMLElement>('.photo-editor-picture')!
  const caption = dialog.querySelector<HTMLElement>('.photo-editor-caption')!
  const sticker = dialog.querySelector<HTMLButtonElement>('.flower-sticker')!
  const remove = dialog.querySelector<HTMLButtonElement>('.flower-remove')!
  const strokes = [...dialog.querySelectorAll<SVGPathElement>('.photo-editor-check path')]
  const tool = dialog.querySelector<HTMLButtonElement>('.photo-flower-tool')!
  const tools = dialog.querySelector<HTMLElement>('.photo-editor-tools')!
  const done = dialog.querySelector<HTMLInputElement>('input')!
  const hint = dialog.querySelector<HTMLElement>('.photo-editor-hint')!
  dialog.querySelector<HTMLImageElement>('.photo-editor-original')!.src = photo.src
  card.style.width = `${groupWidth}px`
  card.style.height = `${groupHeight}px`
  picture.style.width = `${layout.width}px`
  picture.style.height = `${layout.height}px`
  sticker.style.width = `${FLOWER_WIDTH_RATIO * 100}%`

  // Match the resting sheet's slight curve, not just its bounding rectangle.
  const project = (x: number, y: number): [number, number] => {
    const p = matrix.transformPoint(new DOMPoint(x, y, 14 * Math.sin(Math.PI * x / 700)))
    return [p.x / p.w, p.y / p.w]
  }
  const corners = (x: number, y: number, width: number, height: number): Quad =>
    [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
  const bookTransform = () => {
    const rect = stage.getBoundingClientRect()
    const destination = corners(groupX, layout.y, groupWidth, groupHeight).map(([x, y]) => {
      const point = project(x, y)
      return [rect.left + point[0] * rect.width / 1536, rect.top + point[1] * rect.width / 1536]
    }) as Quad
    return mapQuad(corners(0, 0, groupWidth, groupHeight), destination)
  }
  function resizeHotspot() {
    const ratio = stage.getBoundingClientRect().width / 1536
    hotspot.style.transform = mapQuad(corners(0, 0, layout.width, layout.height),
      corners(layout.x, layout.y, layout.width, layout.height).map(([x, y]) => {
        const p = project(x, y)
        return [p[0] * ratio, p[1] * ratio]
      }) as Quad)
  }
  new ResizeObserver(resizeHotspot).observe(stage)
  resizeHotspot()

  function expandedTransform() {
    scale = Math.min(2.5, (dialog.clientWidth - 48) / groupWidth, (dialog.clientHeight - 120) / groupHeight)
    scale = Math.max(0.3, scale)
    const x = (dialog.clientWidth - groupWidth * scale) / 2
    const y = (dialog.clientHeight - (layout.height * scale + 36)) / 2
    tools.style.left = `${Math.min(dialog.clientWidth - 68, x + (groupWidth + layout.width) / 2 * scale + 16)}px`
    tools.style.top = `${Math.max(16, y + 20)}px`
    return `matrix3d(${[scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, x, y, 0, 1].join(',')})`
  }
  function renderSticker() {
    const visible = preview ?? position
    sticker.hidden = !visible
    if (visible) {
      sticker.style.left = `${visible.x * 100}%`
      sticker.style.top = `${visible.y * 100}%`
    }
    remove.hidden = !selected || !position || !!preview || busy
    if (position) {
      remove.style.left = `${position.x * 100}%`
      remove.style.top = `${position.y * 100}%`
      const size = layout.width * FLOWER_WIDTH_RATIO
      remove.style.transform = `translate(${size * .35}px, ${-size * .75}px)`
    }
    tool.disabled = !!position && !armed
    tool.setAttribute('aria-pressed', String(armed))
    picture.classList.toggle('is-placing', armed)
    hint.textContent = position ? 'Ziehe die Blume an deinen Lieblingsplatz.' : 'Wähle die Blume und platziere sie auf dem Foto.'
  }
  function save() {
    try {
      if (position) localStorage.setItem(FLOWER_STORAGE_KEY, JSON.stringify(position))
      else localStorage.removeItem(FLOWER_STORAGE_KEY)
    } catch { hint.textContent = 'Die Position bleibt nur für diesen Besuch gespeichert.' }
  }
  function updateAvailability() {
    hotspot.hidden = !options.canOpen() || active
  }
  function setCamera(value: DOMMatrix, source: DOMMatrix) {
    camera = value
    const rect = stage.getBoundingClientRect()
    rig.style.transform = new DOMMatrix().translate(-rect.left, -rect.top)
      .multiply(camera).translate(rect.left, rect.top).toString()
    // The full-resolution photo is registered to the SAME camera every frame,
    // so it stays on the paper rather than flying away from the book.
    card.style.transform = camera.multiply(source).toString()
  }
  async function animateCamera(returning = false) {
    const source = new DOMMatrix(bookTransform())
    const target = returning ? new DOMMatrix() : new DOMMatrix(expandedTransform()).multiply(source.inverse())
    const start = camera.toFloat64Array()
    const end = target.toFloat64Array()
    const font = parseFloat(caption.style.fontSize) || 22
    const line = parseFloat(caption.style.lineHeight) || 26
    const margin = parseFloat(caption.style.marginTop) || 18
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 850
    dialog.dataset.phase = returning ? 'zooming-out' : 'zooming-in'
    const started = performance.now()
    await new Promise<void>(resolve => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - started) / duration)
        const eased = t * t * (3 - 2 * t)
        const blend = (a: number, b: number) => a + (b - a) * eased
        setCamera(new DOMMatrix(Array.from(start, (value, i) => blend(value, end[i]))), source)
        caption.style.fontSize = `${blend(font, returning ? 22 : 18 / scale)}px`
        caption.style.lineHeight = `${blend(line, returning ? 26 : 24 / scale)}px`
        caption.style.marginTop = `${blend(margin, returning ? 18 : 12 / scale)}px`
        if (t < 1) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
  }
  async function drawCompletionMark() {
    dialog.dataset.phase = 'marking'
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const stroke of strokes) {
      const animation = stroke.animate([{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], {
        duration: reduced ? 1 : 260, easing: 'ease-in-out', fill: 'forwards',
      })
      await animation.finished
      stroke.style.strokeDashoffset = '0'
      animation.cancel()
    }
    if (!reduced) await new Promise(resolve => window.setTimeout(resolve, 140))
  }
  async function open() {
    if (active || !options.canOpen()) return
    trackEvent('photobook_photo_edit_start')
    active = busy = true
    done.checked = false
    done.disabled = false
    strokes.forEach(stroke => { stroke.style.strokeDashoffset = '1' })
    selected = false
    camera = new DOMMatrix()
    rig.style.transform = ''
    armed = dragging = false
    preview = null
    renderSticker()
    hint.hidden = true
    tools.hidden = true
    updateAvailability()
    card.style.transform = bookTransform()
    caption.style.fontSize = '22px'
    caption.style.lineHeight = '26px'
    caption.style.marginTop = '18px'
    await dialog.querySelector<HTMLImageElement>('.photo-editor-original')!.decode()
    dialog.showModal()
    options.setArtwork(position, true)
    await animateCamera()
    busy = false
    dialog.dataset.phase = 'editing'
    resize()
    tools.hidden = hint.hidden = false
    ;(position ? sticker : tool).focus({ preventScroll: true })
  }
  async function finish() {
    if (!active || busy) return
    busy = true
    done.disabled = true
    armed = dragging = false
    preview = null
    renderSticker()
    save()
    done.checked = true
    await drawCompletionMark()
    tools.hidden = hint.hidden = true
    await animateCamera(true)
    options.setArtwork(position, false)
    rig.style.transform = ''
    dialog.close()
    active = busy = false
    trackEvent('photobook_photo_edit_complete', { has_flower: Boolean(position) })
    updateAvailability()
    hotspot.focus({ preventScroll: true })
  }
  function pointerPosition(event: PointerEvent, offset = { x: 0, y: 0 }) {
    const rect = picture.getBoundingClientRect()
    return clampFlower({ x: (event.clientX - rect.left) / rect.width - offset.x,
      y: (event.clientY - rect.top) / rect.height - offset.y }, photo)
  }
  tool.addEventListener('click', () => {
    if (busy) return
    armed = !armed
    selected = false
    preview = null
    renderSticker()
    if (armed) picture.focus({ preventScroll: true })
  })
  picture.addEventListener('pointerdown', event => {
    if (busy || event.button !== 0 || (event.target as Element).closest('.flower-remove')) return
    const onSticker = !!(event.target as Element).closest('.flower-sticker')
    if (!armed && !onSticker) { selected = false; renderSticker(); return }
    event.preventDefault()
    selected = onSticker
    const rect = picture.getBoundingClientRect()
    dragOffset = onSticker && position ? {
      x: (event.clientX - rect.left) / rect.width - position.x,
      y: (event.clientY - rect.top) / rect.height - position.y,
    } : { x: 0, y: 0 }
    dragging = true
    picture.setPointerCapture(event.pointerId)
    position = pointerPosition(event, dragOffset)
    preview = null
    renderSticker()
  })
  picture.addEventListener('pointermove', event => {
    if (busy) return
    if (dragging) position = pointerPosition(event, dragOffset)
    else if (armed) preview = pointerPosition(event)
    else return
    renderSticker()
  })
  const endDrag = () => {
    if (!dragging) return
    dragging = armed = false
    preview = null
    renderSticker()
    save()
  }
  picture.addEventListener('pointerup', endDrag)
  picture.addEventListener('pointercancel', endDrag)
  picture.addEventListener('pointerleave', () => { if (!dragging) { preview = null; renderSticker() } })
  sticker.addEventListener('click', () => { if (!busy) { selected = true; renderSticker() } })
  remove.addEventListener('click', () => {
    if (busy) return
    position = preview = null
    selected = dragging = armed = false
    renderSticker()
    save()
    tool.focus({ preventScroll: true })
  })
  picture.addEventListener('keydown', event => {
    if (busy) return
    if (armed && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      position ??= { x: .5, y: .5 }
      armed = false
    } else if (position && event.target === sticker && event.key.startsWith('Arrow')) {
      event.preventDefault()
      position = clampFlower({ x: position.x + (event.key === 'ArrowRight' ? .02 : event.key === 'ArrowLeft' ? -.02 : 0),
        y: position.y + (event.key === 'ArrowDown' ? .02 : event.key === 'ArrowUp' ? -.02 : 0) }, photo)
    } else return
    renderSticker()
    save()
  })
  hotspot.addEventListener('click', () => { void open() })
  done.addEventListener('change', () => { if (done.checked) void finish() })
  dialog.addEventListener('cancel', event => { event.preventDefault(); void finish() })
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void finish() }
  })
  const resize = () => {
    if (active && !busy) {
      const source = new DOMMatrix(bookTransform())
      setCamera(new DOMMatrix(expandedTransform()).multiply(source.inverse()), source)
      caption.style.fontSize = `${18 / scale}px`
      caption.style.lineHeight = `${24 / scale}px`
      caption.style.marginTop = `${12 / scale}px`
    }
  }
  window.addEventListener('resize', resize)
  updateAvailability()
  return { get active() { return active }, updateAvailability }
}
