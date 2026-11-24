import type {DesignNode} from './types.ts'
import {serializeReferenceVector} from './reference-vector.ts'
/** Shared stable vector paths used by the TSX generator and asset packer. */
export function svgMarkup(node:DesignNode|null|undefined):string|null {
  const a = node?.attributes || {}
  for (const value of [a.svg, a.svgContent]) {
    if (typeof value === 'string' && /^\s*<svg(?:\s|>)/i.test(value) && /<\/svg\s*>\s*$/i.test(value.trim())) return value.trim()
  }
  return serializeReferenceVector(node?.reference?.vector)
}

export function svgPath(svg:string) {
  // Two independent FNV-1a passes minimize collisions while remaining browser-compatible.
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < svg.length; i++) {
    const ch = svg.charCodeAt(i)
    a = Math.imul(a ^ ch, 0x01000193) >>> 0
    b = Math.imul(b ^ ch, 0x811c9dc5) >>> 0
  }
  return `assets/vectors/${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}.svg`
}

export function safeSvg(svg:string) {
  if (!/^\s*<svg(?:\s|>)/i.test(svg) || !/<\/svg\s*>\s*$/i.test(svg.trim())) {
    throw new Error('Invalid or incomplete SVG markup')
  }
  if (svg.length > 4_000_000) throw new Error('SVG exceeds 4MB safety limit')
  if (/<!(?:DOCTYPE|ENTITY)|<\?xml-stylesheet/i.test(svg)) throw new Error('SVG contains XML entities or external stylesheets')
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('Malformed SVG XML')
    const banned = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animatemotion', 'animatetransform'])
    const toRemove:Element[] = []
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT)
    const elements:Element[] = [document.documentElement]
    while (walker.nextNode()) elements.push(walker.currentNode as Element)
    for (const element of elements) {
      if (banned.has(element.localName.toLowerCase())) { toRemove.push(element); continue }
      for (const attr of [...element.attributes]) {
        const name = attr.name.toLowerCase()
        const attrValue = attr.value.trim()
        if (name.startsWith('on') ||
          (['href','xlink:href','src'].includes(name) && !/^#[-\w:.]+$/.test(attrValue) && !/^data:image\/(?:png|gif|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(attrValue)) ||
          (/url\s*\(\s*['"]?\s*(?:https?:|javascript:|data:|\/\/)/i.test(attrValue)) ||
          (/javascript\s*:/i.test(attrValue))) element.removeAttribute(attr.name)
      }
    }
    for (const element of toRemove) element.remove()
    return new XMLSerializer().serializeToString(document.documentElement)
  }
  // Node test fallback. The actual plugin runs in a browser, using the XML parser above.
  if (/<(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|javascript\s*:|\b(?:href|src)\s*=\s*['"](?:https?:|\/\/)/i.test(svg)) {
    throw new Error('SVG requires XML sanitization in a browser')
  }
  return svg
}

/** Monochrome Lucide-style vector can inherit the surrounding CSS color as a mask. */
export function inheritsIconColor(svg:string) {
  if (!/currentColor/i.test(svg)) return false
  const paints = [...svg.matchAll(/\b(?:fill|stroke)\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2].trim().toLowerCase())
  if (paints.some(paint => !['currentcolor','none'].includes(paint))) return false
  if (/<(?:linearGradient|radialGradient|pattern|image)\b/i.test(svg)) return false
  return true
}
