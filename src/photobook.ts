import './photobook.css'
import { assetUrl } from './asset-url'
import { mapQuad, projectionMatrix, type Quad } from './photobook-geometry'
import { FlexiblePaper } from './photobook-surface'
import { createPaperMaterials, createPhotoPage, createTextPage } from './photobook-material'
import { extendBackground } from './photobook-background'
import { mountGreeting } from './photobook-greeting'
import { mountPhotoEditor } from './photobook-photo-editor'
import { FLOWER_URL, readFlower } from './photobook-photo'
import { BOOK_PROJECTS, mountProjectLinks } from './photobook-project-links'
import { createInstagramBack, mountInstagramLink } from './photobook-instagram'
import { mountFinalFold } from './photobook-final-fold'

const BACKGROUND_IMAGE = assetUrl('/book2.png')
const CLOSED_BOOK_IMAGE = assetUrl('/book1.png')
const OPEN_BOOK_IMAGE = assetUrl('/book3.png')
const SECOND_PAGE_IMAGE = assetUrl('/das Buch 3.png')
const PORTRAIT_IMAGE = assetUrl('/minseo.jpeg')
const TURN_DURATION = 1000
const pageTurnSound = new Audio(assetUrl('/종이.mp3'))
pageTurnSound.preload = 'auto'
pageTurnSound.volume = 0.55

function playPageTurnSound() {
  // Start within the click/key gesture so browser autoplay restrictions are
  // respected. The original ~0.73s rustle fits inside the 1s page turn.
  pageTurnSound.pause()
  pageTurnSound.currentTime = 0
  void pageTurnSound.play().catch(() => {
    // An unavailable or blocked sound must never interrupt the book animation.
  })
}

window.addEventListener('pagehide', () => { pageTurnSound.pause() })

const PROJECT_PAGE_TITLES = ['Ich mag ...', ...BOOK_PROJECTS.map(project => project.title), 'Tschüss!♥️']
const LAST_PAGE = 3 + PROJECT_PAGE_TITLES.length
const BACK_COVER = LAST_PAGE + 1
const RECT: Quad = [[0, 0], [700, 0], [700, 600], [0, 600]]

// Measured on the source PNGs. The closed cover is the authoritative plane.
// book3's two surfaces are registered to this plane, never swapped in as a
// second whole-book image. Its baked-in checkerboard lies outside the masks.
const CLOSED_QUAD: Quad = [[324, 242], [987, 78], [1305, 653], [567, 842]]
const PAGE_QUAD: Quad = [[639, 241], [1126, 93], [1454, 598], [902, 782]]
const SECOND_PAGE_QUAD: Quad = [[670, 260], [1118, 140], [1360, 596], [861, 727]]
const INSIDE_QUAD: Quad = [[74, 312], [639, 241], [902, 782], [315, 892]]
const COVER_MASK = 'M322 238 L314 215 L990 50 L1325 634 L1305 653 L567 842 Z'
const INSIDE_MASK = 'M79 309 L606 225 Q628 220 638 242 L902 782 L324 891 Q315 895 311 884 L75 325 Q70 314 79 309 Z'
const LABEL_REGION = 'M500 320 L970 240 L1190 560 L550 680 Z'

function coverLettering() {
  // Reuse the PNG's exact glyphs, but scale only the lettering. A feathered
  // mask blends the old lettering area into a sample of the original red.
  return `<defs>
    <clipPath id="label-region"><path d="${LABEL_REGION}" /></clipPath>
    <clipPath id="label-backing"><path d="M450 295 L982 205 L1230 585 L515 725 Z" /></clipPath>
    <filter id="letter-ink" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4 0 0 0 1" />
      <feComposite in2="SourceAlpha" operator="in" />
    </filter>
    <filter id="label-feather"><feGaussianBlur stdDeviation="12" /></filter>
    <mask id="smaller-label-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1535" height="1024">
      <rect width="1535" height="1024" fill="white" />
      <path d="${LABEL_REGION}" fill="black" filter="url(#label-feather)" />
    </mask>
  </defs>
  <g clip-path="url(#label-backing)">
    <svg x="430" y="170" width="840" height="580" viewBox="660 220 180 70" preserveAspectRatio="none">
      <image href="${CLOSED_BOOK_IMAGE}" width="1535" height="1024" />
    </svg>
  </g>
  <image href="${CLOSED_BOOK_IMAGE}" width="1535" height="1024" mask="url(#smaller-label-mask)" clip-path="url(#front-mask)" filter="url(#body-ink)" />
  <g class="cover-lettering" transform="translate(835 465) scale(.70) translate(-835 -465)">
    <image href="${CLOSED_BOOK_IMAGE}" width="1535" height="1024" filter="url(#letter-ink)" clip-path="url(#label-region)" />
  </g>`
}

function texture(id: string, src: string, path: string, width = 1536) {
  // book1's red pixels have alpha 252–254. Back them with the original blue
  // background so the white-page lettering cannot bleed through the cover.
  const matte = src === CLOSED_BOOK_IMAGE ? `
    <defs><mask id="${id}-alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="1535" height="1024" style="mask-type: alpha">
      <image href="${src}" width="1535" height="1024" />
    </mask></defs>
    <image href="${BACKGROUND_IMAGE}" x="-563.2" y="-109.2266667" width="2048" height="1365.3333333"
      mask="url(#${id}-alpha)" clip-path="url(#${id})" />` : ''
  return `<svg class="book-texture" viewBox="0 0 ${width} 1024" aria-hidden="true">
    <defs><clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${path}" /></clipPath></defs>
    ${matte}
    ${src === CLOSED_BOOK_IMAGE ? coverLettering() : `<image href="${src}" width="${width}" height="1024" clip-path="url(#${id})" ${id === 'inside-mask' ? 'filter="url(#body-ink)"' : ''} />`}
  </svg>`
}

// A plain page is sampled from the blank margin of the supplied white paper.
// No new lighting, gradient, or replacement illustration is introduced.
function blankPaper() {
  return `<svg class="blank-paper" width="700" height="600" viewBox="0 0 700 600" aria-hidden="true">
    <svg x="0" y="0" width="700" height="600" viewBox="1000 240 38 38" preserveAspectRatio="none">
      <image href="${OPEN_BOOK_IMAGE}" width="1536" height="1024" />
    </svg>
  </svg>`
}

document.title = 'das Buch'
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="photobook-app" aria-label="das Buch">
    <p class="time-greeting" lang="de" aria-live="polite" aria-atomic="true"><span id="time-greeting-label"></span></p>
    <div id="image-stage" class="image-stage" data-state="closed" data-spread="0" aria-busy="true">
      <img class="background-image" src="${BACKGROUND_IMAGE}" alt="" aria-hidden="true" draggable="false" />
      <div class="book-scene" role="img" aria-label="ich bin minseo kim이라고 적힌 닫힌 책">
        <svg class="book-body" viewBox="0 0 1535 1024" aria-hidden="true">
          <defs><mask id="body-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1535" height="1024">
            <rect width="1535" height="1024" fill="white" /><path d="${COVER_MASK}" fill="black" />
          </mask>
          <filter id="body-ink" color-interpolation-filters="sRGB" x="-1%" y="-1%" width="102%" height="102%">
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4 0 0 0 1" />
            <feComposite in2="SourceAlpha" operator="in" />
            <feMorphology operator="dilate" radius=".8" />
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            <feComponentTransfer><feFuncA type="linear" slope="1.02" /></feComponentTransfer>
          </filter></defs>
          <image href="${CLOSED_BOOK_IMAGE}" width="1535" height="1024" mask="url(#body-mask)" filter="url(#body-ink)" />
        </svg>
        <div class="book-projection stack-projection">
          <div class="paper-stack">${blankPaper()}<svg class="paper-ink" viewBox="0 0 700 600" aria-hidden="true"><path d="M1 1 H699 V599 H1 Z" fill="none" stroke="#080808" stroke-width="3.6" /></svg></div>
        </div>
        ${Array.from({ length: LAST_PAGE }, (_, index) => `
          <div class="book-projection paper-projection">
            <div class="paper-leaf" data-page="${index + 1}"></div>
          </div>
        `).join('')}
        <div class="book-projection cover-projection">
          <div id="cover-layer" class="cover-hinge">
            <div class="cover-face cover-front">${texture('front-mask', CLOSED_BOOK_IMAGE, COVER_MASK, 1535)}</div>
            <div class="cover-face cover-back">${texture('inside-mask', OPEN_BOOK_IMAGE, INSIDE_MASK)}</div>
          </div>
        </div>
      </div>
      <span class="book-status" aria-live="polite"></span>
      <button id="previous-button" class="image-hotspot image-hotspot-previous" type="button" aria-label="이전 페이지 또는 책 닫기" disabled></button>
      <button id="next-button" class="image-hotspot image-hotspot-next" type="button" aria-label="책 열기 또는 다음 페이지" disabled></button>
    </div>
  </main>
`

const disposeGreeting = mountGreeting(document.querySelector<HTMLElement>('#time-greeting-label')!)
import.meta.hot?.dispose(disposeGreeting)

const imageStage = document.querySelector<HTMLDivElement>('#image-stage')!
const scene = document.querySelector<HTMLDivElement>('.book-scene')!
const cover = document.querySelector<HTMLDivElement>('#cover-layer')!
const pages = [...document.querySelectorAll<HTMLDivElement>('.paper-leaf')]
const previousButton = document.querySelector<HTMLButtonElement>('#previous-button')!
const nextButton = document.querySelector<HTMLButtonElement>('#next-button')!
const status = document.querySelector<HTMLSpanElement>('.book-status')!
const stageQuad = CLOSED_QUAD.map(([x, y]) => [422.4 + x * 0.75, 81.92 + y * 0.75]) as Quad
const bookProjection = projectionMatrix(RECT, stageQuad)
const flexiblePages: FlexiblePaper[] = []

document.querySelectorAll<HTMLDivElement>('.cover-projection, .stack-projection').forEach(projection => {
  projection.style.transform = bookProjection
})
document.querySelector<SVGSVGElement>('.cover-front .book-texture')!.style.transform = mapQuad(CLOSED_QUAD, RECT)
document.querySelector<SVGSVGElement>('.cover-back .book-texture')!.style.transform = mapQuad(INSIDE_QUAD, RECT)
const paperRect: Quad = [[4, 3], [697, 3], [697, 597], [4, 597]]

function resizeBook() {
  scene.style.setProperty('--book-scale', String(imageStage.getBoundingClientRect().width / 1536))
}
new ResizeObserver(resizeBook).observe(imageStage)
resizeBook()

let spread = 0
let isTurning = false
let ready = false
let photoEditor: ReturnType<typeof mountPhotoEditor> | undefined
let projectLinks: ReturnType<typeof mountProjectLinks> | undefined
let instagramLink: ReturnType<typeof mountInstagramLink> | undefined
let bookEnding: ReturnType<typeof mountFinalFold> | undefined

function renderState() {
  imageStage.dataset.spread = String(spread)
  imageStage.dataset.state = spread === BACK_COVER ? 'back-cover' : spread === 0 ? 'closed' : 'open'
  imageStage.setAttribute('aria-busy', String(!ready || isTurning))
  previousButton.disabled = !ready || spread === 0 || isTurning
  nextButton.disabled = !ready || isTurning
  nextButton.setAttribute('aria-label', spread === BACK_COVER ? '앞표지로 돌아가기'
    : spread === LAST_PAGE ? '책을 뒤집어 뒷표지 보기' : '책 열기 또는 다음 페이지')
  previousButton.setAttribute('aria-label', spread === BACK_COVER ? '책을 다시 펼쳐 마지막 페이지 보기' : '이전 페이지 또는 책 닫기')
  // All remaining sheets are present beneath the current one. Hiding them
  // until clicked used to replace the flat page block with a curved sheet.
  const turnedPages = Math.max(0, spread - 1)
  pages.forEach((page, index) => {
    if (spread === BACK_COVER) return
    const onLeft = index < turnedPages
    flexiblePages[index].setProgress(onLeft ? 1 : 0)
    // On the right the first remaining sheet is on top; on the left the
    // last turned sheet is on top. Reversing a turn preserves this order.
    page.parentElement!.style.zIndex = String(spread === LAST_PAGE && index === pages.length - 1
      ? pages.length + 6 : onLeft ? 4 + index : 4 + pages.length - index)
  })
  bookEnding?.setAvailable(spread === LAST_PAGE || spread === BACK_COVER)
  if (spread !== BACK_COVER) cover.parentElement!.style.zIndex = spread === 0 ? String(pages.length + 6) : '2'
  scene.setAttribute('aria-label', spread === BACK_COVER ? '왼쪽 하단에 €2.- 가격이 적힌 빨간 뒷표지'
    : spread === 0
    ? 'ich bin minseo kim이라고 적힌 닫힌 책'
    : spread === 1 ? 'Ich habe diese Projekte gemacht.라고 적힌 펼쳐진 책'
    : spread === 2 ? 'Ich mache, was ich machen möchte.라고 적힌 펼쳐진 책'
    : spread === 3 ? '민서의 사진과 Und das bin ich :) 문구가 있는 펼쳐진 책'
    : `${PROJECT_PAGE_TITLES[spread - 4]} 문구가 있는 펼쳐진 책, ${spread}번째 페이지`)
  status.textContent = spread === BACK_COVER ? '책의 뒷표지입니다.' : spread === 0 ? '책이 닫혀 있습니다.' : `${spread}번째 페이지`
  photoEditor?.updateAvailability()
  projectLinks?.update()
  instagramLink?.update()
}

async function turnPage(direction: 'next' | 'previous') {
  if (!ready || isTurning || photoEditor?.active) return
  const nextSpread = spread === BACK_COVER && direction === 'next' ? 0
    : Math.max(0, Math.min(BACK_COVER, spread + (direction === 'next' ? 1 : -1)))
  if (nextSpread === spread) return

  isTurning = true
  renderState()
  imageStage.classList.add('is-turning')
  if (nextSpread === BACK_COVER || spread === BACK_COVER) {
    playPageTurnSound()
    if (nextSpread === 0) await bookEnding!.restart()
    else await bookEnding!.play(nextSpread === BACK_COVER)
    spread = nextSpread
    if (spread === 0) history.replaceState({ ...history.state, photobookSpread: 0 }, '')
    isTurning = false
    imageStage.classList.remove('is-turning')
    renderState()
    return
  }
  const isCover = spread === 0 || nextSpread === 0
  const opening = direction === 'next'
  const leaf = isCover ? cover : pages[(opening ? spread : nextSpread) - 1]
  cover.parentElement!.style.zIndex = isCover ? String(pages.length + 6) : '2'
  imageStage.dataset.state = isCover ? (opening ? 'opening' : 'closing') : 'page-turning'
  // Keep each leaf once turned. The reverse animation uses the very same node.
  if (!isCover) {
    leaf.parentElement!.style.zIndex = String(spread === LAST_PAGE && direction === 'previous'
      ? pages.length + 7 : pages.length + 5)
  }
  const from = `rotateY(${opening ? 0 : -180}deg)`
  const to = `rotateY(${opening ? -180 : 0}deg)`
  const animation = leaf.animate(isCover
    ? [{ transform: from }, { transform: to }]
    : [{ '--paper-progress': opening ? '0' : '1' }, { '--paper-progress': opening ? '1' : '0' }], {
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : TURN_DURATION,
    easing: 'cubic-bezier(.42, 0, .58, 1)',
    fill: 'forwards',
  })
  playPageTurnSound()
  let frame = 0
  if (!isCover) {
    const paper = flexiblePages[pages.indexOf(leaf)]
    const bend = () => {
      const progress = animation.effect?.getComputedTiming().progress ?? 0
      paper.setProgress(opening ? progress : 1 - progress)
      frame = requestAnimationFrame(bend)
    }
    bend()
  }
  await animation.finished
  cancelAnimationFrame(frame)
  if (isCover) leaf.style.transform = to
  else flexiblePages[pages.indexOf(leaf)].setProgress(opening ? 1 : 0)
  animation.cancel()
  spread = nextSpread
  isTurning = false
  imageStage.classList.remove('is-turning')
  renderState()
}

previousButton.addEventListener('click', () => { void turnPage('previous') })
nextButton.addEventListener('click', () => { void turnPage('next') })
window.addEventListener('keydown', (event) => {
  if (photoEditor?.active) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  void turnPage(event.key === 'ArrowLeft' ? 'previous' : 'next')
})

void Promise.all([BACKGROUND_IMAGE, CLOSED_BOOK_IMAGE, OPEN_BOOK_IMAGE, SECOND_PAGE_IMAGE, PORTRAIT_IMAGE, FLOWER_URL].map(async (src) => {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
})).then(async images => {
  extendBackground(images[0], imageStage)
  flexiblePages.push(...pages.map(page => new FlexiblePaper(page, bookProjection)))
  const materials = await createPaperMaterials(images[2], PAGE_QUAD, paperRect)
  // Reuse the supplied lettering on sheet two, while retaining the existing
  // paper material, mesh, and blank reverse side on every sheet.
  const secondPage = await createPaperMaterials(images[3], SECOND_PAGE_QUAD, paperRect, {
    captionBounds: [800, 310, 1200, 525],
    paperImage: images[2],
  })
  const flowerPosition = readFlower(images[4])
  const thirdPage = createPhotoPage(materials.back, images[4], { image: images[5], position: flowerPosition })
  const pageFronts = [materials.front, secondPage.front, thirdPage,
    ...PROJECT_PAGE_TITLES.map(title => createTextPage(materials.back, title))]
  const instagramBack = createInstagramBack(materials.back)
  flexiblePages.forEach((page, index) => page.setArtwork(
    pageFronts[index],
    index === 1 ? instagramBack : materials.back,
  ))
  photoEditor = mountPhotoEditor({
    photo: images[4], stage: imageStage, projection: bookProjection,
    initialPosition: flowerPosition,
    canOpen: () => ready && spread === 3 && !isTurning,
    setArtwork: (position, hidden) => {
      flexiblePages[2].setArtwork(hidden ? materials.back
        : createPhotoPage(materials.back, images[4], { image: images[5], position }), materials.back)
    },
  })
  projectLinks = mountProjectLinks(imageStage, bookProjection,
    () => ready && !isTurning && !photoEditor?.active ? spread : null)
  instagramLink = mountInstagramLink(imageStage, bookProjection,
    () => ready && !isTurning && spread === 3 && !photoEditor?.active)
  bookEnding = mountFinalFold({ scene, cover, papers: flexiblePages,
    lastFront: pageFronts.at(-1)!, blankPage: materials.back,
    projection: bookProjection, coverImage: images[1],
    onPhase: phase => { imageStage.dataset.state = phase },
  })
  const returnPage = history.state?.photobookSpread
  if (Number.isInteger(returnPage) && returnPage >= 5 && returnPage <= LAST_PAGE) {
    spread = returnPage
    cover.style.transform = 'rotateY(-180deg)'
  }
  ready = true
  renderState()
}).catch(error => {
  imageStage.setAttribute('aria-busy', 'false')
  status.textContent = error instanceof Error && error.message.includes('WebGL')
    ? '종이를 표시하려면 WebGL을 지원하는 브라우저와 그래픽 가속이 필요합니다.'
    : '책 화면을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'
})
