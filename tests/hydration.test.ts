import test from 'node:test'
import assert from 'node:assert/strict'
import { capturePage } from '../src/pages.ts'
import { hydrateCanvas, readLayer } from '../src/exporter.ts'
import { generateBundle } from '../src/generator.ts'

// Mimics Framer: layers on an unopened page report null text/rect until navigateTo.
function lazyPage() {
  const canvas = {open:false}
  const text = {id:'t', type:'TextNode', name:'Title', position:'relative',
    async getText() { return canvas.open ? 'Pricing' : null },
    async getHTML() { if (!canvas.open) throw new Error('not loaded'); return '<h1>Pricing</h1>' },
    async getRect() { return canvas.open ? {x:0, y:0, width:120, height:40} : null },
    async getChildren() { return [] }}
  const root = {id:'p', type:'WebPageNode', name:'Page', path:'/pricing',
    async navigateTo(opts:unknown) { assert.deepEqual(opts, {select:false, zoomIntoView:false}); setTimeout(() => { canvas.open = true }, 5) },
    async getRect() { return canvas.open ? {x:0, y:0, width:1200, height:800} : null }, async getChildren() { return [text] }}
  return {id:'p', path:'/pricing', type:'web', node:root}
}

test('capturePage opens the page canvas before reading text, HTML and rects', async () => {
  const snapshot = await capturePage(lazyPage(), 100, {pollMs:1})
  const t = snapshot.roots[0].children![0]
  assert.equal(t.text, 'Pricing')
  assert.equal(t.richTextHTML, '<h1>Pricing</h1>')
  assert.deepEqual(t.rect, {x:0, y:0, width:120, height:40})
  assert.deepEqual(snapshot.warnings!.filter(w => /hydrat|unavailable/.test(w)), [])
})

test('unhydrated layers are reported instead of silently dropped', async () => {
  const page = lazyPage()
  const state = {count:0, maxNodes:100, warnings:new Set<string>()}
  const root = await readLayer(page.node, state)
  assert.equal(root!.children![0].text, undefined)
  const w = [...state.warnings].join('\n')
  assert.match(w, /getText returned null/)
  assert.match(w, /getHTML is @alpha\): not loaded/)
  assert.match(w, /getRect returned null/)
})

test('hydrateCanvas gives up with a warning when the canvas never loads', async () => {
  const warnings = new Set<string>()
  const node = {async navigateTo() {}, async getRect() { return null }, async getChildren() { return [] }}
  assert.equal(await hydrateCanvas(node, warnings, {timeoutMs:5, pollMs:1}), false)
  assert.match([...warnings][0], /did not report layer rects/)
})

test('text style alignment, transform and ColorStyle color reach CSS', () => {
  const ts = {id:'s', fontSize:'62px', lineHeight:'1.09em', letterSpacing:'-2.7px', alignment:'center', transform:'uppercase',
    color:{light:'#F0F6FC', dark:'#F0F6FC'}, font:{family:'Geist', weight:600}}
  const css = generateBundle({roots:[{id:'h', kind:'TextNode', text:'Hi', attributes:{inlineTextStyle:ts}, children:[]}]}).css
  for (const re of [/font-size: 62px/, /line-height: 1.09em/, /letter-spacing: -2.7px/, /text-align: center/, /text-transform: uppercase/, /font-family: "Geist"/, /font-weight: 600/, /#F0F6FC/i])
    assert.match(css, re)
})
