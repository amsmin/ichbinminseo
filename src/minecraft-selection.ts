export type HotbarSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

// Measurements in hotbar2.png source coordinates. Keeping the selection in
// the existing SVG viewBox makes it share exactly the same responsive scale.
const FRAME_RING = 'M354 746H475V864H354Z M378 769H456V845H378Z'
const ERASE_RING = 'M354 745H475V865H354Z M378 769H456V845H378Z'
const INACTIVE_RING = 'M361 749H469V861H361Z M378 769H456V845H378Z'
export const selectionOffset = (slot: HotbarSlot) => (slot - 1) * (843 / 8)

export function hotbarKey(event: Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>): HotbarSlot | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : '')
  return digit ? Number(digit) as HotbarSlot : null
}

export function hotbarSelectionMarkup(source: string) {
  // All visible artwork still comes from the unchanged PNG, including the
  // highlighted frame. There are no CSS-drawn slots, icons, or numbers.
  return `<defs>
    <clipPath id="minecraft-selected-frame-clip" clipPathUnits="userSpaceOnUse">
      <path d="${FRAME_RING}" clip-rule="evenodd" />
    </clipPath>
    <mask id="minecraft-first-frame-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="354" y="745" width="964" height="151" style="mask-type:luminance">
      <rect x="354" y="745" width="964" height="151" fill="white" />
      <path d="${ERASE_RING}" fill="black" fill-rule="evenodd" />
    </mask>
    <clipPath id="minecraft-inactive-frame-clip" clipPathUnits="userSpaceOnUse">
      <path d="${INACTIVE_RING}" clip-rule="evenodd" />
    </clipPath>
  </defs>
  <g data-inactive-first-frame visibility="hidden" aria-hidden="true" clip-path="url(#minecraft-inactive-frame-clip)">
    <!-- Reuse only the original empty-slot rim to uncover slot 1's neutral
         border. Its interior and the number below it remain untouched. -->
    <image href="${source}" x="-633" y="0" width="1672" height="941" />
  </g>
  <g data-selected-frame visibility="hidden" aria-hidden="true" pointer-events="none">
    <image href="${source}" width="1672" height="941" clip-path="url(#minecraft-selected-frame-clip)" />
  </g>`
}

export function mountHotbarSelection(hotbar: SVGSVGElement) {
  const artwork = hotbar.querySelector<SVGImageElement>('[data-hotbar-art]')!
  const inactive = hotbar.querySelector<SVGGElement>('[data-inactive-first-frame]')!
  const selected = hotbar.querySelector<SVGGElement>('[data-selected-frame]')!

  function select(slot: HotbarSlot) {
    hotbar.dataset.selectedSlot = String(slot)
    hotbar.setAttribute('aria-label', `마인크래프트 핫바, ${slot}번 슬롯 선택`)
    if (slot === 1) {
      // Initial state is pixel-identical to the original HUD.
      artwork.removeAttribute('mask')
      inactive.setAttribute('visibility', 'hidden')
      selected.setAttribute('visibility', 'hidden')
    } else {
      artwork.setAttribute('mask', 'url(#minecraft-first-frame-mask)')
      inactive.setAttribute('visibility', 'visible')
      selected.setAttribute('transform', `translate(${selectionOffset(slot)} 0)`)
      selected.setAttribute('visibility', 'visible')
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.repeat || event.isComposing || event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    const slot = hotbarKey(event)
    if (slot === null) return
    event.preventDefault()
    select(slot)
  }

  select(1)
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
