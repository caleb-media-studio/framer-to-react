import type {DesignNode,Attributes} from '../src/types.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import {generateBundle} from '../src/generator.ts'

const pane = (id:string, width?:string|number) => ({id, kind: 'FrameNode', attributes: {name: id, position: 'relative', width, height: '1fr'}, children: []})
const row = (children:DesignNode[], extra:Attributes = {}) => ({roots: [{id: 'root', kind: 'FrameNode', attributes: {name: 'Row', layout: 'stack', stackDirection: 'horizontal', stackAlignment: 'start', ...extra}, children}]})
const rule = (css:string, n:number) => css.match(new RegExp(`\\.f2a-[a-z0-9]+-${n} \\{[^}]*\\}`))?.[0] || ''

test('fill height in a horizontal stack stretches on the cross axis and keeps its percentage width', () => {
  const {css} = generateBundle(row([pane('a', '52%'), pane('b', '48%')]))
  for (const [n, w] of [[2, '52%'], [3, '48%']] as const) {
    const r = rule(css, n)
    assert.match(r, /align-self: stretch/)
    assert.match(r, new RegExp(`width: ${w}`))
    assert.doesNotMatch(r, /flex-grow|flex-basis/)
  }
})

test('fill width in a horizontal stack shares free space by its fr weight', () => {
  const {css} = generateBundle(row([{...pane('a'), attributes: {name: 'a', width: '2fr', height: '40px'}}, {...pane('b'), attributes: {name: 'b', width: '1fr', height: '40px'}}]))
  assert.match(rule(css, 2), /flex-grow: 2;[^}]*flex-basis: 0px/s)
  assert.match(rule(css, 3), /flex-grow: 1;/)
})

test('fill height in a vertical stack grows on the main axis', () => {
  const {css} = generateBundle(row([pane('a', '100%')], {stackDirection: 'vertical'}))
  assert.match(rule(css, 2), /flex-grow: 1;/)
  assert.doesNotMatch(rule(css, 2), /align-self/)
})
