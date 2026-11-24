import { isTextNode } from '@framer/plugin'
import {resolveIcon} from './icon-resolver.mjs'
/**
 * Read-only exporter for the publicly documented Framer Plugin canvas API.
 * This is a plugin-API snapshot, not Framer's private internal project JSON.
 */

const FIELDS = [
  'name', 'path', 'collectionId', 'draft', 'visible', 'locked', 'isReplica', 'originalNodeId',
  'position', 'top', 'right', 'bottom', 'left', 'centerX', 'centerY',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'rotation', 'opacity', 'zIndex', 'aspectRatio',
  'backgroundColor', 'backgroundImage', 'backgroundGradient', 'border',
  'borderRadius', 'overflow', 'overflowX', 'overflowY', 'imageRendering',
  'layout', 'gap', 'padding', 'stackDirection', 'stackDistribution',
  'stackAlignment', 'stackWrapEnabled', 'gridColumnCount', 'gridRowCount',
  'gridAlignment', 'gridColumnWidthType', 'gridColumnWidth',
  'gridColumnMinWidth', 'gridRowHeightType', 'gridRowHeight',
  'gridItemColumnSpan', 'gridItemRowSpan', 'gridItemFillCellWidth',
  'gridItemFillCellHeight', 'gridItemHorizontalAlignment',
  'gridItemVerticalAlignment', 'link', 'linkOpenInNewTab',
  'linkRelValues', 'linkSmoothScroll', 'linkPreserveParams',
  'isBreakpoint', 'isPrimaryBreakpoint', 'font', 'fontName', 'fontFamily',
  'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textAlignment', 'textColor', 'color', 'text', 'inlineTextStyle',
  'textTruncation', 'componentIdentifier', 'componentName', 'controls',
  'svg', 'svgContent', 'icon', 'set', 'iconSet', 'iconSetId', 'image', 'alt', 'altText',
]

/** Strip methods, circular references, and unsafe non-JSON objects. */
export function jsonSafe(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined
  if (depth > 6) return '[Maximum object depth]'
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular reference]'
    seen.add(value)
    const output = Array.isArray(value) ? [] : {}
    try {
      const keys = Object.keys(value).slice(0, 75)
      // Framer SDK assets and styles can be class instances with non-enumerable fields.
      if (!Array.isArray(value)) {
        for (const key of ['id', 'name', 'url', 'src', 'color', 'value', 'type', 'family', 'weight', 'style', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'alignment', 'tag', 'transform', 'font', 'breakpoints', 'minWidth', 'paragraphSpacing', 'balance', 'path', 'light', 'dark', 'imageUrl', 'alt', 'altText']) {
          if (!keys.includes(key) && key in value) keys.push(key)
        }
      }
      for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        try {
          const v = jsonSafe(value[key], depth + 1, seen)
          if (v !== undefined) output[key] = v
        } catch { /* Non-serializable SDK getter. */ }
      }
    } finally { seen.delete(value) }
    return output
  }
  return String(value)
}

export function inferKind(node) {
  const candidate = [node.type, node.__class, node.constructor?.name].find(v => typeof v === 'string' && /Node$/.test(v))
  if (candidate) return candidate
  if (typeof node.text === 'string') return 'RichTextNode'
  if ('componentIdentifier' in node && 'controls' in node) return 'ComponentInstanceNode'
  if ('componentIdentifier' in node) return 'ComponentNode'
  if ('svg' in node || 'svgContent' in node) return 'SVGNode'
  if ('layout' in node || 'backgroundColor' in node) return 'FrameNode'
  return 'UnknownNode'
}

const HYDRATE_TIMEOUT_MS = 5000
const HYDRATE_POLL_MS = 100
/**
 * Framer only loads the canvas page that is open; nodes on other pages report
 * null rects and text. Open the page through the public navigateTo API and wait
 * until one of its layers has a rect before reading it.
 */
export async function hydrateCanvas(node, warnings, {timeoutMs = HYDRATE_TIMEOUT_MS, pollMs = HYDRATE_POLL_MS} = {}) {
  if (typeof node?.navigateTo !== 'function') return false
  try { await node.navigateTo({select:false, zoomIntoView:false}) } catch (error) {
    warnings.add('navigateTo failed, layer data may be unhydrated: ' + String(error?.message || error))
    return false
  }
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const probes = [node, ...((await node.getChildren?.()) || []).slice(0, 3)]
      for (const probe of probes) if (await probe.getRect?.()) return true
    } catch { /* Keep polling until the deadline. */ }
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  warnings.add(`Canvas did not report layer rects within ${timeoutMs}ms of navigateTo; text and positions may be unhydrated.`)
  return false
}

export async function readLayer(node, state, depth = 0, trail = []) {
  if (state.count >= state.maxNodes) {
    state.warnings.add(`Stopped at ${state.maxNodes} nodes. Select a smaller section or raise the exporter limit.`)
    return null
  }
  state.count++
  const confirmedText = isTextNode(node) || node.type === 'TextNode' || node.type === 'RichTextNode'
  const layerName = String(node.name || node.componentName || inferKind(node) || 'Layer')
  const layerPath = [...trail, layerName].join(' / ')
  const result = {
    id: String(node.id ?? `unknown-${state.count}`),
    kind: confirmedText ? 'TextNode' : inferKind(node),
    layerPath,
    attributes: {},
    children: [],
  }
  for (const key of FIELDS) {
    try {
      if (!(key in node)) continue
      const value = node[key]
      if (value == null || typeof value === 'function') continue
      result.attributes[key] = jsonSafe(value)
    } catch (error) {
      state.warnings.add(`${layerPath} [${result.id}]: could not read ${key}: ${String(error?.message || error)}`)
    }
  }
  // VectorSetItemNode exposes its actual SVG through the public getSVG() API.
  if (result.kind === 'VectorSetItemNode' && !result.attributes.svg && typeof node.getSVG === 'function') {
    try {
      const svg = await node.getSVG()
      if (typeof svg === 'string' && /^\s*<svg(?:\s|>)/i.test(svg)) {
        result.attributes.svg = svg
        result.attributes.vectorOrigin = 'editor-vector-set-item'
      } else state.warnings.add(`${layerPath} [${result.id}]: VectorSetItemNode.getSVG returned no SVG`)
    } catch(error) { state.warnings.add(`${layerPath} [${result.id}]: VectorSetItemNode.getSVG failed: ${String(error?.message||error)}`) }
  }
  if ((result.kind === 'ComponentInstanceNode' || result.kind === 'IconNode') && !result.attributes.svg && !result.attributes.svgContent) {
    const match = await resolveIcon(result.attributes.icon || result.attributes.componentName, result.attributes.name || result.layerPath, result.attributes.set || result.attributes.iconSetId || result.attributes.iconSet)
    if (match?.svg) {
      result.attributes.svg = match.svg
      result.attributes.iconKey = match.key
      result.attributes.vectorOrigin = match.source || 'Lucide'; result.attributes.iconSourceInferred = Boolean(match.inferred)
    } else if (match?.unavailable) {
      result.attributes.iconSource = match.source
      result.attributes.iconExportStatus = 'missing-svg'
      state.warnings.add('SVG source ' + match.source + ' needs original vector data; inspect design.json iconExportStatus')
    }
  }
  if (typeof result.attributes.text === 'string') result.text = result.attributes.text
  if (result.text === undefined && confirmedText && typeof node.getText === 'function') {
    try {
      const text = await node.getText()
      if (typeof text === 'string') result.text = text
      // Framer returns null for text layers on canvas pages that are not loaded.
      else state.warnings.add('Text content unavailable (getText returned ' + text + '); the page canvas was probably not hydrated.')
    } catch (error) { if (!/not a text node/i.test(String(error?.message || error))) state.warnings.add(`${layerPath} [${result.id}]: plain text unavailable: ${String(error?.message || error)}`) }
  }
  if (confirmedText && typeof node.getHTML === 'function') {
    try {
      const html = await node.getHTML()
      if (typeof html === 'string') result.richTextHTML = html
      else state.warnings.add('Rich text HTML unavailable (getHTML returned ' + html + ').')
    } catch (error) { state.warnings.add('Rich text HTML unavailable (TextNode.getHTML is @alpha): ' + String(error?.message || error)) }
  }
  if (typeof node.getRect === 'function') {
    try {
      const rect = await node.getRect()
      if (rect) result.rect = jsonSafe(rect)
      else state.warnings.add('Layer rect unavailable (getRect returned null); the page canvas was probably not hydrated.')
    } catch (error) { state.warnings.add('Layer rect unavailable: ' + String(error?.message || error)) }
  }
  if (depth > 40) {
    state.warnings.add(`${layerPath} [${result.id}]: skipped unusually deep descendants`)
    return result
  }
  try {
    const children = typeof node.getChildren === 'function' ? await node.getChildren() : []
    for (const child of children || []) {
      const item = await readLayer(child, state, depth + 1, [...trail, layerName])
      if (item) result.children.push(item)
      if (state.count >= state.maxNodes) break
    }
  } catch (error) { state.warnings.add(`${layerPath} [${result.id}]: could not read descendants: ${String(error?.message || error)}`) }
  return result
}

export async function captureSelection(framer, maxNodes = 750) {
  const selection = await framer.getSelection()
  if (!selection || selection.length === 0) throw new Error('Select a layer or frame in Framer first.')
  const state = { count: 0, maxNodes, warnings: new Set() }
  const roots = []
  for (const node of selection) {
    const exported = await readLayer(node, state)
    if (exported) roots.push(exported)
  }
  return {
    format: 'framer-to-agent/canvas-snapshot-v1',
    disclaimer: 'Snapshot of properties exposed through the public Framer Plugin API; not Framer internal source JSON.',
    exportedAt: new Date().toISOString(),
    selectedCount: selection.length,
    nodeCount: state.count,
    roots,
    warnings: [...state.warnings],
  }
}
