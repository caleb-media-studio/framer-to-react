import test from 'node:test'
import assert from 'node:assert/strict'
import { generateBundle } from '../src/generator.ts'
import { readLayer, jsonSafe } from '../src/exporter.ts'

const demo = {
  format: 'framer-to-agent/canvas-snapshot-v1',
  roots: [{
    id: 'frame-1', kind: 'FrameNode', attributes: {
      name: 'Hero Section', layout: 'stack', stackDirection: 'vertical', gap: '16px',
      padding: '24px', backgroundColor: '#112233', width: '100%',
    }, children: [
      { id: 'headline', kind: 'TextNode', text: 'Hello <World> & Friends', attributes: {name: 'Title', font: {family: 'Inter'}, inlineTextStyle: {fontSize: '32px', color: '#ffffff'}}, children: [] },
      { id: 'button', kind: 'FrameNode', attributes: {name: 'CTA', link: 'https://example.com', linkOpenInNewTab: true, borderRadius: '12px'}, children: [
        {id: 'button-text', kind: 'TextNode', text: 'Get started', attributes: {name: 'Button text'}, children: []},
      ]},
    ],
  }], selectedCount: 1, nodeCount: 4, warnings: [],
}

test('outputs TSX, CSS, original JSON and agent instructions', () => {
  const b = generateBundle(demo)
  assert.match(b.tsx, /export default function HeroSection/)
  assert.match(b.tsx, /flex flex-col/)
  assert.match(b.tsx, /\{"Hello <World> & Friends"\}/)
  assert.match(b.tsx, /href="https:\/\/example.com"/)
  assert.match(b.css, /background-color: #112233/)
  assert.equal(JSON.parse(b.json).roots[0].children.length, 2)
  assert.match(b.agent, /Implement this Framer design/)
})

test('rejects unsafe javascript URLs in generated TSX', () => {
  const input:import('../src/types.ts').Snapshot = structuredClone(demo)
  input.roots[0].attributes!.link = 'javascript:alert(1)'
  const b = generateBundle(input)
  assert.doesNotMatch(b.tsx, /href="javascript:/)
})

test('safely serializes circular SDK values', () => {
  const obj:{name:string;self?:unknown} = {name: 'shape'}
  obj.self = obj
  assert.equal(jsonSafe(obj).self, '[Circular reference]')
})

test('recursively exports descendants and text', async () => {
  const textNode = {id:'txt', name:'Hello', type:'TextNode', async getText(){return 'Test text'}, async getChildren(){return []}}
  const frameNode = {id:'frame', name:'Box', layout:'stack', async getChildren(){return [textNode]}}
  const state = {count:0, maxNodes:10, warnings: new Set<string>()}
  const result = await readLayer(frameNode, state)
  assert.equal(result!.children![0].text, 'Test text')
  assert.equal(state.count, 2)
})

test('intrinsic fit text does not clamp to a narrow parent; explicit constraints and frame sizing remain',()=>{
 const b=generateBundle({roots:[{id:'frame',kind:'FrameNode',attributes:{width:'fit-content',layout:'stack'},children:[
  {id:'fit',kind:'TextNode',text:'An intrinsic label',attributes:{width:'fit-content',height:'fit-content'}},
  {id:'bounded',kind:'TextNode',text:'A constrained label',attributes:{width:'fit-content',maxWidth:'100px'}},
  {id:'fluid',kind:'TextNode',text:'A fluid paragraph',attributes:{width:'100%'}}
 ]}]})
 assert.equal((b.css.match(/width: max-content;/g)||[]).length,2)
 assert.match(b.css,/width: fit-content;/)
 assert.match(b.css,/max-width: 100px;/)
 assert.match(b.css,/width: 100%;/)
})
