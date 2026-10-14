import type { FlexiblePaper } from './photobook-surface'

/** Turn the book and its leaves together as one two-sided object. */
export function mountBookEnding(options: {
  scene: HTMLElement
  cover: HTMLElement
  papers: FlexiblePaper[]
  projection: string
  onPhase: (phase: string) => void
}) {
  const { scene, cover, papers, onPhase } = options
  const projection = new DOMMatrix(options.projection)
  const inverse = projection.inverse()
  const depth = 28
  const rig = document.createElement('div')
  rig.className = 'book-ending-rig'
  const front = document.createElement('div')
  front.className = 'book-ending-face book-ending-front'
  front.append(...scene.childNodes)
  rig.append(front)

  // Reuse the original outlined cover/body artwork, without its title. The
  // backing under the title is already sampled from the supplied red PNG.
  const back = document.createElement('div')
  back.className = 'book-ending-face book-ending-back'
  back.setAttribute('aria-hidden', 'true')
  back.append(front.querySelector('.book-body')!.cloneNode(true))
  const backCover = cover.parentElement!.cloneNode(true) as HTMLElement
  backCover.style.zIndex = '1'
  const backHinge = backCover.querySelector<HTMLElement>('.cover-hinge')!
  backHinge.style.transform = 'none'
  backHinge.querySelector('.cover-back')!.remove()
  backHinge.querySelector('.cover-lettering')!.remove()
  backHinge.querySelector('.cover-front')!.insertAdjacentHTML('beforeend', `
    <svg class="book-ending-price" viewBox="0 0 700 600" aria-hidden="true">
      <text x="80" y="535" transform="rotate(-8 80 535)" fill="#080808" font-family="Arial, Helvetica, sans-serif" font-size="33" font-weight="400">€2.-</text>
    </svg>`)
  back.append(backCover)
  // Cloned SVG masks and filters must never collide with the live front cover.
  const ids = [...back.querySelectorAll('[id]')].map(node => node.id)
  for (const node of back.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      let value = attribute.value
      if (attribute.name === 'id') value = `ending-${value}`
      else for (const id of ids) value = value.replaceAll(`url(#${id})`, `url(#ending-${id})`)
      if (value !== attribute.value) node.setAttribute(attribute.name, value)
    }
  }
  back.style.transform = projection.multiply(new DOMMatrix().translate(700, 0, -depth).rotateAxisAngle(0, 1, 0, 180))
    .multiply(inverse).toString()
  rig.append(back)

  // Close all four sides of the slab, not just its fore-edge: at 90 degrees
  // the page block must remain solid rather than collapse into a red hairline.
  const edges = [
    { width: depth, height: 600, spine: false, horizontal: false,
      matrix: new DOMMatrix().translate(700, 0, 0).rotateAxisAngle(0, 1, 0, 90) },
    { width: depth, height: 600, spine: true, horizontal: false,
      matrix: new DOMMatrix().rotateAxisAngle(0, 1, 0, 90) },
    { width: 700, height: depth, spine: false, horizontal: true,
      matrix: new DOMMatrix().rotateAxisAngle(1, 0, 0, -90) },
    { width: 700, height: depth, spine: false, horizontal: true,
      matrix: new DOMMatrix().translate(0, 600, 0).rotateAxisAngle(1, 0, 0, -90) },
  ].map(({ width, height, spine, horizontal, matrix }) => {
    const edge = document.createElement('div')
    edge.className = `book-ending-edge${spine ? ' book-ending-spine' : ''}${horizontal ? ' book-ending-horizontal' : ''}`
    edge.setAttribute('aria-hidden', 'true')
    if (!spine) edge.innerHTML = '<i></i><i></i><i></i>'
    edge.style.width = `${width}px`
    edge.style.height = `${height}px`
    edge.style.transform = projection.multiply(matrix).toString()
    edge.hidden = true
    rig.append(edge)
    return edge
  })
  scene.append(rig)
  const coverLettering = cover.querySelector<HTMLElement>('.cover-lettering')!

  async function animate(duration: number, update: (progress: number) => void) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = rig.animate([{ '--ending-progress': '0' }, { '--ending-progress': '1' }], {
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
    await animation.finished
    cancelAnimationFrame(frame)
    update(1)
    animation.cancel()
  }

  function closeBook(progress: number) {
    cover.style.transform = `rotateY(${-180 * (1 - progress)}deg)`
    // Until the hinge passes vertical, the pages hide the cover's inner face;
    // afterwards its outer red face sits above the closing paper block.
    cover.parentElement!.style.zIndex = progress < 0.5 ? '2' : String(papers.length + 6)
    papers.forEach((paper, index) => paper.setProgress(index < papers.length - 1 ? 1 - progress : 0))
  }

  function flipBook(progress: number) {
    // Rotate in book coordinates, not around the screen. The resting back
    // lands on the exact same projected rectangle as the resting front.
    const turn = new DOMMatrix().translate(350, 300, -depth / 2)
      .rotateAxisAngle(0, 1, 0, -180 * progress).translate(-350, -300, depth / 2)
    rig.style.transform = progress === 0 ? '' : projection.multiply(turn).multiply(inverse).toString()
    rig.dataset.flip = progress.toFixed(5)
    // A projected raster face has no visible area at exactly 90 degrees.
    // Cull it explicitly there to avoid subpixel red streaks from SVG layers;
    // the four physical side faces remain visible throughout the turn.
    const edgeOn = Math.abs(Math.cos(Math.PI * progress)) < 0.015
    front.style.visibility = back.style.visibility = edgeOn ? 'hidden' : ''
    // At rest the original illustration already contains its paper edges.
    // Keep the temporary depth faces from protruding beyond that artwork.
    edges.forEach(edge => { edge.hidden = progress === 0 || progress === 1 })
  }

  return {
    async play(toBack: boolean) {
      if (toBack) {
        // The title is never exposed while the open book turns toward its back.
        coverLettering.style.visibility = 'hidden'
        onPhase('book-flipping')
        await animate(1200, progress => {
          closeBook(progress)
          flipBook(progress)
        })
      } else {
        onPhase('book-unflipping')
        await animate(1200, progress => {
          closeBook(1 - progress)
          flipBook(1 - progress)
        })
        coverLettering.style.visibility = ''
      }
    },
    async restart() {
      // The front cover is already closed behind the visible back cover.
      // Reveal its title as that face turns toward the reader.
      coverLettering.style.visibility = ''
      onPhase('book-turning-to-front')
      await animate(1000, progress => flipBook(1 - progress))
    },
  }
}
