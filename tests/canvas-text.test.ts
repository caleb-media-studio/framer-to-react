import type {DesignNode,Attributes,Snapshot} from '../src/types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle, textWithLayerBreaks, expandCanvasInstance, expandCanvasTree} from '../src/generator.ts'
import {collectCanvasComponents} from '../src/preview.ts'

const text = (name:string, value:string):DesignNode => ({id: 't', kind: 'TextNode', attributes: {name}, text: value, children: []})
const lockup:DesignNode & {children:DesignNode[]} = {id: 'C', kind: 'ComponentNode', attributes: {name: 'Lockup'}, children: [
  {id: 'vA', kind: 'FrameNode', attributes: {name: 'Full', position: 'absolute', top: '0px', left: '0px', width: 'fit-content', height: '45px', layout: 'stack', gap: '11px'}, children: [
    {id: 'vAm', kind: 'SVGNode', attributes: {name: 'Mark', svg: '<svg viewBox="0 0 2 2"><rect width="2" height="2" fill="#f00"/></svg>'}, children: []}]},
  {id: 'vB', kind: 'FrameNode', attributes: {name: 'Cloud', position: 'absolute', top: '0px', left: '0px', width: 'fit-content', height: '45px', layout: 'stack', gap: '7px'}, children: [
    {id: 'vBt', kind: 'TextNode', attributes: {name: 'Label'}, text: 'Cloud', children: []}]}]}
const instance = (controls:Attributes):DesignNode => ({id: 'I', kind: 'ComponentInstanceNode', attributes: {name: 'Brand', position: 'relative', width: 'fit-content', height: '25px', componentIdentifier: 'local-module:canvasComponent/C:default', controls}, children: []})
const page = (node:DesignNode):Snapshot => ({roots: [{id: 'R', kind: 'FrameNode', attributes: {name: 'Page'}, children: [node]}]})

test('restores line breaks the layer name records when it matches the text', () => {
  assert.equal(textWithLayerBreaks(text('Text · Your team’s context.\nEvery age', 'Your team’s context.Every agent’s foundation.')), 'Your team’s context.\nEvery agent’s foundation.')
})
test('ignores a stale layer name that does not match the text', () => {
  assert.equal(textWithLayerBreaks(text('Text · From your team’s knowledge\nto ', 'Stop rebuilding contextfor every agent.')), 'Stop rebuilding contextfor every agent.')
  assert.equal(textWithLayerBreaks(text('Plain', 'Plain')), 'Plain')
})
test('emits the restored break into the generated JSX', () => {
  const {tsx} = generateBundle(page(text('Text · A.\nB', 'A.B c')))
  assert.ok(tsx.includes('{"A.\\nB c"}'), tsx)
})
test('expands an empty canvas instance into the variant its controls select', () => {
  const out = expandCanvasInstance(instance({variant: 'vB'}), lockup)
  assert.ok(out)
  assert.equal(out.id, 'I'); assert.equal(out.attributes.gap, '7px'); assert.equal(out.attributes.height, '25px')
  assert.equal(out.attributes.position, 'relative'); assert.equal(out.attributes.top, undefined)
  assert.equal(expandCanvasInstance(instance({}), lockup)!.attributes.gap, '11px')
  assert.equal(expandCanvasInstance(instance({}), null), null)
})
test('renders the resolved variant layers instead of an empty div', () => {
  const resolve = (id:unknown) => id === 'local-module:canvasComponent/C:default' ? lockup : null
  assert.ok(generateBundle(page(instance({variant: 'vB'})), {resolveCanvasComponent: resolve}).tsx.includes('{"Cloud"}'))
  assert.ok(!generateBundle(page(instance({variant: 'vB'}))).tsx.includes('Cloud'))
})
test('stops expanding a component that contains itself', () => {
  const self = {...lockup, children: [{...lockup.children[0], children: [instance({})]}]}
  assert.doesNotThrow(() => generateBundle(page(instance({})), {resolveCanvasComponent: () => self}))
})
test('collects saved canvas components keyed by identifier', () => {
  const files = {'library/components.json': JSON.stringify([{id: 'x', folder: 'library/components/x'}, {id: 'bad'}]), 'library/components/x/design.json': JSON.stringify({roots: [lockup]})}
  const map = collectCanvasComponents(files)
  assert.equal(map.size, 1); assert.equal(map.get('x')!.id, 'C')
})
test('keeps an absolutely placed breakpoint root in document flow', async () => {
  const {inFlowRoot} = await import('../src/generator.ts')
  const root = {id: 'B', kind: 'FrameNode', attributes: {name: 'Desktop', position: 'absolute', top: '0px', left: '0px', width: '1200px', isBreakpoint: true}, children: []}
  const {css, tsx} = generateBundle({roots: [root]})
  assert.ok(!/position:\s*absolute|top: 0px/.test(css), css)
  assert.ok(!/className="absolute/.test(tsx), tsx)
  assert.equal(inFlowRoot(root).attributes!.width, '1200px')
  assert.equal(root.attributes.position, 'absolute')
})
test('keeps an absolute layer with no offsets in flow, and leaves placed absolutes alone', () => {
  const child = (extra:Attributes):DesignNode => ({id: 'c', kind: 'FrameNode', attributes: {name: 'Nav', position: 'absolute', width: '100%', height: '76px', ...extra}, children: []})
  const wrap = (c:DesignNode) => generateBundle({roots: [{id: 'R', kind: 'FrameNode', attributes: {name: 'P', position: 'relative', layout: 'stack'}, children: [c, {id: 'f', kind: 'FrameNode', attributes: {name: 'Flow', position: 'relative'}, children: []}]}]}).tsx
  assert.ok(/<div className="relative[^"]*"[^>]*\/>/.test(wrap(child({top: null, left: null}))), wrap(child({})))
  assert.ok(/<div className="absolute[^"]*"[^>]*\/>/.test(wrap(child({top: '0px', left: '0px'}))))
  assert.ok(/<div className="absolute[^"]*"[^>]*\/>/.test(wrap(child({centerX: '0%', centerY: '0%'}))))
})
test('keeps every layer in flow when the export never hydrated positions, but not real centered overlays', () => {
  const layer = (name:string, kids:DesignNode[] = []):DesignNode => ({id: name, kind: 'FrameNode', attributes: {name, position: 'absolute', centerX: '0%', centerY: '0%', width: '100%'}, children: kids})
  const root = (kids:DesignNode[]):DesignNode => ({id: 'R', kind: 'FrameNode', attributes: {name: 'Desktop', position: 'relative', layout: 'stack'}, children: kids})
  const unhydrated = generateBundle({roots: [root([layer('Nav', [layer('Logo')]), layer('Footer')])]})
  assert.ok(!/className="absolute/.test(unhydrated.tsx), unhydrated.tsx)
  assert.ok(unhydrated.warnings.some(w => /not hydrated/.test(w)))
  const inFlow = {id: 'S', kind: 'FrameNode', attributes: {name: 'Section', position: 'relative'}, children: [layer('Menu overlay')]}
  const real = generateBundle({roots: [root([inFlow])]})
  assert.ok(/className="absolute[^"]*"/.test(real.tsx), real.tsx)
  assert.ok(!real.warnings.some(w => /not hydrated/.test(w)))
})

test('restores a hard break in slash-prefixed autogenerated text names without changing custom names', () => {
  assert.equal(textWithLayerBreaks(text('Text / First sentence.\nSecond sent', 'First sentence.Second sentence.')), 'First sentence.\nSecond sentence.')
  assert.equal(textWithLayerBreaks(text('Text / Wrong prefix\nSecond', 'First sentence.Second sentence.')), 'First sentence.Second sentence.')
})
test('short solid-background page stacks cover the viewport without modifying selected content', async () => {
  const {inFlowRoot} = await import('../src/generator.ts')
  const pageRoot:DesignNode & {attributes:Attributes} = {id:'r',kind:'FrameNode',attributes:{position:'absolute',isBreakpoint:true,height:'fit-content',layout:'stack',stackDirection:'vertical',stackDistribution:'start',backgroundColor:'#141414'},children:[]}
  assert.equal(inFlowRoot(pageRoot).attributes!.minHeight,'100vh')
  assert.equal(pageRoot.attributes.minHeight,undefined)
  const b = generateBundle({roots:[pageRoot]})
  assert.match(b.css,/min-height: 100vh/)
  assert.equal(inFlowRoot({...pageRoot,attributes:{...pageRoot.attributes,isBreakpoint:false}}).attributes!.minHeight,undefined)
  assert.equal(inFlowRoot({...pageRoot,attributes:{...pageRoot.attributes,minHeight:'200px'}}).attributes!.minHeight,'200px')
  assert.equal(inFlowRoot({...pageRoot,attributes:{...pageRoot.attributes,stackDistribution:'center'}}).attributes!.minHeight,undefined)
})

test('frame borders are painted over the box without consuming stack padding', () => {
  const node = {id:'panel',kind:'FrameNode',attributes:{width:'200px',height:'100px',layout:'stack',padding:'16px',borderRadius:'8px',border:{width:'2px',style:'solid',color:'#333333'}},children:[]}
  const b = generateBundle({roots:[node]})
  assert.match(b.css,/::after\s*\{[^}]*border: 2px solid #333333/)
  assert.match(b.css,/::after\s*\{[^}]*pointer-events: none/)
  const base = b.css.split('}').find(x => x.includes('padding: 16px'))
  assert.ok(base)
  assert.doesNotMatch(base, /\bborder:/)
  assert.match(b.tsx,/className="[^"]*relative/)
})

test('scopes expanded source text identities and independently applies reference evidence',()=>{
 const one=instance({variant:'vB'}),two={...one,id:'I2'}
 const root:DesignNode={id:'root',kind:'FrameNode',children:[one,two]}
 const resolve=()=>lockup
 const expanded=expandCanvasTree(root,resolve)
 assert.equal(expanded.children![0].children![0].id,'I::vBt')
 assert.equal(expanded.children![1].children![0].id,'I2::vBt')
 assert.equal(lockup.children[1].children![0].id,'vBt')
 const overlay={format:'test',nodes:{'I::vBt':{textStyle:{fontSize:'12px',lineHeight:'14.4px',color:'rgb(145, 152, 161)'}},'I2::vBt':{textStyle:{fontSize:'18px'}}},conflicts:[],coverage:[]}
 const {tsx,css}=generateBundle({roots:[root]},{resolveCanvasComponent:resolve,referenceOverlay:overlay})
 assert.ok(tsx.includes('data-f2a-node="I::vBt"')&&tsx.includes('data-f2a-node="I2::vBt"'))
 assert.match(css,/font-size: 12px/);assert.match(css,/font-size: 18px/)
 assert.match(css,/color: rgb\(145, 152, 161\)/)
})
