/** Browser-safe shared React module generation from exporter-owned JSX.
 * Only known canvas instances or identical repeated top-level layouts are extracted.
 * Instance-local CSS classes and source node IDs are passed as props; no visual values are guessed.
 */
const markerRe = /^[ \t]*\{\/\*__FTA_REUSE_(\d+)__\*\/\}[ \t]*$/gm
const attrRe = /^([ \t]*)<([a-z][\w:-]*) className=("(?:\\.|[^"\\])*")(?: data-f2a-node=("(?:\\.|[^"\\])*"))?/gm
const textRe = />\{("(?:\\.|[^"\\])*")\}<\//g
const hash = value => {
  let h = 0x811c9dc5
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(36)
}
function title(value) {
  const words = String(value || 'Shared').match(/[a-zA-Z0-9]+/g) || ['Shared']
  return words.slice(0, 6).map(w => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 64) || 'Shared'
}
export function relativeModule(from, to) {
  const a = from.split('/').slice(0, -1), b = to.replace(/\.[cm]?[jt]sx?$/, '').split('/')
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift() }
  const out = '../'.repeat(a.length) + b.join('/')
  return out.startsWith('.') ? out : './' + out
}
export function routeDirectory(route) {
  // Reversible path encoding: avoid traversal, collisions, and unsafe file names.
  const parts = String(route || '/').split('/').filter(Boolean)
  const safe = s => {
    let out = ''
    for (const c of s) out += /^[a-zA-Z0-9-]$/.test(c) ? c : '_' + c.codePointAt(0).toString(16) + '_'
    return out || '_empty'
  }
  return 'preview/src/pages/' + (parts.length ? parts.map(safe).join('/') : '_index')
}
function template(block) {
  const raw = block.markup
  // Source code components are already shared imports; do not move unresolved page-local aliases.
  if (/\bFTA_Code_\d+\b/.test(raw)) return null
  const indent = raw.match(/^[ \t]*/)?.[0] || ''
  const dedented = raw.split('\n').map(l=>l.startsWith(indent)?l.slice(indent.length):l).join('\n')
  const slots = [], parts = [], textValues = []
  let body = dedented.replace(attrRe, (_, space, tag, cls, id) => {
    const i = slots.length
    slots.push({className: JSON.parse(cls), ...(id === undefined ? {} : {nodeId: JSON.parse(id)})})
    return space + '<' + tag + ' className={slots[' + i + '].className}' + (id === undefined ? '' : ' data-f2a-node={slots[' + i + '].nodeId}')
  }).replace(markerRe, (line, id) => {
    const i = parts.length
    parts.push(Number(id))
    return (line.match(/^[ \t]*/)?.[0] || '') + '{parts[' + i + ']}'
  })
  if (block.kind === 'component') body = body.replace(textRe, (_, str) => {
    const i = textValues.length
    textValues.push(JSON.parse(str))
    return '>{textValues[' + i + ']}</'
  })
  if (!slots.length) return null
  // Include component identity/variant or layout name, not instance IDs/classes.
  const key = JSON.stringify([block.kind, block.identity, body])
  return {key, body, slots, parts, textValues}
}
export function generateReusableModules(variants) {
  const groups = new Map(), perVariant = []
  for (const v of variants) {
    const blocks = new Map((v.blocks || []).map(b=>[b.id,b]))
    const normalized = new Map()
    for (const b of blocks.values()) {
      const t = template(b)
      if (!t) continue
      normalized.set(b.id,t)
      let g = groups.get(t.key)
      if (!g) {
        g={block:b, template:t, routes:new Set(), count:0}
        groups.set(t.key,g)
      }
      g.routes.add(v.route); g.count++
    }
    perVariant.push({v,blocks,normalized})
  }
  const files = {}, used = new Set(), report = []
  for (const g of groups.values()) {
    if (g.block.kind !== 'component' && g.routes.size < 2) continue
    const folder = g.block.kind === 'component' ? 'components/canvas' : 'layouts'
    const base = title(g.block.name)
    const suffix = hash(g.template.key)
    let alias = 'Shared' + base + '_' + suffix
    for (let n=2;used.has(alias);n++) alias='Shared'+base+'_'+suffix+'_'+n
    used.add(alias)
    g.alias=alias
    g.path='preview/src/'+folder+'/'+base+'-'+alias.slice(('Shared'+base+'_').length)+'.tsx'
    const t=g.template
    const props=['slots: { className: string; nodeId?: string }[]']
    if(t.parts.length) props.push('parts: ReactNode[]')
    if(t.textValues.length) props.push('textValues: string[]')
    const destructure=['slots',...(t.parts.length?['parts']:[]),...(t.textValues.length?['textValues']:[])]
    files[g.path]=(t.parts.length?'import type { ReactNode } from "react"\n':'')+
      '/** Reused '+g.block.kind+' template. Instance styles and IDs remain local to the calling page. */\n'+
      'type Props = { '+props.join('; ')+' }\n'+
      'export default function '+alias+'({ '+destructure.join(', ')+' }: Props) {\n  return (\n'+
      t.body.split('\n').map(l=>'    '+l).join('\n')+'\n  )\n}\n'
    report.push({kind:g.block.kind,file:g.path.slice('preview/'.length),instances:g.count,routes:g.routes.size})
  }
  for (const {v,blocks,normalized} of perVariant) {
    const imports = new Map()
    function resolve(id, space='') {
      const block=blocks.get(id)
      if(!block) throw new Error('Missing reusable JSX block '+id)
      const t=normalized.get(id), g=t&&groups.get(t.key)
      if(!g?.alias) return replaceMarkers(block.markup).trimStart().split('\n').map((l,i)=>i?l:space+l).join('\n')
      imports.set(g.alias,g.path)
      const props=['slots={'+JSON.stringify(t.slots)+'}']
      if(t.textValues.length) props.push('textValues={'+JSON.stringify(t.textValues)+'}')
      if(t.parts.length) props.push('parts={['+t.parts.map(id=>resolve(id).trim()).join(',\n')+']}')
      return space+'<'+g.alias+' '+props.join(' ')+' />'
    }
    function replaceMarkers(text) { return text.replace(markerRe,(line,id)=>resolve(Number(id),line.match(/^[ \t]*/)?.[0]||'')) }
    const body=replaceMarkers(v.tsx)
    const lines=[...imports].map(([alias,target])=>'import '+alias+' from '+JSON.stringify(relativeModule(v.path,target)))
    files[v.path]=(lines.length?lines.join('\n')+'\n':'')+body
  }
  return {files, report}
}
