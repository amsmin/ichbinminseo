import { PAPER_SHAPE, FlexiblePaper } from './photobook-surface'

const LAST_TURN_DURATION = 1100

function backCoverArtwork(coverImage: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = 1400
  canvas.height = 1200
  const context = canvas.getContext('2d')!
  context.scale(2, 2)
  const outline = new Path2D(PAPER_SHAPE)
  context.save()
  context.clip(outline)
  // This clear patch comes from the supplied cover, so the red remains its
  // original colour and texture rather than a newly styled rectangle.
  context.drawImage(coverImage, 840, 210, 40, 40, 0, 0, 700, 600)
  context.restore()
  context.strokeStyle = '#080808'
  context.lineWidth = 4.8
  context.lineJoin = 'round'
  context.stroke(outline)

  const priced = document.createElement('canvas')
  priced.width = canvas.width
  priced.height = canvas.height
  const ink = priced.getContext('2d')!
  ink.drawImage(canvas, 0, 0)
  ink.scale(2, 2)
  // The sheet's back is viewed from the other side, so mirror the ink before
  // the paper mesh turns it left. The resulting lettering reads normally.
  ink.translate(700, 0)
  ink.scale(-1, 1)
  ink.translate(80, 535)
  ink.rotate(-8 * Math.PI / 180)
  ink.fillStyle = '#fff'
  ink.strokeStyle = '#fff'
  ink.lineWidth = 1.2
  ink.lineJoin = 'round'
  ink.font = '700 66px "Chalkboard SE", "Marker Felt", "Arial Rounded MT Bold", Arial, sans-serif'
  ink.textBaseline = 'alphabetic'
  ink.strokeText('€2.-', 0, 0)
  ink.fillText('€2.-', 0, 0)
  return { plain: canvas, priced }
}

/** The remaining right-hand sheet is the outside of the closing page block. */
export function mountFinalFold(options: {
  scene: HTMLElement
  cover: HTMLElement
  papers: FlexiblePaper[]
  lastFront: HTMLCanvasElement
  blankPage: HTMLCanvasElement
  projection: string
  coverImage: HTMLImageElement
  onPhase: (phase: string) => void
}) {
  const { scene, cover, papers, lastFront, onPhase } = options
  const lastPaper = papers.at(-1)!
  const lastHost = scene.querySelector<HTMLElement>(`.paper-leaf[data-page="${papers.length}"]`)!
  const body = scene.querySelector<HTMLElement>('.book-body')!
  const stack = scene.querySelector<HTMLElement>('.stack-projection')!
  const coverProjection = cover.parentElement!
  const coverLettering = cover.querySelector<HTMLElement>('.cover-lettering')!
  const leftLayers = [...scene.querySelectorAll<HTMLElement>('.paper-leaf[data-page]')]
    .slice(0, -1).map(page => page.parentElement!)
  const { plain, priced } = backCoverArtwork(options.coverImage)
  lastPaper.setArtwork(lastFront, priced)
  const bundle = [-36, -24, -12].map(depth => {
    const projection = document.createElement('div')
    projection.className = 'book-projection paper-projection final-page-bundle'
    projection.style.zIndex = String(papers.length + 5)
    projection.hidden = true
    const leaf = document.createElement('div')
    leaf.className = 'paper-leaf'
    projection.append(leaf)
    scene.insertBefore(projection, lastHost.parentElement)
    const paper = new FlexiblePaper(leaf, options.projection, depth)
    paper.setArtwork(options.blankPage, options.blankPage)
    return paper
  })

  function fold(progress: number) {
    lastPaper.setProgress(progress)
    bundle.forEach(sheet => sheet.setProgress(progress))
    // The stationary page block is covered by the last moving sheet at the
    // start. Let its exposed edges recede while that sheet carries the book
    // leftward; a rectangular clip would leave a white panel in mid-turn.
    const remaining = Math.max(0, Math.min(1, (0.20 - progress) / 0.16))
    const opacity = String(remaining * remaining)
    body.style.opacity = opacity
    stack.style.opacity = opacity
    // The last exposed left page is enclosed by the red outside face. It
    // should not poke out as a white triangle once the covers meet.
    const exposedInside = Math.max(0, Math.min(1, (1 - progress) / 0.07))
    leftLayers.forEach(layer => { layer.style.opacity = String(exposedInside * exposedInside) })
    lastHost.parentElement!.style.zIndex = String(papers.length + 6)
  }

  function animate(duration: number, update: (progress: number) => void) {
    return new Promise<void>(resolve => {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      const animation = lastHost.animate([{ '--final-fold': '0' }, { '--final-fold': '1' }], {
        duration: reduced ? 1 : duration,
        easing: 'cubic-bezier(.42, 0, .58, 1)',
        fill: 'forwards',
      })
      let frame = 0
      const tick = () => {
        update(animation.effect?.getComputedTiming().progress ?? 0)
        frame = requestAnimationFrame(tick)
      }
      tick()
      void animation.finished.then(() => {
        cancelAnimationFrame(frame)
        update(1)
        animation.cancel()
        resolve()
      })
    })
  }

  return {
    setAvailable(available: boolean) {
      scene.querySelectorAll<HTMLElement>('.final-page-bundle').forEach(layer => {
        layer.hidden = !available
      })
    },
    async play(toBack: boolean) {
      onPhase(toBack ? 'book-closing' : 'book-reopening')
      await animate(LAST_TURN_DURATION, progress => fold(toBack ? progress : 1 - progress))
    },
    async restart() {
      onPhase('book-returning-to-front')
      // Change the hidden front of the moving bundle while its red back is
      // facing the reader; the ordinary last page is restored under the cover.
      lastPaper.setArtwork(plain, priced)
      coverProjection.style.zIndex = String(papers.length + 7)
      coverLettering.style.visibility = 'hidden'
      await animate(950, progress => {
        fold(1 - progress)
        cover.style.transform = `rotateY(${-180 * (1 - progress)}deg)`
        if (progress >= 0.5) coverLettering.style.visibility = ''
      })
      body.style.opacity = ''
      stack.style.opacity = ''
      leftLayers.forEach(layer => { layer.style.opacity = '' })
      lastPaper.setArtwork(lastFront, priced)
    },
  }
}
