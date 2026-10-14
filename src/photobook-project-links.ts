import { mapQuad, type Quad } from './photobook-geometry'
import { TEXT_PAGE_FONT } from './photobook-material'
import { trackEvent } from './analytics'

export const BOOK_PROJECTS = [
  { page: 5, title: 'die Brille', label: '안경', experience: 'glasses' },
  { page: 6, title: 'der Hund', label: '흰둥이', experience: 'shiro' },
  { page: 7, title: 'Berlin', label: '베를린 기차역', experience: 'berlin' },
  { page: 8, title: 'Minecraft', label: '마인크래프트', experience: 'minecraft' },
  { page: 9, title: 'der Titan', label: '땅울림', experience: 'rumbling' },
] as const

export function mountProjectLinks(stage: HTMLElement, projection: string, currentPage: () => number | null) {
  const matrix = new DOMMatrix(projection)
  const context = document.createElement('canvas').getContext('2d')!
  context.font = TEXT_PAGE_FONT
  const entries = BOOK_PROJECTS.map(project => {
    const metrics = context.measureText(project.title)
    const width = metrics.width + 24
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 24
    const link = document.createElement('a')
    const url = new URL(window.location.href)
    url.searchParams.delete('page')
    url.searchParams.set('experience', project.experience)
    url.hash = ''
    link.href = url.href
    link.className = 'project-page-link'
    link.dataset.page = String(project.page)
    link.setAttribute('aria-label', `${project.title} — ${project.label} 예제 열기`)
    link.title = `${project.label} 예제 열기`
    link.style.width = `${width}px`
    link.style.height = `${height}px`
    link.hidden = true
    link.addEventListener('click', event => {
      if (currentPage() !== project.page) { event.preventDefault(); return }
      trackEvent('photobook_project_open', { project: project.experience })
      // Back returns to the word that was selected, without changing the URL.
      history.replaceState({ ...history.state, photobookSpread: project.page }, '')
    })
    stage.append(link)
    return { project, link, width, height }
  })
  const resize = () => {
    const ratio = stage.getBoundingClientRect().width / 1536
    entries.forEach(({ link, width, height }) => {
      const x = (700 - width) / 2
      const y = (600 - height) / 2
      const source: Quad = [[0, 0], [width, 0], [width, height], [0, height]]
      const target = source.map(([u, v]) => {
        const px = x + u
        const point = matrix.transformPoint(new DOMPoint(px, y + v, 14 * Math.sin(Math.PI * px / 700)))
        return [point.x / point.w * ratio, point.y / point.w * ratio]
      }) as Quad
      link.style.transform = mapQuad(source, target)
    })
  }
  new ResizeObserver(resize).observe(stage)
  resize()
  return {
    update() {
      const page = currentPage()
      entries.forEach(({ project, link }) => { link.hidden = page !== project.page })
    },
  }
}
