import { assetUrl } from './asset-url'
import type { FlexiblePaper } from './photobook-surface'

export const LETTER_LINES = [
  '바이브코딩 워크숍을 끝맺으며..',
  '수요일 밤마다 홍대에 모여 재미있는 작업을 함께할 수 있어 참 좋았어요.',
  '날개를 달아주신 병준 선생님께 감사드리고,',
  '매주 함께했던 수강생분들도 반가웠어요!',
  '함께 가을을 보낼 수 있어 기뻤답니다',
  '다들 건강하시고, 또 뵐 수 있기를!',
  '뿅!',
] as const

const FONT = '"Photobook Pen", "Apple SD Gothic Neo", sans-serif'
const TEXT_X = 66
const TEXT_WIDTH = 590
const PAPER_WIDTH = 700
const PAPER_HEIGHT = 600
type Rect = { x: number; y: number; width: number; height: number }
type Glyph = {
  char: string; x: number; y: number; width: number; size: number
  start: number; end: number; bounds: Rect
}

export async function loadLetterFont() {
  const face = new FontFace('Photobook Pen', `url("${assetUrl('/fonts/NanumPenScript-Regular.ttf')}")`, {
    style: 'normal', weight: '400',
  })
  document.fonts.add(await face.load())
}

function wrap(context: CanvasRenderingContext2D, paragraph: string) {
  const lines: string[] = []
  let current = ''
  for (const word of paragraph.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || context.measureText(candidate).width <= TEXT_WIDTH) current = candidate
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** The note is drawn on the page texture, so it shares the book's perspective and bend. */
export function createLetterWriter(blank: HTMLCanvasElement, paper: FlexiblePaper) {
  const scale = blank.width / PAPER_WIDTH
  const canvas = document.createElement('canvas')
  canvas.width = blank.width
  canvas.height = blank.height
  const ink = document.createElement('canvas')
  ink.width = canvas.width
  ink.height = canvas.height
  const context = canvas.getContext('2d')!
  const inkContext = ink.getContext('2d')!
  for (const target of [context, inkContext]) {
    target.setTransform(scale, 0, 0, scale, 0, 0)
    target.textBaseline = 'alphabetic'
    target.fillStyle = '#41403d'
  }

  let size = 40
  let body: string[] = []
  let lineHeight = 0
  for (; size >= 30; size--) {
    context.font = `${size}px ${FONT}`
    body = LETTER_LINES.slice(1).flatMap(paragraph => wrap(context, paragraph))
    lineHeight = Math.round(size * 1.2)
    if (190 + (body.length - 1) * lineHeight + size * .3 <= 550) break
  }
  const displayLines = [
    { text: LETTER_LINES[0], y: 116, size: Math.min(46, size + 7) },
    ...body.map((text, index) => ({ text, y: 190 + index * lineHeight, size })),
  ]
  const glyphs: Glyph[] = []
  let duration = 1250 // Hold on a visibly blank page after the turn completes.
  displayLines.forEach((line, index) => {
    if (index) duration += index === 1 ? 520 : 210
    context.font = `${line.size}px ${FONT}`
    let x = TEXT_X
    for (const char of Array.from(line.text)) {
      const width = context.measureText(char).width
      const time = char === ' ' ? 55 : /[.,!]/.test(char) ? 105 : 130
      glyphs.push({ char, x, y: line.y, width, size: line.size,
        start: duration, end: duration + time,
        bounds: { x: x - 7, y: line.y - line.size * 1.3,
          width: width + 14, height: line.size * 1.75 } })
      x += width
      duration += time
    }
  })

  let frame = 0
  let startedAt = 0
  let lastDrawnAt = 0
  let finished = 0
  let partial: Rect | null = null

  function drawGlyph(target: CanvasRenderingContext2D, glyph: Glyph) {
    target.font = `${glyph.size}px ${FONT}`
    target.fillText(glyph.char, glyph.x, glyph.y)
  }

  function restore(area: Rect) {
    const x = Math.max(0, Math.floor(area.x))
    const y = Math.max(0, Math.floor(area.y))
    const right = Math.min(PAPER_WIDTH, Math.ceil(area.x + area.width))
    const bottom = Math.min(PAPER_HEIGHT, Math.ceil(area.y + area.height))
    if (right <= x || bottom <= y) return
    context.clearRect(x, y, right - x, bottom - y)
    context.drawImage(blank, x * scale, y * scale, (right - x) * scale, (bottom - y) * scale,
      x, y, right - x, bottom - y)
    context.drawImage(ink, x * scale, y * scale, (right - x) * scale, (bottom - y) * scale,
      x, y, right - x, bottom - y)
  }

  function paint(time: number) {
    let dirty = partial
    partial = null
    while (finished < glyphs.length && time >= glyphs[finished].end) {
      const glyph = glyphs[finished++]
      if (glyph.char !== ' ') { drawGlyph(inkContext, glyph); dirty = union(dirty, glyph.bounds) }
    }
    const active = glyphs[finished]
    if (active && active.char !== ' ' && time >= active.start) {
      const progress = Math.min(1, Math.max(0, (time - active.start) / (active.end - active.start)))
      const stroke = progress * progress * (3 - 2 * progress)
      partial = active.bounds
      dirty = union(dirty, active.bounds)
      restore(dirty)
      context.save()
      context.beginPath()
      const tip = active.x + active.width * stroke
      context.moveTo(active.x - 3, active.bounds.y)
      context.lineTo(tip, active.bounds.y)
      context.lineTo(tip + active.size * .24, active.bounds.y + active.bounds.height)
      context.lineTo(active.x - 3, active.bounds.y + active.bounds.height)
      context.closePath()
      context.clip()
      context.globalAlpha = .45 + .55 * stroke
      drawGlyph(context, active)
      context.restore()
    } else if (dirty) restore(dirty)
    if (dirty) paper.updateFrontArtwork(canvas, {
      x: dirty.x * scale, y: dirty.y * scale,
      width: dirty.width * scale, height: dirty.height * scale,
    })
  }

  function stop() { cancelAnimationFrame(frame); frame = 0 }

  function reset() {
    stop()
    finished = 0
    partial = null
    inkContext.clearRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT)
    context.clearRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT)
    context.drawImage(blank, 0, 0, PAPER_WIDTH, PAPER_HEIGHT)
    paper.updateFrontArtwork(canvas)
  }

  function start() {
    stop()
    startedAt = performance.now()
    lastDrawnAt = 0
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (now: number) => {
      const elapsed = now - startedAt
      if (reduced && elapsed < 350) { frame = requestAnimationFrame(tick); return }
      if (elapsed - lastDrawnAt >= 30 || elapsed >= duration) {
        paint(reduced ? Number.POSITIVE_INFINITY : elapsed)
        lastDrawnAt = elapsed
      }
      frame = finished < glyphs.length && !reduced ? requestAnimationFrame(tick) : 0
    }
    frame = requestAnimationFrame(tick)
  }

  reset()
  return { canvas, reset, start, stop }
}
