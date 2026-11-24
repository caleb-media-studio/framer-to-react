import test from 'node:test'
import assert from 'node:assert/strict'
import {buildOverlay} from '../src/enrichment.mjs'

const prov = {url: 'https://example.test/', viewport: {width: 390, height: 900}, capturedAt: 't', responseSha256: 'h'}
const style = {fontSize: '10px', lineHeight: '12px', letterSpacing: 'normal', textAlign: 'start', textTransform: 'none', color: 'rgb(1, 2, 3)'}
const cell = id => [id, {id, kind: 'TextNode', text: 'Status', attributes: {name: 'Cell label'}}]
const nodes = new Map([cell('a'), cell('b'), cell('c')])
const entry = (nodeId, s = style, confidence = 'low') => ({nodeId, confidence, method: 'name+text+order', framerName: 'Cell label', style: s, domPath: 'p'})
const run = (evidence, extra = {}) => buildOverlay([{route: '/t', doc: {provenance: prov, breakpointId: 'bp', evidence, unmatchedArchive: [], unmatchedLive: [], ...extra}}], nodes)

test('applies a repeated text style when every candidate computed the same style', () => {
  const o = run([entry('a'), entry('b'), entry('c')])
  assert.deepEqual(Object.keys(o.nodes).sort(), ['a', 'b', 'c'])
  assert.equal(o.nodes.a.textStyle.fontSize, '10px')
  assert.equal(o.nodes.a.provenance.confidence, 'low')
  assert.match(o.nodes.a.provenance.method, /style-consensus$/)
  assert.equal(o.coverage[0].consensus, 3)
})

test('does not apply when any candidate style differs', () => {
  assert.deepEqual(Object.keys(run([entry('a'), entry('b', {...style, fontSize: '12px'}), entry('c')]).nodes), [])
})

test('does not apply when a same-text live or archive element is unmatched', () => {
  assert.deepEqual(Object.keys(run([entry('a'), entry('b')], {unmatchedLive: [{name: 'Cell label', text: 'Status'}]}).nodes), [])
  assert.deepEqual(Object.keys(run([entry('a'), entry('b')], {unmatchedArchive: ['c']}).nodes), [])
})

test('needs at least two candidates and editor nodes to prove consensus', () => {
  assert.deepEqual(Object.keys(run([entry('a')]).nodes), [])
  const o = buildOverlay([{route: '/t', doc: {provenance: prov, breakpointId: 'bp', evidence: [entry('a'), entry('b')]}}])
  assert.deepEqual(Object.keys(o.nodes), [])
})

test('a same-name live element matched to a node outside the group blocks consensus', () => {
  const ns = new Map([cell('a'), cell('b'), ['c', {id: 'c', kind: 'TextNode', text: 'Status', attributes: {name: 'Renamed'}}]])
  const doc = {provenance: prov, breakpointId: 'bp', unmatchedArchive: [], unmatchedLive: [],
    evidence: [entry('a'), entry('b'), {...entry('c', {...style, fontSize: '20px'}), method: 'text-only'}]}
  assert.deepEqual(Object.keys(buildOverlay([{route: '/t', doc}], ns).nodes), [])
})

test('a truncated unmatched live text still blocks a longer repeated text', () => {
  const long = 'x'.repeat(100)
  const ns = new Map(['a', 'b'].map(id => [id, {id, kind: 'TextNode', text: long, attributes: {name: 'Cell label'}}]))
  const doc = {provenance: prov, breakpointId: 'bp', unmatchedArchive: [], unmatchedLive: [{name: 'Cell label', text: long.slice(0, 80)}], evidence: [entry('a'), entry('b')]}
  assert.deepEqual(Object.keys(buildOverlay([{route: '/t', doc}], ns).nodes), [])
})

test('different tags are not a shared style', () => {
  assert.deepEqual(Object.keys(run([entry('a', {...style, tag: 'p'}), entry('b', {...style, tag: 'h3'})]).nodes), [])
})

test('foreign-breakpoint entries do not count toward the quorum', () => {
  const bp = new Map([['a', 'bp'], ['b', 'other']])
  const o = buildOverlay([{route: '/t', doc: {provenance: prov, breakpointId: 'bp', evidence: [entry('a'), entry('b')], unmatchedArchive: [], unmatchedLive: []}}], nodes, bp)
  assert.deepEqual(Object.keys(o.nodes), [])
})

test('duplicate rejection also removes the node from the consensus count', () => {
  const d = {provenance: prov, breakpointId: 'bp', unmatchedArchive: [], unmatchedLive: [], evidence: [entry('a'), entry('b')]}
  const o = buildOverlay([{route: '/t', doc: d}, {route: '/u', doc: d}], nodes)
  assert.equal(o.coverage[0].consensus, 0)
})

test('an unmatched element with different short text does not block', () => {
  assert.equal(Object.keys(run([entry('a'), entry('b')], {unmatchedLive: [{name: 'Cell label', text: ''}, {name: 'Cell label', text: 'Stat'}]}).nodes).length, 2)
})
