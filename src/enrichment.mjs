import {serializeReferenceVector} from './reference-vector.mjs'
/**
 * Opt-in reference enrichment. Published-site computed styles (collected outside Framer, see scripts/enrich-export.mjs)
 * are matched to captured layers by route, breakpoint and layer id. Only `high` confidence matches are applied, only
 * for fields the editor capture lacks, and each applied field keeps its provenance. Raw design.json is never modified;
 * the overlay is attached as `node.reference` at generation time.
 */
export const OVERLAY_FORMAT = 'framer-to-agent/reference-overlay-v1'
const APPLY_CONFIDENCE = new Set(['high'])

// Computed values equal to the CSS initial value carry no information and are not applied. Color is inherited, so any
// fully-formed rgb()/rgba() is kept; validators are anchored both ends so evidence cannot smuggle CSS.
const FIELDS = {
  fontSize: v => /^\d+(\.\d+)?px$/.test(v) ? v : null,
  lineHeight: v => /^\d+(\.\d+)?px$/.test(v) ? v : null,
  letterSpacing: v => /^-?\d+(\.\d+)?px$/.test(v) && parseFloat(v) !== 0 ? v : null,
  textAlign: v => /^(left|right|center|justify|end)$/.test(v) ? v : null,
  textTransform: v => /^(uppercase|lowercase|capitalize)$/.test(v) ? v : null,
  whiteSpace: v => /^(pre|pre-wrap|pre-line|normal|nowrap|break-spaces)$/.test(v) ? v : null,
  color: v => /^rgba?\([\d.,\s%/]+\)$/.test(v) ? v : null,
}

function editorValue(node, field) {
  const a = node?.attributes || {}, ts = a.inlineTextStyle || {}
  switch (field) {
    case 'fontSize': return ts.fontSize ?? a.fontSize
    case 'lineHeight': return ts.lineHeight ?? a.lineHeight
    case 'letterSpacing': return ts.letterSpacing ?? a.letterSpacing
    case 'textAlign': return ts.alignment ?? ts.textAlign ?? a.textAlignment ?? a.textAlign
    case 'textTransform': return ts.transform
    case 'whiteSpace': return ts.whiteSpace ?? a.whiteSpace
    case 'color': return ts.color?.light ?? ts.color ?? ts.textColor ?? a.textColor ?? a.color
    case 'fontWeight': return a.font?.weight ?? ts.font?.weight
    case 'fontFamily': return a.font?.family ?? ts.font?.family
  }
}

const pxNorm = v => (typeof v === 'number' ? `${v}px` : String(v))
const firstFamily = v => String(v).split(',')[0].trim().replace(/^["']|["']$/g, '')

/**
 * @param evidenceDocs [{route, doc}] where doc is an evidence file written by the published-site collector
 * @param editorNodes Map(nodeId -> captured node) for conflict checks
 * @param nodeBreakpoint optional Map(nodeId -> breakpoint frame id); when given, evidence naming a node outside the doc's
 *   breakpoint is skipped (counted as `foreignNode`)
 */
export function buildOverlay(evidenceDocs, editorNodes = new Map(), nodeBreakpoint = null) {
  const nodes = {}, conflicts = [], coverage = [], rejected = new Set(), owner = new Map()
  for (const {route, doc} of evidenceDocs) {
    const width = doc.provenance?.viewport?.width ?? null
    const row = {route, width, breakpointId: doc.breakpointId ?? null, high: 0, medium: 0, low: 0, applied: 0, appliedFields: 0, foreignNode: 0,
      unmatchedArchive: (doc.unmatchedArchive || []).length, unmatchedLive: (doc.unmatchedLive || []).length,
      status: doc.breakpointId ? 'measured' : 'unverified: no breakpoint for this width'}
    const consensus = styleConsensus(doc, editorNodes, nodeBreakpoint)
    row.consensus = 0
    for (const e of doc.evidence || []) {
      row[e.confidence] = (row[e.confidence] || 0) + 1
      const byConsensus = !APPLY_CONFIDENCE.has(e.confidence) && consensus.has(e.nodeId)
      // Unverified widths (no breakpoint matched) are reported, never applied.
      if (!doc.breakpointId || (!APPLY_CONFIDENCE.has(e.confidence) && !byConsensus) || !e.nodeId) continue
      if (nodeBreakpoint && nodeBreakpoint.get(e.nodeId) !== doc.breakpointId) { row.foreignNode++; continue }
      const editor = editorNodes.get(e.nodeId)
      for (const f of ['fontWeight', 'fontFamily']) {
        const ev = editorValue(editor, f), lv = e.style?.[f]
        if (ev == null || lv == null) continue
        if (f === 'fontFamily' ? firstFamily(ev) !== firstFamily(lv) : String(ev) !== String(lv))
          conflicts.push({route, width, nodeId: e.nodeId, field: f, editor: ev, reference: lv, kept: 'editor'})
      }
      const textStyle = {}
      for (const [f, accept] of Object.entries(FIELDS)) {
        const v = accept(String(e.style?.[f] ?? ''))
        if (v == null) continue
        const ev = editorValue(editor, f)
        if (ev != null) { if (pxNorm(ev) !== v) conflicts.push({route, width, nodeId: e.nodeId, field: f, editor: ev, reference: v, kept: 'editor'}); continue }
        textStyle[f] = v
      }
      // Restore explicit published hard breaks only if the captured text is exactly unchanged
      // after removing those break characters. Never replace words, punctuation, or spaces.
      const original = editor?.text;
      let restored = typeof e.hardBreakText === 'string' && e.hardBreakText.includes('\n') &&
        typeof original === 'string' && !original.includes('\n') &&
        e.hardBreakText.replace(/\n/g, '') === original &&
        !editor?.richTextHTML
        ? e.hardBreakText : null;
      // Consensus proves the style, not which live element is this node, so per-element content is not restored.
      if (byConsensus && restored !== null) restored = null
      const tag = e.style?.blocks === '1' && /^(h[1-6]|p)$/.test(e.style?.tag || '') ? e.style.tag : null;
      if (!Object.keys(textStyle).length && restored === null && tag === null) continue
      // Node ids are per breakpoint frame; if one ever shows up under two widths, neither value is trusted.
      if (rejected.has(e.nodeId)) continue
      if (nodes[e.nodeId]) { rejected.add(e.nodeId); conflicts.push({route, width, nodeId: e.nodeId, field: '*', editor: null, reference: 'duplicate evidence for node', kept: 'none'}); const prev = owner.get(e.nodeId); prev.row.applied--; prev.row.appliedFields -= prev.fields; if (prev.consensus) prev.row.consensus--; delete nodes[e.nodeId]; continue }
      const fieldCount = Object.keys(textStyle).length + Number(restored !== null) + Number(tag !== null);
      row.applied++; row.appliedFields += fieldCount; if (byConsensus) row.consensus++
      owner.set(e.nodeId, {row, fields: fieldCount, consensus: byConsensus})
      nodes[e.nodeId] = {textStyle, ...(restored === null ? {} : {hardBreakText:restored}), ...(tag === null ? {} : {tag}), provenance: {source: 'published-site', url: doc.provenance?.url, viewport: doc.provenance?.viewport,
        capturedAt: doc.provenance?.capturedAt, responseSha256: doc.provenance?.responseSha256,
        breakpointId: doc.breakpointId ?? null, confidence: e.confidence, method: byConsensus ? `${e.method}+style-consensus` : e.method, framerName: e.framerName, domPath: e.domPath}}
    }
    row.vectors = 0
    const vp=doc.vectorProvenance
    const validVectorSource=vp?.source==='published-site' && vp.url===doc.provenance?.url &&
      vp.responseSha256===doc.provenance?.responseSha256 && vp.viewport?.width===width && vp.viewport?.height===doc.provenance?.viewport?.height
    if(validVectorSource&&doc.breakpointId){
      const seen=new Set(), duplicates=new Set()
      for(const e of doc.vectors||[]){if(seen.has(e.nodeId))duplicates.add(e.nodeId);seen.add(e.nodeId)}
      for(const e of doc.vectors||[]){
        if(e.confidence!=='high'||duplicates.has(e.nodeId)||!e.nodeId||rejected.has(e.nodeId)||nodes[e.nodeId])continue
        if(nodeBreakpoint&&nodeBreakpoint.get(e.nodeId)!==doc.breakpointId)continue
        const editor=editorNodes.get(e.nodeId), a=editor?.attributes||{}
        if(!editor||!['ComponentInstanceNode','SVGNode','IconNode'].includes(editor.kind)||editor.children?.length||a.svg||a.svgContent)continue
        if(!serializeReferenceVector(e.vector))continue
        nodes[e.nodeId]={vector:e.vector,provenance:{...vp,breakpointId:doc.breakpointId,confidence:e.confidence,method:e.method,framerName:e.framerName,domPath:e.domPath}}
        row.vectors++
      }
    }
    coverage.push(row)
  }
  return {format: OVERLAY_FORMAT, nodes, conflicts, coverage}
}

const normText = t => String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
const textKey = node => node && node.kind === 'TextNode' && typeof node.text === 'string'
  ? `${node.attributes?.name ?? ''}\u0000${normText(node.text)}` : null
// Tag and block count are part of the proven style: they differ per element and must not be taken from an order match.
const styleKey = style => JSON.stringify([...Object.keys(FIELDS), 'tag', 'blocks'].map(f => style?.[f] ?? null))

/**
 * Node ids whose identity match is ambiguous (repeated name+text) but whose published style is not: every live element
 * with that name+text belongs to the group (none unmatched, none matched to a node outside it) and all computed the
 * same text style.
 */
function styleConsensus(doc, editorNodes, nodeBreakpoint) {
  const groups = new Map()
  for (const e of doc.evidence || []) {
    if (nodeBreakpoint && nodeBreakpoint.get(e.nodeId) !== doc.breakpointId) continue // foreign entries never count toward quorum
    const k = textKey(editorNodes.get(e.nodeId))
    if (k == null) continue
    groups.set(k, [...(groups.get(k) || []), e])
  }
  // Live elements are identified by their published name plus the matched text.
  const liveName = e => `${e.framerName ?? ''}\u0000${normText(editorNodes.get(e.nodeId)?.text)}`
  const liveCount = new Map()
  for (const e of doc.evidence || []) liveCount.set(liveName(e), (liveCount.get(liveName(e)) || 0) + 1)
  // The collector truncates unmatched live text to 80 characters, so a truncated text blocks every group it prefixes.
  const unmatched = (doc.unmatchedLive || []).map(l => ({name: l.name ?? '', text: normText(l.text), truncated: String(l.text ?? '').length >= 80}))
  const archiveBlocked = new Set((doc.unmatchedArchive || []).map(id => textKey(editorNodes.get(id))).filter(k => k != null))
  const out = new Set()
  for (const [k, es] of groups) {
    const [name, text] = k.split('\u0000')
    if (es.length < 2 || archiveBlocked.has(k) || new Set(es.map(e => styleKey(e.style))).size !== 1) continue
    if (unmatched.some(l => l.name === name && (l.truncated ? text.startsWith(l.text) : text === l.text))) continue
    if (es.some(e => liveName(e) !== k) || liveCount.get(k) !== es.length) continue
    for (const e of es) out.add(e.nodeId)
  }
  return out
}

/** Returns a copy of a design snapshot with overlay entries attached as node.reference. */
export function applyOverlay(design, overlay) {
  if (!overlay?.nodes) return design
  const walk = node => {
    const out = {...node}
    if (overlay.nodes[node.id]) out.reference = overlay.nodes[node.id]
    if (Array.isArray(node.children)) out.children = node.children.map(walk)
    return out
  }
  return {...design, roots: (design.roots || []).map(walk)}
}

export function parseOverlay(text) {
  try { const o = JSON.parse(text); return o?.format === OVERLAY_FORMAT ? o : null } catch { return null }
}
