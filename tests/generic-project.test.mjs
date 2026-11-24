// Generalisation check: an unrelated synthetic project (different fonts, breakpoints, nesting, components, routes) must
// produce output derived only from its own data, with none of the regression fixture's constants.
import assert from 'node:assert/strict'
import test from 'node:test'
import {generateBundle} from '../src/generator.mjs'
import {generatePreviewFiles} from '../src/preview.mjs'

const constants = ['Unrelated project sentinel','unrelated.example.test','unrelated-component-id','Unrelated Font']

const heading = (id, size, spacing, align) => ({id, kind: 'TextNode', text: 'Seasonal menu', attributes: {name: 'Menu heading', font: {family: 'Fraunces', weight: 300}, inlineTextStyle: {fontSize: size, lineHeight: '1.3em', letterSpacing: spacing, alignment: align, color: 'rgb(120, 30, 40)'}}})
const stack = (id, children) => ({id, kind: 'FrameNode', attributes: {name: 'Column', layout: 'stack', stackDirection: 'vertical', gap: '12px', width: '1fr'}, children})
const card = {id: 'inst00001', kind: 'ComponentInstanceNode', attributes: {name: 'Dish card', componentIdentifier: 'local-module:dish-card', position: 'relative', width: '280px', height: '120px'}, children: []}
const breakpoint = (id, name, width, size, spacing, align) => ({roots: [{id, kind: 'FrameNode', attributes: {name, width: `${width}px`, position: 'absolute', top: '0px', left: '0px'},
  children: [stack(`${id}-s1`, [stack(`${id}-s2`, [heading(`${id}-h`, size, spacing, align), card])])]}]})
const component = {roots: [{id: 'comp00001', kind: 'ComponentNode', attributes: {name: 'Dish card'}, children: [
  {id: 'var000001', kind: 'FrameNode', attributes: {name: 'Default', backgroundColor: 'rgb(250, 240, 220)'}, children: [{id: 'txt000001', kind: 'TextNode', text: 'Soup of the day', attributes: {name: 'Dish', font: {family: 'Work Sans', weight: 500}, inlineTextStyle: {fontSize: '15px'}}}]}]}]}

const bps = [['wide1', 'Laptop', 1440, '44px', '0.5px', 'right'], ['tab01', 'Tablet', 768, '32px', '0.25px', 'center'], ['phn01', 'Phone', 360, '26px', '0px', 'left']]
const dir = 'pages/menu/specials'
const source = {
  'library/components.json': JSON.stringify([{id: 'local-module:dish-card', folder: 'library/components/dish-card'}]),
  'library/components/dish-card/design.json': JSON.stringify(component),
}
// As the exporter does: each breakpoint folder holds design.json plus the capture-time generated draft.
bps.forEach(([id, name, width, size, spacing, align], i) => {
  const d = breakpoint(id, name, width, size, spacing, align), f = `${dir}/breakpoints/${i + 1}-${name}`, g = generateBundle(d)
  Object.assign(source, {[`${f}/design.json`]: JSON.stringify(d), [`${f}/Component.tsx`]: g.tsx, [`${f}/component.css`]: g.css})
})
source[`${dir}/design.json`] = source[`${dir}/breakpoints/1-Laptop/design.json`]
const page = {path: '/menu/specials', directory: dir, breakpoints: bps.map(([id, name, width], i) => ({id, name, width: `${width}px`, primary: i === 0, directory: `${dir}/breakpoints/${i + 1}-${name}`}))}
const out = generatePreviewFiles([page], source)
const css = Object.entries(out).filter(([k]) => k.endsWith('.css')).map(([, v]) => v).join('\n')
const all = Object.values(out).join('\n')

test('typography comes from each breakpoint of the selected project', () => {
  for (const [, , , size, spacing, align] of bps) {
    assert.match(css, new RegExp(`font-size: ${size};[^}]*letter-spacing: ${spacing.replace('.', '\\.')};[^}]*text-align: ${align}`, 's'))
  }
  assert.match(css, /font-family: "Fraunces"/)
  assert.match(css, /font-weight: 300/)
  assert.match(css, /color: rgb\(120, 30, 40\)/)
})

test('canvas component instances expand from the project library', () => {
  assert.match(all, /Soup of the day/)
  assert.match(css, /font-family: "Work Sans"/)
})

test('every breakpoint becomes a preview variant keyed by its own width', () => {
  for (const [, , width] of bps) assert.match(all, new RegExp(`\\b${width}\\b`))
  assert.match(all, /\/menu\/specials/)
})

test('output carries none of the regression fixture constants', () => {
  const hits = constants.filter(s => all.toLowerCase().includes(s.toLowerCase()))
  assert.deepEqual(hits, [])
})
