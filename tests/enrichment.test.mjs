import test from 'node:test'
import assert from 'node:assert/strict'
import {buildOverlay, applyOverlay, parseOverlay} from '../src/enrichment.mjs'
import {generateBundle} from '../src/generator.mjs'

const prov = {url: 'https://example.test/', viewport: {width: 1200, height: 900}, capturedAt: 't', responseSha256: 'h'}
const style = {fontFamily: 'Geist, sans-serif', fontSize: '62px', fontWeight: '600', lineHeight: '67.58px', letterSpacing: '-2.7px', textAlign: 'center', textTransform: 'none', color: 'rgb(255, 255, 255)'}
const text = (id, attrs = {}) => ({id, kind: 'TextNode', text: 'Hello', attributes: {name: 'Title', font: {family: 'Geist', weight: 600}, ...attrs}})
const design = n => ({roots: [{id: 'bp', kind: 'FrameNode', attributes: {name: 'Desktop', width: '1200px'}, children: [n]}]})
const doc = (confidence, s = style) => ({provenance: prov, breakpointId: 'bp', evidence: [{nodeId: 't1', confidence, method: 'name+text', framerName: 'Title', style: s, domPath: 'p'}]})

test('applies high-confidence reference fields the editor lacks, with provenance', () => {
  const o = buildOverlay([{route: '/', doc: doc('high')}], new Map([['t1', text('t1')]]))
  assert.deepEqual(o.nodes.t1.textStyle, {fontSize: '62px', lineHeight: '67.58px', letterSpacing: '-2.7px', textAlign: 'center', color: 'rgb(255, 255, 255)'})
  assert.equal(o.nodes.t1.provenance.source, 'published-site')
  assert.equal(o.nodes.t1.provenance.url, prov.url)
  const css = generateBundle(applyOverlay(design(text('t1')), o)).css
  for (const d of ['font-size: 62px', 'line-height: 67.58px', 'letter-spacing: -2.7px', 'text-align: center', 'color: rgb(255, 255, 255)']) assert.ok(css.includes(d), d)
})

test('never applies medium or low confidence matches', () => {
  for (const c of ['medium', 'low']) {
    const o = buildOverlay([{route: '/', doc: doc(c)}])
    assert.deepEqual(o.nodes, {})
    assert.equal(o.coverage[0][c], 1)
  }
})

test('keeps editor values and records a conflict when they disagree', () => {
  const o = buildOverlay([{route: '/', doc: doc('high')}], new Map([['t1', text('t1', {fontSize: 48, font: {family: 'Inter', weight: 400}})]]))
  assert.equal(o.nodes.t1.textStyle.fontSize, undefined)
  const fields = o.conflicts.map(c => c.field).sort()
  assert.deepEqual(fields, ['fontFamily', 'fontSize', 'fontWeight'])
  assert.ok(o.conflicts.every(c => c.kept === 'editor'))
})

test('drops initial/uninformative computed values', () => {
  const o = buildOverlay([{route: '/', doc: doc('high', {...style, letterSpacing: 'normal', textAlign: 'start', lineHeight: 'normal'})}])
  assert.deepEqual(Object.keys(o.nodes.t1.textStyle).sort(), ['color', 'fontSize'])
})

test('applyOverlay leaves the raw snapshot untouched and rejects foreign overlay files', () => {
  const raw = design(text('t1'))
  const before = JSON.stringify(raw)
  const out = applyOverlay(raw, buildOverlay([{route: '/', doc: doc('high')}]))
  assert.equal(JSON.stringify(raw), before)
  assert.ok(out.roots[0].children[0].reference)
  assert.equal(parseOverlay('{"format":"other"}'), null)
  assert.equal(parseOverlay('not json'), null)
})

test('marks a width without a matching breakpoint as unverified', () => {
  const o = buildOverlay([{route: '/', doc: {provenance: prov, breakpointId: null, evidence: []}}])
  assert.match(o.coverage[0].status, /^unverified/)
})

test('drops a node matched under two different widths instead of letting one overwrite the other', () => {
  const mobile = {...doc('high', {...style, fontSize: '38px'}), provenance: {...prov, viewport: {width: 390, height: 900}}}
  const o = buildOverlay([{route: '/', doc: doc('high')}, {route: '/', doc: mobile}])
  assert.equal(o.nodes.t1, undefined)
  assert.ok(o.conflicts.some(c => c.nodeId === 't1' && c.kept === 'none'))
})

test('enrich-export regenerates drafts from evidence but copies design.json byte-for-byte', async () => {
  const {mkdtempSync, mkdirSync, writeFileSync, readFileSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {execFileSync} = await import('node:child_process')
  const base = mkdtempSync(join(tmpdir(), 'f2a-enrich-'))
  const exp = join(base, 'export'), ev = join(base, 'evidence'), out = join(base, 'out')
  const dir = 'pages/index', bp = `${dir}/breakpoints/1-Desktop`
  mkdirSync(join(exp, bp), {recursive: true}); mkdirSync(ev)
  const raw = JSON.stringify(design(text('t1')), null, 2)
  writeFileSync(join(exp, dir, 'design.json'), raw); writeFileSync(join(exp, bp, 'design.json'), raw)
  writeFileSync(join(exp, 'manifest.json'), JSON.stringify({pages: [{path: '/', directory: dir, breakpoints: [{name: 'Desktop', id: 'bp', directory: bp, primary: true}]}]}))
  writeFileSync(join(ev, '_index.1200.json'), JSON.stringify(doc('high')))
  // foreign breakpoint (layer t1 belongs to 'bp'), mislabelled width, stale preview: none may reach the output
  writeFileSync(join(ev, '_index.810.json'), JSON.stringify({...doc('high', {...style, fontSize: '48px'}), breakpointId: 'other', provenance: {...prov, viewport: {width: 810, height: 900}}}))
  writeFileSync(join(ev, '_index.390.json'), JSON.stringify(doc('high', {...style, fontSize: '38px'})))
  mkdirSync(join(exp, 'preview')); writeFileSync(join(exp, 'preview/STALE.txt'), 'x')
  const script = new URL('../scripts/enrich-export.mjs', import.meta.url).pathname
  assert.throws(() => execFileSync('node', [script, exp, ev, exp], {stdio: 'pipe'}))
  execFileSync('node', [script, exp, ev, out], {stdio: 'pipe'})
  assert.equal(readFileSync(join(out, bp, 'design.json'), 'utf8'), raw)
  assert.match(readFileSync(join(out, bp, 'component.css'), 'utf8'), /font-size: 62px/)
  assert.match(readFileSync(join(out, dir, 'component.css'), 'utf8'), /font-size: 62px/)
  assert.match(readFileSync(join(out, 'reference/FIDELITY.md'), 'utf8'), /\| \/ \| 1200 \| measured \| 1 \|/)
  assert.ok(Object.keys(readFileSync(join(out, 'preview/src/App.tsx'), 'utf8')).length)
  const overlay = JSON.parse(readFileSync(join(out, 'reference/overlay.json'), 'utf8'))
  assert.equal(overlay.coverage.find(r => r.width === 810).foreignNode, 1)
  assert.deepEqual(overlay.skippedEvidence.map(x => x.file), ['_index.390.json'])
  const {existsSync} = await import('node:fs')
  assert.ok(!existsSync(join(out, 'preview/STALE.txt')))
  assert.ok(existsSync(join(out, 'reference/evidence/_index.1200.json')) && !existsSync(join(out, 'reference/evidence/_index.390.json')))
})

test('does not apply evidence from a width with no matching breakpoint', () => {
  const o = buildOverlay([{route: '/', doc: {...doc('high'), breakpointId: null}}])
  assert.deepEqual(o.nodes, {})
})

test('skips evidence naming a layer owned by another breakpoint', () => {
  const o = buildOverlay([{route: '/', doc: doc('high')}], new Map(), new Map([['t1', 'mobileBp']]))
  assert.deepEqual(o.nodes, {})
  assert.equal(o.coverage[0].foreignNode, 1)
})

test('keeps a rejected duplicate out even when a third width matches it, and corrects coverage', () => {
  const at = w => ({...doc('high'), provenance: {...prov, viewport: {width: w, height: 900}}})
  const o = buildOverlay([390, 810, 1200].map(w => ({route: '/', doc: at(w)})))
  assert.equal(o.nodes.t1, undefined)
  assert.deepEqual(o.coverage.map(r => r.applied), [0, 0, 0])
})

test('rejects zero letter spacing and malformed or injected colors', () => {
  const o = buildOverlay([{route: '/', doc: doc('high', {...style, letterSpacing: '0px', color: 'rgb(0,0,0);}body{display:none'})}])
  assert.equal(o.nodes.t1.textStyle.letterSpacing, undefined)
  assert.equal(o.nodes.t1.textStyle.color, undefined)
})

test('treats numeric editor values as px when comparing and reads inline textColor', () => {
  const o = buildOverlay([{route: '/', doc: doc('high')}], new Map([['t1', text('t1', {fontSize: 62, inlineTextStyle: {textColor: '#ff0000'}})]]))
  assert.ok(!o.conflicts.some(c => c.field === 'fontSize'))
  assert.ok(o.conflicts.some(c => c.field === 'color' && c.kept === 'editor'))
  assert.equal(o.nodes.t1.textStyle.color, undefined)
})

test('generator prefers editor typography over reference values', () => {
  const o = buildOverlay([{route: '/', doc: doc('high')}])
  const css = generateBundle(applyOverlay(design(text('t1', {fontSize: 48})), o)).css
  assert.ok(css.includes('font-size: 48px') && !css.includes('font-size: 62px'))
})

test('emits the layer id on rendered elements for fidelity lookups', () => {
  assert.match(generateBundle(design(text('t1'))).tsx, /data-f2a-node="t1"/)
})

test('generator drops injected CSS from a hand-edited overlay', () => {
  const forged = {format: 'framer-to-agent/reference-overlay-v1', nodes: {t1: {textStyle: {color: 'rgb(0,0,0);}body{display:none', fontSize: '1px;}x{y:z'}}}}
  const css = generateBundle(applyOverlay(design(text('t1')), forged)).css
  assert.ok(!/body|display:none|x\{/.test(css), css)
})
