import fs from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'

const code = ts.transpileModule(fs.readFileSync(new URL('../src/minecraft-selection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { hotbarKey, selectionOffset, hotbarSelectionMarkup, mountHotbarSelection } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
class ElementMock {
  attrs = new Map()
  dataset = {}
  setAttribute(key, value) { this.attrs.set(key, value) }
  removeAttribute(key) { this.attrs.delete(key) }
  closest() { return null }
}
globalThis.Element = ElementMock
globalThis.window = new EventTarget()
const hotbar = new ElementMock(), artwork = new ElementMock(), inactive = new ElementMock(), selected = new ElementMock()
hotbar.querySelector = selector => selector === '[data-hotbar-art]' ? artwork : selector === '[data-inactive-first-frame]' ? inactive : selected
const dispose = mountHotbarSelection(hotbar)
assert.equal(hotbar.dataset.selectedSlot, '1')
assert.equal(artwork.attrs.has('mask'), false)
assert.equal(selected.attrs.get('visibility'), 'hidden')
const press = (key, extra = {}) => {
  const event = new Event('keydown', { cancelable: true })
  Object.assign(event, { key, code: `Digit${key}`, ...extra })
  window.dispatchEvent(event)
  return event
}
for (let slot = 2; slot <= 9; slot++) {
  assert.equal(hotbarKey({ key: String(slot), code: `Numpad${slot}` }), slot)
  assert.equal(press(String(slot)).defaultPrevented, true)
  assert.equal(hotbar.dataset.selectedSlot, String(slot))
  assert.equal(artwork.attrs.get('mask'), 'url(#minecraft-first-frame-mask)')
  assert.equal(inactive.attrs.get('visibility'), 'visible')
  assert.equal(selected.attrs.get('visibility'), 'visible')
  assert.equal(selected.attrs.get('transform'), `translate(${selectionOffset(slot)} 0)`)
  assert.ok(354 + selectionOffset(slot) >= 354)
  assert.ok(475 + selectionOffset(slot) <= 1318, 'Last selection stays inside the unchanged HUD bounds')
}
assert.equal(selectionOffset(9), 843)
press('2', { ctrlKey: true }); assert.equal(hotbar.dataset.selectedSlot, '9')
press('3', { isComposing: true }); assert.equal(hotbar.dataset.selectedSlot, '9')
press('4', { repeat: true }); assert.equal(hotbar.dataset.selectedSlot, '9')
assert.equal(hotbarKey({ code: 'Digit0', key: '0' }), null)
press('1')
assert.equal(artwork.attrs.has('mask'), false)
assert.equal(inactive.attrs.get('visibility'), 'hidden')
assert.equal(selected.attrs.get('visibility'), 'hidden')
dispose(); press('7'); assert.equal(hotbar.dataset.selectedSlot, '1')
const markup = hotbarSelectionMarkup('/hotbar2.png')
assert.equal((markup.match(/data-selected-frame/g) || []).length, 1)
assert.equal((markup.match(/<image href="\/hotbar2.png"/g) || []).length, 2)
assert.ok(markup.includes('clip-rule="evenodd"'), 'Frame center is hollow; item pixels remain visible')
console.log('PASS: initial slot 1, keys/numpad 1–9, single hollow selection overlay, no duplicate first highlight, fixed viewBox bounds, restore and listener cleanup.')
