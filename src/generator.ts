import type {Attributes,DesignNode,Snapshot,Axis,CSSProperties,RenderOptions,CodeImport,ReusableBlock,NativeField} from './types.ts'
import {svgMarkup, svgPath, inheritsIconColor} from './vectors.ts'
/** Deterministic first-pass TSX / Tailwind / CSS generator from canvas snapshots. */

function cssLen(v: any):string|null {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}px`
  if (typeof v === 'string') {
    const s = v.trim()
    if (/^(auto|inherit|fit-content|max-content|min-content|0)$/.test(s) || /^-?\d+(\.\d+)?(px|rem|em|%|vw|vh|svh|dvh|fr)$/.test(s)) return s
    return null
  }
  if (v && typeof v === 'object') {
    const typ = String(v.type ?? '').toLowerCase()
    if (typ === 'fill') return '100%'
    if (typ === 'fit' || typ === 'fitcontent') return 'fit-content'
    if ('value' in v) return cssLen(v.value)
  }
  return null
}
function cssColor(value: any):string|null {
  const v = typeof value === 'string' ? value : value?.color ?? value?.value
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (/^var\(--[A-Za-z0-9_-]+\)$/.test(s)) return s
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\([\d\s,.%]+\)$/i.test(s) || /^hsla?\([\d\s,.%]+\)$/i.test(s) || /^(transparent|currentColor|inherit|black|white)$/i.test(s)) return s
  return null
}
function url(v: any):string|null {
  const s = typeof v === 'string' ? v : v?.url ?? v?.src ?? v?.imageUrl
  if (typeof s !== 'string') return null
  return /^(https?:\/\/|\/)/i.test(s) ? s : null
}
function safeLink(value: any):string|null {
  const s = typeof value === 'string' ? value : value?.url ?? value?.href
  if (typeof s !== 'string') return null
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(s) ? s : null
}
function cssVal(v:unknown):string|null { return typeof v === 'number' ? String(v) : typeof v === 'string' ? v : null }
function pad(v:any):string|null {
  if (typeof v === 'number') return cssLen(v)
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/)
    const valid = parts.every(p => cssLen(p))
    return parts.length >= 1 && parts.length <= 4 && valid ? v : null
  }
  if (v && typeof v === 'object') {
    const keys = ['top','right','bottom','left']
    if (keys.every(k => k in v)) return keys.map(k => cssLen(v[k])).join(' ')
  }
  return null
}
function align(v:unknown) {
  if (!v) return null
  const s = String(v).toLowerCase().replace(/\s+/g, '')
  return ({ start:'flex-start', end:'flex-end', center:'center', stretch:'stretch', baseline:'baseline', top:'flex-start', bottom:'flex-end', left:'flex-start', right:'flex-end' } as Record<string,string>)[s] || null
}
function distribution(v:unknown) {
  const s = String(v || '').toLowerCase().replace(/[-_\s]/g, '')
  return ({ start:'flex-start', end:'flex-end', center:'center', spacebetween:'space-between', spacearound:'space-around', spaceevenly:'space-evenly' } as Record<string,string>)[s] || null
}
const EDGE_KEYS = ['top','right','bottom','left']
/** An absolute layer with no edge offsets (and, in a real layout, no center pin) has nothing to place it by; keep it in flow. */
export function unplacedAbsolute(a:Attributes, unhydrated = false) {
  if (a.position !== 'absolute' || EDGE_KEYS.some(k => a[k] != null && a[k] !== '')) return false
  return unhydrated || ['centerX','centerY'].every(k => a[k] == null || a[k] === '')
}
/** Unhydrated archive pages report every layer as absolute pinned at centerX/centerY 0%; a real layout always has in-flow layers. */
export function hasUnhydratedPositions(roots:DesignNode[]) {
  let layers = 0
  const stack = (roots || []).flatMap(r => r.children || [])
  while (stack.length) {
    const n = stack.pop()!
    const a = n.attributes || {}
    if (a.position !== 'absolute' || EDGE_KEYS.some(k => a[k] != null && a[k] !== '')) return false
    layers++
    stack.push(...(n.children || []))
  }
  return layers > 0
}
/** Main axis of a stack container ('row' | 'column'), or null when the layer is not a stack. */
function stackAxis(node:DesignNode|null|undefined):Axis {
  const a = node?.attributes || {}
  if (a.layout === 'grid') return 'grid'
  if (a.layout !== 'stack') return null
  const d = String(a.stackDirection || 'vertical').toLowerCase()
  return d === 'horizontal' || d === 'row' ? 'row' : 'column'
}
function asCSS(node:DesignNode, unhydrated = false, parentAxis:Axis = null) {
  const a = node.attributes || {}
  const s:CSSProperties = {}
  const tw:string[] = []
  const put = (k:string,v:string|null|undefined) => { if (v != null && v !== '') s[k] = v }
  if (a.visible === false) tw.push('hidden')
  if (a.position && ['relative','absolute','fixed','sticky'].includes(a.position)) tw.push(unplacedAbsolute(a, unhydrated) ? 'relative' : a.position)
  if (a.layout === 'stack') {
    tw.push('flex')
    const direction = String(a.stackDirection || 'vertical').toLowerCase()
    tw.push(direction === 'horizontal' || direction === 'row' ? 'flex-row' : 'flex-col')
    if (a.stackWrapEnabled) tw.push('flex-wrap')
    put('align-items', align(a.stackAlignment))
    put('justify-content', distribution(a.stackDistribution))
  } else if (a.layout === 'grid') {
    tw.push('grid')
    const columns = Number.isInteger(a.gridColumnCount) && a.gridColumnCount > 0 ? a.gridColumnCount : a.gridColumnCount === 'auto-fill' ? 'auto-fill' : null
    const positivePx = (v:number) => Number.isFinite(v) && v > 0 ? cssLen(v) : null
    const columnWidth = positivePx(a.gridColumnWidth)
    const min = positivePx(a.gridColumnMinWidth) || (columns === 'auto-fill' ? columnWidth : null) || '0px'
    const track = a.gridColumnWidthType === 'fixed' && columnWidth ? columnWidth : `minmax(${min}, 1fr)`
    if (columns && !(columns === 'auto-fill' && min === '0px' && a.gridColumnWidthType !== 'fixed')) put('grid-template-columns', `repeat(${columns}, ${track})`)
    const rowTrack = a.gridRowHeightType === 'fixed' && positivePx(a.gridRowHeight) ? positivePx(a.gridRowHeight) : a.gridRowHeightType === 'fit' ? 'min-content' : a.gridRowHeightType === 'auto' ? 'minmax(0px, 1fr)' : null
    if (rowTrack) put('grid-auto-rows', rowTrack)
    if (Number.isInteger(a.gridRowCount) && a.gridRowCount > 0) put('grid-template-rows', `repeat(${a.gridRowCount}, ${rowTrack || 'minmax(0, auto)'})`)
    if (['start','center','end'].includes(a.gridAlignment)) put('justify-items', a.gridAlignment)
    put('align-items', 'start')
  }
  const len = { width:'width', height:'height', minWidth:'min-width', maxWidth:'max-width', minHeight:'min-height', maxHeight:'max-height', top:'top', right:'right', bottom:'bottom', left:'left' }
  for (const [k, prop] of Object.entries(len)) {
    const fr = (k === 'width' || k === 'height') && /^(?:(\d+(?:\.\d+)?)fr|fill)$/i.exec(String(a[k] ?? ''))
    // A fill size on the parent stack's cross axis stretches; only the main axis shares free space by fr weight.
    if (fr && parentAxis === 'grid') put(k === 'width' ? 'justify-self' : 'align-self', 'stretch')
    else if (fr && (parentAxis === 'row' || parentAxis === 'column') && (k === 'width') !== (parentAxis === 'row')) put('align-self', 'stretch')
    else if (fr) {
      put('flex-grow', fr[1] && Number(fr[1]) > 0 ? String(Number(fr[1])) : '1')
      put('flex-basis', '0px')
      if (k === 'width') put('min-width', '0')
      if (k === 'height') put('min-height', '0')
    } else put(prop, cssLen(a[k]))
  }
  // Framer stack children with explicit non-fill sizes do not shrink by default.
  if ((parentAxis === 'row' || parentAxis === 'column') && !['absolute','fixed'].includes(a.position) && !s['flex-grow']) put('flex-shrink', '0')
  if (parentAxis === 'grid') {
    const itemAlign = (v:string) => ['start','center','end'].includes(v) ? v : null
    if (a.gridItemFillCellWidth === true) { put('justify-self','stretch'); delete s.width }
    else if (!s['justify-self']) put('justify-self', itemAlign(a.gridItemHorizontalAlignment) || 'start')
    if (a.gridItemFillCellHeight === true) { put('align-self','stretch'); delete s.height }
    else if (!s['align-self']) put('align-self', itemAlign(a.gridItemVerticalAlignment) || 'start')
  }
  put('gap', pad(a.gap))
  put('padding', pad(a.padding))
  put('background-color', cssColor(a.backgroundColor))
  // Only when Framer's public text API omits colors: inherit readable text
  // from the nearest solid surface instead of browser-default black on black.
  const hex = /^#([0-9a-f]{6})$/i.exec(String(a.backgroundColor || ''))
  if (hex) {
    const rgb=[0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)/255)
    const light=rgb.map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4)
    const luminance=light[0]*0.2126+light[1]*0.7152+light[2]*0.0722
    put('color',luminance<0.28?'#f4f6f8':'#111827')
  }
  const image = url(a.backgroundImage)
  if (image) { put('background-image', `url(${JSON.stringify(image)})`); put('background-position', 'center'); put('background-size', 'cover') }
  if (typeof a.backgroundGradient === 'string' && /^(linear|radial|conic)-gradient\(/.test(a.backgroundGradient)) put('background-image', a.backgroundGradient)
  put('border-radius', pad(a.borderRadius))
  if (a.border && typeof a.border === 'object') {
    const bw = cssLen(a.border.width)
    const color = cssColor(a.border.color)
    if (bw && color) put('border', `${bw} ${/^(solid|dashed|dotted|double)$/.test(a.border.style) ? a.border.style : 'solid'} ${color}`)
  } else if (typeof a.border === 'string' && /^\d/.test(a.border)) put('border', a.border)
  if (typeof a.opacity === 'number' && a.opacity >= 0 && a.opacity < 1) put('opacity', String(a.opacity))
  const transforms:string[] = []
  if (['absolute','fixed'].includes(a.position) && !unplacedAbsolute(a, unhydrated)) {
    const center = (v:unknown) => typeof v === 'string' && /^-?\d+(?:\.\d+)?%$/.test(v) ? v : null
    if (a.left == null && a.right == null && center(a.centerX)) { put('left', center(a.centerX)); transforms.push('translateX(-50%)') }
    if (a.top == null && a.bottom == null && center(a.centerY)) { put('top', center(a.centerY)); transforms.push('translateY(-50%)') }
  }
  if (typeof a.rotation === 'number' && Number.isFinite(a.rotation) && a.rotation !== 0) transforms.push(`rotate(${a.rotation}deg)`)
  if (transforms.length) put('transform', transforms.join(' '))
  if (typeof a.zIndex === 'number') put('z-index', String(a.zIndex))
  for (const k of ['overflow','overflowX','overflowY']) {
    const prop = k === 'overflowX' ? 'overflow-x' : k === 'overflowY' ? 'overflow-y' : k
    if (/^(auto|hidden|visible|scroll|clip)$/.test(a[k])) put(prop, a[k])
  }
  if (a.aspectRatio && Number(a.aspectRatio) > 0) put('aspect-ratio', String(a.aspectRatio))
  if (a.gridItemColumnSpan === 'all') put('grid-column', '1 / -1')
  else if (Number.isInteger(a.gridItemColumnSpan) && a.gridItemColumnSpan > 1) put('grid-column', `span ${a.gridItemColumnSpan}`)
  if (Number.isInteger(a.gridItemRowSpan) && a.gridItemRowSpan > 1) put('grid-row', `span ${a.gridItemRowSpan}`)
  if (/^(RichText|Text)Node$/ .test(node.kind) || typeof node.text === 'string') {
    const ts = a.inlineTextStyle || {}
    // Opt-in published reference (src/enrichment.ts); only fills fields the editor capture lacks.
    const ref = node.reference?.textStyle || {}
    const whiteSpace = ts.whiteSpace ?? a.whiteSpace ?? ref.whiteSpace
    // The source treats intrinsic fit-content labels as non-wrapping unless evidence says otherwise.
    put('white-space', /^(pre|pre-wrap|pre-line|normal|nowrap|break-spaces)$/.test(whiteSpace) ? whiteSpace : 'pre-wrap')
    const font = a.font || {}
    const family = font.family || ts.font?.family || a.fontName || a.fontFamily
    put('font-family', typeof family === 'string' ? JSON.stringify(family) : null)
    put('font-weight', cssVal(font.weight ?? ts.font?.weight ?? ts.fontWeight ?? a.fontWeight))
    put('font-size', cssLen(ts.fontSize ?? a.fontSize ?? ref.fontSize))
    put('line-height', cssLen(ts.lineHeight ?? a.lineHeight ?? ref.lineHeight))
    put('letter-spacing', cssLen(ts.letterSpacing ?? a.letterSpacing ?? ref.letterSpacing))
    // Framer TextStyle colors may be ColorStyle objects ({light, dark}).
    put('color', cssColor(ts.color?.light || ts.color || ts.textColor || a.textColor || a.color || ref.color))
    const transform = ts.transform || ref.textTransform
    if (/^(uppercase|lowercase|capitalize)$/.test(transform)) put('text-transform', transform)
    const textAlign = ts.alignment || ts.textAlign || a.textAlignment || a.textAlign || ref.textAlign
    if (/^(left|right|center|justify|start|end)$/.test(textAlign)) put('text-align', textAlign)
    if (typeof node.richTextHTML === 'string' && /<br\s*\/?>/i.test(node.richTextHTML)) put('white-space', 'pre-line')
    if (a.textTruncation && Number(a.textTruncation) > 0) {
      put('display', '-webkit-box'); put('-webkit-line-clamp', String(a.textTruncation))
      put('-webkit-box-orient', 'vertical'); put('overflow', 'hidden')
    }
  }
  return { tw, css: s }
}
function identifier(name:unknown) {
  const words = String(name || 'FramerComponent').match(/[a-zA-Z0-9]+/g) || []
  let result = words.map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'FramerComponent'
  if (!/^[A-Za-z_]/.test(result)) result = 'Design' + result
  return result.slice(0, 75)
}
function cssText(styles:Record<string,CSSProperties>) {
  return Object.entries(styles).map(([sel, props]) => `${sel} {\n${Object.entries(props).map(([key, value]) => `  ${key}: ${String(value).replace(/[;{}]/g, '')};`).join('\n')}\n}`).join('\n\n')
}

const MAX_INSTANCE_DEPTH = 40
const OFFSET_KEYS = ['top','right','bottom','left','centerX','centerY']
/** Framer's getText() drops hard line breaks; the auto layer name keeps a prefix of them. Trust it only when it matches the text. */
export function textWithLayerBreaks(node:DesignNode) {
  const text = node.text ?? ""
  const restored = node.reference?.hardBreakText
  if (typeof restored === 'string' && typeof text === 'string' && !text.includes('\n') && restored.replace(/\n/g,'') === text && !node.richTextHTML) return restored
  const name = String(node.attributes?.name || '').replace(/^Text\s*[·/]\s*/, '')
  if (!name.includes('\n')) return text
  const flat = name.replace(/\n/g, '')
  if (!flat || !text.startsWith(flat)) return text
  return name + text.slice(flat.length)
}
/** Replace an empty canvas-component instance with the selected variant's layers, sized and placed by the instance. */
export function expandCanvasInstance(instance:DesignNode, component:DesignNode|null|undefined) {
  const variants = (component?.children || []).filter(v => v && v.kind === 'FrameNode')
  if (!variants.length) return null
  const ia = instance.attributes || {}
  const variant = variants.find(v => v.id === ia.controls?.variant) || variants[0]
  const attributes:Attributes = {...variant.attributes}
  for (const key of OFFSET_KEYS) delete attributes[key]
  for (const key of ['name','position','width','height','visible','opacity','rotation',...OFFSET_KEYS]) if (ia[key] !== undefined) attributes[key] = ia[key]
  return {...variant, id: instance.id, kind: 'FrameNode', attributes, children: variant.children || []}
}
/** A breakpoint's canvas position (absolute at 0,0) would take the page out of flow and collapse the document height. */
export function inFlowRoot(root:DesignNode) {
  const a = root?.attributes
  if (!a || a.position !== 'absolute') return root
  const attributes:Attributes = {...a, position: 'relative'}
  for (const key of OFFSET_KEYS) delete attributes[key]
  if (attributes.isBreakpoint === true && attributes.height === 'fit-content' &&
      attributes.minHeight == null && attributes.layout === 'stack' &&
      attributes.stackDirection !== 'horizontal' && attributes.stackDistribution === 'start' &&
      cssColor(attributes.backgroundColor)) {
    attributes.minHeight = '100vh'
  }
  return {...root, attributes}
}
// Explicitly named design-only input fields can be rendered as native controls.
 // This is semantic inference, not a claim that the original has functional form behavior.
export function nativeField(node:DesignNode, parent:DesignNode|null|undefined):NativeField|null {
  const a=node?.attributes || {}, name=String(a.name||'')
  if(node?.kind!=='FrameNode'||a.visible===false||a.link||a.layout!=='stack'||!/(^|[ /·_-])input([ /·_-]|$)/i.test(name))return null
  const visible=(node.children||[]).filter(c=>c.attributes?.visible!==false)
  const text=visible.filter((c):c is DesignNode & {text:string}=>c.kind==='TextNode'&&typeof c.text==='string'&&!!c.text.trim()&&!c.attributes?.link)
  if(text.length!==1||visible.some(c=>c!==text[0]&&(!['ComponentInstanceNode','SVGNode','IconNode'].includes(c.kind)||!/(^|[ /·_-])icon([ /·_-]|$)/i.test(c.attributes?.name||'')||c.children?.length)))return null
  if(/\n/.test(text[0].text)||text[0].text.length>240||a.height==='fit-content'&&!a.border&&!a.backgroundColor)return null
  const siblingLabel=(parent?.children||[]).find(c=>c!==node&&c.kind==='TextNode'&&typeof c.text==='string'&&c.attributes?.visible!==false)
  const suffix=(name.split(/[/·]/).at(-1) ?? '').trim()
  const label=siblingLabel?.text?.trim()||(!/^(input|input visual)$/i.test(suffix)?suffix:'Input')
  const semantic=label.toLowerCase()
  const type=/password|passphrase/.test(semantic)?'password':/e[ -]?mail/.test(semantic)?'email':/search/.test(semantic)?'search':/phone|telephone/.test(semantic)?'tel':/website|\burl\b/.test(semantic)?'url':'text'
  return {id:text[0].id,label,type,placeholder:text[0].text}
}
export function generateBundle(snapshot:Snapshot, options:RenderOptions = {}) {
  if (!Array.isArray(snapshot?.roots) || !snapshot.roots.length) throw new Error('No canvas layers in snapshot')
  const baseName = snapshot.roots.length === 1 ? snapshot.roots[0]?.attributes?.name : 'SelectedDesign'
  const componentName = identifier(baseName)
  // Prevent CSS collisions across exported pages and breakpoints.
  const identity = String(snapshot.pagePath || '') + '|' + (snapshot.roots || []).map(n => n.id || n.attributes?.name || '').join('|')
  let hash = 0x811c9dc5
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  const namespace = hash.toString(36)
  const css:Record<string,CSSProperties> = {}
  const warnings = [...(snapshot.warnings || [])]
  if (hasUnhydratedPositions(snapshot.roots)) warnings.push('Layer positions were not hydrated in this export (every layer absolute at centerX/centerY 0%); layers are kept in document flow. Re-export after opening the page in Framer to capture real positions.')
  let nodeIndex = 0
  const unhydrated = hasUnhydratedPositions(snapshot.roots)
  const codeImports = new Map<string,CodeImport>()
  const reusableBlocks:ReusableBlock[] = []
  function render(node:DesignNode, depth:number, parentAxis:Axis = null, parent:DesignNode|null = null, field:NativeField|null = null):string {
    const markup = renderNode(node, depth, parentAxis, parent, field)
    if (!options.collectReusable) return markup
    const a = node.attributes || {}
    const definition = node.kind === 'ComponentInstanceNode' ? options.resolveCanvasComponent?.(a.componentIdentifier) : null
    const component = definition && (node.children?.length || definition.children?.some(v => v.kind === 'FrameNode'))
    const layout = !component && depth === 3 && node.kind === 'FrameNode' && (node.children?.length ?? 0) > 0
    if (!component && !layout) return markup
    const id = reusableBlocks.length + 1
    reusableBlocks.push({
      id, kind: component ? 'component' : 'layout',
      name: component ? (definition?.attributes?.name || a.componentName || a.name) : a.name,
      identity: component ? JSON.stringify([a.componentIdentifier, a.controls?.variant ?? null]) : String(a.name || ''),
      markup
    })
    return '  '.repeat(depth) + '{/*__FTA_REUSE_' + id + '__*/}'
  }
  function renderNode(node:DesignNode, depth:number, parentAxis:Axis = null, parent:DesignNode|null = null, field:NativeField|null = null):string {
    const id = ++nodeIndex
    const cls = `f2a-${namespace}-${id}`
    const attrs = node.attributes || {}
    if(options.layoutSlot && node.kind==='PlaceholderNode')return '  '.repeat(depth)+'{children}'
    const {tw, css: localCss} = asCSS(node, unhydrated, parentAxis)
    // Framer frame borders are painted over the frame, not included in its layout box.
    // Preserve child padding and stack geometry while matching the visible border.
    const edgeBorders:CSSProperties={}
    for(const side of ['Top','Right','Bottom','Left']){
      const value=attrs['border'+side]
      if(typeof value==='string'&&/^\d+(?:\.\d+)?px (solid|dashed|dotted|double) (#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(value))edgeBorders['border-'+side.toLowerCase()]=value
    }
    const overlayBorder = localCss.border
    if ((overlayBorder||Object.keys(edgeBorders).length) && node.kind === 'FrameNode') {
      delete localCss.border
      if (!tw.some(v => ['relative','absolute','fixed','sticky'].includes(v))) tw.push('relative')
      css[`.${cls}::after`] = {content:'""',position:'absolute',inset:'0',...(overlayBorder?{border:overlayBorder}:{}),...edgeBorders,'border-radius':'inherit','box-sizing':'border-box','pointer-events':'none'}
    }
    if (Object.keys(localCss).length) css[`.${cls}`] = localCss
    const className = [...tw, cls].join(' ')
    // Layer id on the DOM lets preview fidelity checks compare each rendered box with its captured rect.
    const classAttr = `className=${JSON.stringify(className)}` + (typeof node.id === 'string' ? ` data-f2a-node=${JSON.stringify(node.id)}` : '')
    const indent = '  '.repeat(depth)
    if(field && node.id===field.id){
      Object.assign(localCss,{width:'100%','min-width':'0',height:'auto',margin:'0',padding:'0',border:'0','background-color':'transparent','box-shadow':'none',outline:'none','flex-shrink':'1',...(parentAxis==='row'?{'flex-grow':'1','flex-basis':'0px'}:{})})
      css[`.${cls}`]=localCss
      css[`.${cls}::placeholder`]={color:'currentColor',opacity:'1'}
      css[`.${cls}:focus-visible`]={outline:'1px solid currentColor','outline-offset':'1px'}
      return `${indent}<input ${classAttr} type=${JSON.stringify(field.type)} aria-label=${JSON.stringify(field.label)} placeholder=${JSON.stringify(field.placeholder)} autoComplete="off" />`
    }
    if (node.kind === 'ComponentInstanceNode' && typeof options.resolveCodeComponent === 'function') {
      const resolved = options.resolveCodeComponent(attrs.componentIdentifier)
      if (resolved) {
        const alias = `FTA_Code_${id}`
        codeImports.set(alias, resolved)
        const controls = attrs.controls && typeof attrs.controls === 'object' ? attrs.controls : {}
        return `${indent}<div ${classAttr}><${alias} {...${JSON.stringify(controls)}} /></div>`
      }
    }
    if (node.kind === 'ComponentInstanceNode' && !(node.children || []).length && typeof options.resolveCanvasComponent === 'function' && depth < MAX_INSTANCE_DEPTH) {
      const expanded = expandCanvasInstance(node, options.resolveCanvasComponent(attrs.componentIdentifier))
      if (expanded) return renderNode(expanded, depth, parentAxis, parent, field)
    }
    const ownField = nativeField(node,parent)
    const content = typeof node.text === 'string'
      ? `{${JSON.stringify(textWithLayerBreaks(node))}}`
      : (node.children || []).map(child => render(child, depth + 1, stackAxis(node), node, ownField)).join('\n')
    const inlineSvg = svgMarkup(node)
    if (inlineSvg) {
      const svgSource = '/' + svgPath(inlineSvg)
      if (inheritsIconColor(inlineSvg)) {
        const mask = JSON.stringify(`url(${svgSource})`)
        const label = String(attrs.altText || attrs.alt || attrs.name || 'Icon')
        const maskWidth = /^(\d+(?:\.\d+)?)(?:px|rem|em)$/.test(String(attrs.width)) ? attrs.width : '24px'
        const maskHeight = /^(\d+(?:\.\d+)?)(?:px|rem|em)$/.test(String(attrs.height)) ? attrs.height : maskWidth
        const controlColor = Object.values(attrs.controls || {}).find(v => cssColor(v))
        const iconColor = cssColor(attrs.textColor || attrs.color || controlColor) || 'inherit'
        return `${indent}<span ${classAttr} role="img" aria-label=${JSON.stringify(label)} style={{ display: ${JSON.stringify(attrs.visible === false ? "none" : "inline-block")}, width: ${JSON.stringify(maskWidth)}, height: ${JSON.stringify(maskHeight)}, color: ${JSON.stringify(iconColor)}, backgroundColor: "currentColor", maskImage: ${mask}, WebkitMaskImage: ${mask}, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />`
      }
      return `${indent}<img ${classAttr} src=${JSON.stringify(svgSource)} alt=${JSON.stringify(String(attrs.altText || attrs.alt || attrs.name || ''))} />`
    }
    const imageUrl = url(attrs.image || attrs.backgroundImage)
    const isImageLayer = /ImageNode/i.test(node.kind)
    if (isImageLayer && imageUrl) {
      return `${indent}<img ${classAttr} src=${JSON.stringify(imageUrl)} alt=${JSON.stringify(String(attrs.altText || attrs.alt || attrs.name || ''))} />`
    }
    let tag = typeof node.text === 'string' ? 'p' : 'div'
    if (/Heading|Title|H1/i.test(attrs.name || '') && typeof node.text === 'string') tag = 'h2'
    if (typeof node.text === 'string' && /^(h[1-6]|p)$/.test(node.reference?.tag || '')) tag = node.reference!.tag!
    const link = safeLink(attrs.link)
    if (link) tag = 'a'
    const props = [`${classAttr}`]
    if(typeof attrs.ariaLabel==='string')props.push('aria-label='+JSON.stringify(attrs.ariaLabel))
    if (link) {
      props.push(`href=${JSON.stringify(link)}`)
      if (attrs.linkOpenInNewTab) props.push('target="_blank"', 'rel="noopener noreferrer"')
    }
    const attrString = props.join(' ')
    if (!content) return `${indent}<${tag} ${attrString} />`
    if (typeof node.text === 'string') return `${indent}<${tag} ${attrString}>${content}</${tag}>`
    return `${indent}<${tag} ${attrString}>\n${content}\n${indent}</${tag}>`
  }
  const jsx = snapshot.roots.map(root => render(inFlowRoot(root), 2)).join('\n')
  const codeImportLines = [...codeImports.entries()].map(([alias, item]) => {
    const binding = item.exportName === 'default' ? alias : `{ ${item.exportName} as ${alias} }`
    return `import ${binding} from ${JSON.stringify(item.importPath)}`
  })
  const signature=options.layoutSlot?'({children}: {children: import("react").ReactNode})':'()'
  const tsx = `/**\n * First-pass generated from Framer public Plugin API node data.\n * Requires Tailwind CSS installed in the host app.\n * Use AGENT.md + design.json to refine responsive behavior and semantics.\n */\nimport "./component.css"\n${codeImportLines.join("\\n")}\nexport default function ${componentName}${signature} {\n  return (\n    <>\n${jsx}\n    </>\n  )\n}\n`
  const allWarnings = [...new Set(warnings)]
  const styles = `/* Generated fallback styles for exact values not covered by static Tailwind classes.\n * Tailwind's layout utilities are in Component.tsx.\n */\n${cssText(css)}\n`
  const agent = `# Implement this Framer design\n\nYou are integrating a selected Framer design into an existing React + TypeScript + Tailwind application.\n\n## Files\n- Component.tsx: a readable first-pass React component with Tailwind utilities\n- component.css: exact CSS values where Tailwind utilities are insufficient\n- design.json: original **Framer Plugin API snapshot** of the selected layer hierarchy and exposed properties\n\n## Assignment\n1. Inspect the existing repository (React version, routing, Tailwind version, components, design tokens) before changing anything.\n2. Implement the design faithfully and use the generated component as a starting point, not unquestioned production code.\n3. Consult design.json for dimensions, nesting, content, link targets, typography, backgrounds, and assets.\n4. Replace placeholder divs with appropriate accessible semantic elements and real app components.\n5. Make it responsive. The selected snapshot may contain only one breakpoint; do not claim unprovided breakpoints are exact.\n6. Recreate custom Framer behaviors, animations, and interactive components only if supported by source data or user clarification.\n7. Reuse existing project conventions and install no unnecessary dependencies.\n8. Run lint/typecheck/build/tests and report remaining mismatches.\n\n## Known limitations requiring review\n${allWarnings.length ? allWarnings.map(w => `- ${w}`).join('\n') : '- No known exporter warnings. Check visual fidelity anyway.'}\n\nThe output JSON is not a byte-for-byte export of Framer's private internal document; it contains the available public Plugin API data. Images are referenced by URL; the surrounding exporter may bundle compatible referenced asset binaries into assets/ and records failures in assets/manifest.json.\n`
  return { componentName, tsx, css: styles, json: JSON.stringify(snapshot, null, 2), agent, warnings: allWarnings, reusableBlocks }
}
