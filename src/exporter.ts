import type {SDKNode,SDKClient,DesignNode,Attributes,Snapshot,CaptureState,HydrationOptions} from './types.ts'
import {errorMessage} from './types.ts'
import { isTextNode } from '@framer/plugin'
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
  'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'fontFeatureSettings', 'textTransform', 'textDecoration', 'paragraphSpacing', 'balance', 'textStyle', 'textStyleId', 'tag', 'viewBox', 'onTap',
  'textAlign', 'textAlignment', 'textColor', 'color', 'text', 'inlineTextStyle',
  'textTruncation', 'componentIdentifier', 'componentName', 'controls',
  'ariaLabel', 'd', 'fill', 'stroke', 'strokeWidth', 'x', 'y', 'floatingPlacement', 'floatingAlignment', 'floatingOffsetX', 'floatingOffsetY', 'svg', 'svgContent', 'icon', 'set', 'iconSet', 'iconSetId', 'image', 'alt', 'altText',
]

/** Strip methods, circular references, and unsafe non-JSON objects. */
export function jsonSafe(value:unknown, depth = 0, seen = new WeakSet<object>()):any {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined
  if (depth > 64) throw Error('SDK object nesting exceeds capture limit')
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular reference]'
    seen.add(value)
    const output:Record<string,unknown> = Array.isArray(value) ? [] as unknown as Record<string,unknown> : {}
    try {
      const keys = Object.keys(value)
      // Framer SDK assets and styles can be class instances with non-enumerable fields.
      if (!Array.isArray(value)) {
        for (const key of ['id', 'name', 'url', 'src', 'color', 'value', 'type', 'family', 'selector', 'weight', 'style', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'alignment', 'tag', 'transform', 'font', 'breakpoints', 'minWidth', 'paragraphSpacing', 'balance', 'path', 'light', 'dark', 'imageUrl', 'alt', 'altText']) {
          if (!keys.includes(key) && key in value) keys.push(key)
        }
      }
      for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        try {
          const v = jsonSafe((value as Record<string,unknown>)[key], depth + 1, seen)
          if (v !== undefined) output[key] = v
          else if(Array.isArray(value))output[key]=null
        } catch (error) { throw Error('SDK property '+key+': '+errorMessage(error)) }
      }
    } finally { seen.delete(value) }
    return output
  }
  return String(value)
}

export function inferKind(node:SDKNode):string {
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
export async function hydrateCanvas(node:SDKNode, warnings:Set<string>, {timeoutMs = HYDRATE_TIMEOUT_MS, pollMs = HYDRATE_POLL_MS}:HydrationOptions = {}) {
  if (typeof node?.navigateTo !== 'function') return false
  try { await node.navigateTo({select:false, zoomIntoView:false}) } catch (error) {
    warnings.add('navigateTo failed, layer data may be unhydrated: ' + errorMessage(error))
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

export async function readLayer(node:SDKNode, state:CaptureState, depth = 0, trail:string[] = []):Promise<DesignNode|null> {
  if (state.count >= state.maxNodes) {
    state.warnings.add(`Stopped at ${state.maxNodes} nodes. Select a smaller section or raise the exporter limit.`)
    return null
  }
  state.count++
  const confirmedText = isTextNode(node as Parameters<typeof isTextNode>[0]) || node.type === 'TextNode' || node.type === 'RichTextNode'
  const layerName = String(node.name || node.componentName || inferKind(node) || 'Layer')
  const layerPath = [...trail, layerName].join(' / ')
  const result:DesignNode & {attributes:Attributes;children:DesignNode[];layerPath:string} = {
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
      state.warnings.add(`${layerPath} [${result.id}]: could not read ${key}: ${errorMessage(error)}`)
    }
  }
  // VectorSetItemNode exposes its actual SVG through the public getSVG() API.
  if (['VectorSetItemNode','ShapeContainerNode'].includes(result.kind) && !result.attributes.svg && typeof node.getSVG === 'function') {
    try {
      const svg = await node.getSVG()
      if (typeof svg === 'string' && /^\s*<svg(?:\s|>)/i.test(svg)) {
        result.attributes.svg = svg
        result.attributes.vectorOrigin = 'editor-svg-api'
      } else state.warnings.add(`${layerPath} [${result.id}]: VectorSetItemNode.getSVG returned no SVG`)
    } catch(error) { state.warnings.add(`${layerPath} [${result.id}]: VectorSetItemNode.getSVG failed: ${errorMessage(error)}`) }
  }
  if (['ComponentInstanceNode','IconNode','ShapeContainerNode','PathNode'].includes(result.kind)
      && !result.attributes.svg && !result.attributes.svgContent
      && (result.attributes.icon || result.attributes.set || result.kind==='ShapeContainerNode' || result.kind==='PathNode')){
    result.attributes.iconExportStatus = 'source-vector-unavailable'
    state.warnings.add(layerPath+' ['+result.id+']: exact vector artwork not exposed by the capture API.')
  }
  if (typeof result.attributes.text === 'string') result.text = result.attributes.text
  if (result.text === undefined && confirmedText && typeof node.getText === 'function') {
    try {
      const text = await node.getText()
      if (typeof text === 'string') result.text = text
      // Framer returns null for text layers on canvas pages that are not loaded.
      else state.warnings.add('Text content unavailable (getText returned ' + text + '); the page canvas was probably not hydrated.')
    } catch (error) { if (!/not a text node/i.test(errorMessage(error))) state.warnings.add(`${layerPath} [${result.id}]: plain text unavailable: ${errorMessage(error)}`) }
  }
  if (confirmedText && typeof node.getHTML === 'function') {
    try {
      const html = await node.getHTML()
      if (typeof html === 'string') result.richTextHTML = html
      else state.warnings.add('Rich text HTML unavailable (getHTML returned ' + html + ').')
    } catch (error) { state.warnings.add('Rich text HTML unavailable (TextNode.getHTML is @alpha): ' + errorMessage(error)) }
  }
  if (typeof node.getRect === 'function') {
    try {
      const rect = await node.getRect()
      if (rect) result.rect = jsonSafe(rect)
      else state.warnings.add('Layer rect unavailable (getRect returned null); the page canvas was probably not hydrated.')
    } catch (error) { state.warnings.add('Layer rect unavailable: ' + errorMessage(error)) }
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
  } catch (error) { state.warnings.add(`${layerPath} [${result.id}]: could not read descendants: ${errorMessage(error)}`) }
  return result
}

export async function captureSelection(framer:SDKClient, maxNodes = 750):Promise<Snapshot> {
  const selection = await framer.getSelection?.()
  if (!selection || selection.length === 0) throw new Error('Select a layer or frame in Framer first.')
  const state = { count: 0, maxNodes, warnings: new Set<string>() }
  const roots:DesignNode[] = []
  for (const node of selection) {
    const exported = await readLayer(node, state)
    if (exported) roots.push(exported)
  }
  return {
    format: 'framer-to-agent/canvas-snapshot-v1',
    disclaimer: 'Snapshot of properties exposed through the public Framer Plugin API; not Framer internal source JSON.',
    exportedAt: new Date().toISOString(),
    selectedCount: selection.length,
    truncated:state.count>=state.maxNodes,
    nodeCount: state.count,
    roots,
    warnings: [...state.warnings],
  }
}
