import type {SDKClient,JsonObject,DesignNode,Snapshot,ArchiveFiles,LibraryResult,AssetReferences,URLReference,InlineSVG,FontDescriptor,AssetRecord,AssetResult} from './types.ts'
import {errorMessage} from './types.ts'
type AssetFetcher=(url:string,options:RequestInit)=>Promise<Pick<Response,'ok'|'status'|'arrayBuffer'> & {headers?:Pick<Headers,'get'>}>
import {buildFontCss} from "./font-faces.ts"
import {svgMarkup, svgPath, safeSvg} from './vectors.ts'
import {jsonSafe, readLayer, hydrateCanvas} from './exporter.ts'
import {generateBundle} from './generator.ts'

const MAX_ASSETS = 3000
const MAX_SVG_FILES = 10000
const MAX_SVG_BYTES = 80 * 1024 * 1024
const MAX_ASSET_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 70 * 1024 * 1024
const slug = (x:unknown) => String(x || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '').slice(0, 75) || 'unknown'
const token = (x:unknown) => slug(x).toLowerCase()
const relPath = (x:unknown) => String(x || 'unnamed').replace(/\\/g, '/').split('/').filter(x => x && x !== '.' && x !== '..').map(slug).join('/') || 'unnamed'
const safe = (obj:JsonObject, key:string) => { try {return jsonSafe(obj[key])} catch {return undefined} }
const errMsg = errorMessage
const isColor = (s:unknown):s is string => typeof s === 'string' && /^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color\(|transparent$|currentcolor$)/i.test(s.trim())

async function list(framer:SDKClient, method:string, warnings:string[], ...args:unknown[]):Promise<JsonObject[]> {
  if (typeof framer[method] !== 'function') {warnings.push(method + ' unavailable in this Framer API');return []}
  try {return await framer[method](...args) || []}
  catch (e) {warnings.push(method + ': ' + errMsg(e));return []}
}
const fields = (item:JsonObject, names:string[]):JsonObject => {
  const row:JsonObject = {}
  for (const field of names) {
    const value = safe(item, field)
    if (value !== undefined) row[field] = value
  }
  return row
}

export async function exportProjectLibrary(framer:SDKClient, {rawOnly=false}={}):Promise<LibraryResult> {
  const warnings:string[] = []
  const files:ArchiveFiles = {}
  const colorStyles = await list(framer, 'getColorStyles', warnings)
  const textStyles = await list(framer, 'getTextStyles', warnings)
  const colors = colorStyles.map(s => fields(s, ['id','name','light','dark']))
  const texts = textStyles.map(s => fields(s, ['id','name','tag','font','fontSize','lineHeight','letterSpacing','color','alignment','textAlign','breakpoints','minWidth','fontWeight','paragraphSpacing','decoration']))
  files['library/styles.json'] = JSON.stringify({colors, texts}, null, 2)
  const css = [':root {']
  const dark = []
  for (const style of colors) {
    if (isColor(style.light)) css.push('  --framer-' + token(style.name) + ': ' + style.light + ';')
    if (isColor(style.dark)) dark.push('  --framer-' + token(style.name) + ': ' + style.dark + ';')
  }
  css.push('}')
  if (dark.length) css.push('[data-theme="dark"] {\n' + dark.join('\n') + '\n}')
  for (const style of texts) {
    const rules = []
    for (const [property, cssProperty] of [['fontSize','font-size'],['lineHeight','line-height'],['letterSpacing','letter-spacing']]) {
      let v = style[property]
      if (typeof v !== 'string' && typeof v !== 'number') continue
      if (typeof v === 'number') v = v + 'px'
      if (/^[\d.]+(px|em|rem|%|vh|vw)?$/.test(String(v))) rules.push(cssProperty + ': ' + v)
    }
    if (isColor(style.color)) rules.push('color: ' + style.color)
    if (rules.length) css.push('.framer-text-' + token(style.name) + ' { ' + rules.join('; ') + '; }')
  }
  files['library/tokens.css'] = css.join('\n') + '\n'

  const codeFiles = []
  for (const file of await list(framer, 'getCodeFiles', warnings)) {
    const entry = fields(file, ['id','name','path','exports'])
    const path = 'library/code/' + relPath(entry.path || entry.name || entry.id)
    entry.exportPath = path
    try {
      if (typeof file.content === 'string') files[path] = file.content
      else { entry.sourceAvailable = false; warnings.push('Code source unavailable: ' + (entry.name || path)) }
    } catch (e) {entry.sourceAvailable = false; warnings.push('Code source read failed: ' + errMsg(e))}
    codeFiles.push(entry)
  }
  files['library/code-files.json'] = JSON.stringify(codeFiles, null, 2)

  const componentFiles = []
  const componentSnapshots:Snapshot[] = []
  const seen = new Set()
  const componentNodes = await list(framer, 'getNodesWithType', warnings, 'ComponentNode')
  for (const node of componentNodes) {
    const id = String(node.componentIdentifier || node.id || node.name || 'unknown')
    if (seen.has(id)) continue
    seen.add(id)
    try {
      const state = {count:0, maxNodes:5000, warnings:new Set<string>()}
      await hydrateCanvas(node, state.warnings)
      const root = await readLayer(node, state)
      if (!root) throw Error("Component root unavailable")
      const snapshot = {format:'framer-to-agent/component-snapshot-v1', disclaimer:'Framer public Plugin API properties only, not private document source.',roots:[root],nodeCount:state.count,warnings:[...state.warnings]}
      const folder = 'library/components/' + slug(node.componentName || node.name || 'Component') + '-' + slug(id).slice(0,16)
      const bundle = rawOnly ? null : generateBundle(snapshot)
      if (bundle) {
        files[folder + '/Component.tsx'] = bundle.tsx
        files[folder + '/component.css'] = bundle.css
      }
      files[folder + '/design.json'] = JSON.stringify(snapshot, null, 2)
      files[folder + '/AGENT.md'] = bundle?.agent || 'Raw reusable component definition; compile from design.json.'
      componentFiles.push({id, name:node.componentName || node.name || id, folder, nodeCount:state.count, truncated:state.count >= state.maxNodes,warnings:snapshot.warnings})
      componentSnapshots.push(snapshot)
    } catch (e) {warnings.push('Component ' + id + ': ' + errMsg(e))}
  }
  files['library/components.json'] = JSON.stringify(componentFiles, null, 2)

  // Framer vector sets are reusable icon libraries. Preserve their hierarchy,
  // names and any SVGNode markup reachable as descendants.
  const vectorSetRecords = []
  const vectorSets = await list(framer, 'getNodesWithType', warnings, 'VectorSetNode')
  for (const vectorSet of vectorSets) {
    try {
      const state = {count:0, maxNodes:5000, warnings:new Set<string>()}
      const root = await readLayer(vectorSet, state)
      if (!root) continue
      const folder = 'library/vector-sets/' + slug(vectorSet.name || vectorSet.id || 'icons')
      const snapshot = {format:'framer-to-agent/vector-set-snapshot-v1', roots:[root], warnings:[...state.warnings]}
      files[folder + '/design.json'] = JSON.stringify(snapshot, null, 2)
      vectorSetRecords.push({id:vectorSet.id || null, name:vectorSet.name || null, folder, count:state.count, truncated:state.count >= state.maxNodes})
      componentSnapshots.push(snapshot)
    } catch (error) { warnings.push('Vector set ' + (vectorSet.name || vectorSet.id) + ': ' + errMsg(error)) }
  }
  files['library/vector-sets.json'] = JSON.stringify(vectorSetRecords, null, 2)

  // Include standalone SVG layers, including icons not referenced by selected pages.
  // Reusable vectors remain grouped in vector-sets above. No render screenshots used.
  const svgEntries = []
  const svgSnapshot:Snapshot = {roots:[]}
  let svgMissing = 0
  const standaloneSvg = await list(framer, 'getNodesWithType', warnings, 'SVGNode')
  for (const node of standaloneSvg.slice(0, 10000)) {
    const name = String(node.name || node.id || 'Unnamed icon')
    const id = String(node.id || name)
    const markup = safe(node, 'svg')
    if (typeof markup === 'string' && /^\s*<svg(?:\s|>)/i.test(markup)) {
      const path = svgPath(markup.trim())
      svgEntries.push({id,name,path,status:'available'})
      svgSnapshot.roots.push({id,kind:'SVGNode',attributes:{name,svg:markup.trim()},children:[]})
    } else {
      svgEntries.push({id,name,status:'unavailable',reason:'SVGNode.svg is not exposed for this layer'})
      svgMissing++
    }
  }
  if (svgMissing) warnings.push(svgMissing + ' SVG nodes have no readable svg markup; see library/svg-index.json for names and IDs')
  if (standaloneSvg.length > 10000) warnings.push('SVG inventory reached its 10000 node limit; see library/svg-index.json')
  files['library/svg-index.json'] = JSON.stringify(svgEntries, null, 2)
  if (svgSnapshot.roots.length) componentSnapshots.push(svgSnapshot)

  // Schema only: CMS items may contain private customer information.
  const cms = []
  for (const collection of await list(framer, 'getCollections', warnings)) {
    const entry = fields(collection, ['id','name','slugFieldName','managedBy'])
    try {if (typeof collection.getFields === 'function') entry.fields = jsonSafe(await collection.getFields())}
    catch (e) {warnings.push('CMS schema ' + (entry.name || entry.id) + ': ' + errMsg(e))}
    cms.push(entry)
  }
  files['library/cms-schema.json'] = JSON.stringify(cms, null, 2)
  return {
    files, componentSnapshots, warnings,
    summary:{colorStyles:colors.length,textStyles:texts.length,components:componentFiles.length,vectorSets:vectorSetRecords.length,svgNodes:svgEntries.length,codeFiles:codeFiles.length,cmsCollections:cms.length},
    limitations:[
      'Unused media files and Assets panel folders are not guaranteed discoverable using the public Framer Plugin API.',
      'Framer does not document a general-purpose API for exporting arbitrary project variables. Color/text styles are captured as design tokens.',
      'Component variants, embedded code dependencies, fonts and Framer-specific behavior require verification.',
      'The API can expose SVGNode.svg markup, but vector shapes represented by PathNode/ShapeGroupNode may not expose SVG path payloads.'
    ]
  }
}

export function collectAssetReferences(snapshots:Snapshot[]):AssetReferences {
  const urls = new Map<string,URLReference>()
  const fontFamilies = new Set<string>()
  const fontDescriptors = new Map<string,FontDescriptor>()
  const inlineSvg:InlineSVG[] = []
  const seen = new WeakSet()
  const vectorPaths = new Set()
  function visit(obj:JsonObject, origin:string, depth = 0, parentKey = ''):void {
    if (!obj || typeof obj !== 'object' || depth > 24 || seen.has(obj)) return
    seen.add(obj)
    const font = obj.attributes?.font || obj.font
    if (font && typeof font === 'object' && typeof font.url === 'string' && typeof font.family === 'string') {
      fontFamilies.add(font.family)
      fontDescriptors.set(font.url, {url:font.url,family:font.family,weight:font.weight,style:font.style})
    }
    const markup = svgMarkup(obj as DesignNode)
    if (markup) {
      const path = svgPath(markup)
      if (!vectorPaths.has(path)) {
        vectorPaths.add(path)
        inlineSvg.push({source:markup, usedBy:origin, path, nodeId:obj.id || null, nodeName:obj.attributes?.name || null})
      }
    }
    for (const [key, item] of Object.entries(obj)) {
      const at = origin + '/' + key
      if (typeof item === 'string') {
        if ((key === 'fontName' || key === 'fontFamily') && item) fontFamilies.add(item)
        if (/^https:\/\//i.test(item) && (/image|background|asset|src|url|poster|file|video|icon|logo/i.test(key + ' ' + parentKey) || /\.(svg|png|jpe?g|webp|gif|avif|mp4|woff2?|ttf|otf)(\?|$)/i.test(item))) {
          if (!urls.has(item)) urls.set(item, {url:item, usedBy:[at]})
          else if (urls.get(item)!.usedBy.length < 25) urls.get(item)!.usedBy.push(at)
        } else if (/^\s*<svg(?:\s|>)/i.test(item) && item.length < 2_000_000) {
          const path = svgPath(item.trim())
          if (!vectorPaths.has(path)) {
            vectorPaths.add(path)
            inlineSvg.push({source:item.trim(),usedBy:at,path})
          }
        }
      } else if (item && typeof item === 'object') visit(item as JsonObject, at, depth + 1, key)
    }
  }
  for (const [i, snapshot] of (snapshots || []).entries()) visit(snapshot, 'snapshot-' + i)
  return {urls:[...urls.values()], inlineSvg, fontFamilies:[...fontFamilies], fontDescriptors:[...fontDescriptors.values()]}
}
const extension = (type:string|undefined, url:string) => {
  const map:Record<string,string> = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/avif':'.avif','image/gif':'.gif','image/svg+xml':'.svg','video/mp4':'.mp4','font/woff2':'.woff2','font/woff':'.woff','application/font-woff':'.woff','font/ttf':'.ttf','font/otf':'.otf'}
  if (type && map[type]) return map[type]
  try {return new URL(url).pathname.match(/\.(svg|png|jpe?g|webp|gif|avif|mp4|woff2?|ttf|otf)$/i)?.[0] || '.bin'} catch {return '.bin'}
}
const isFramerAsset = (uri:string) => {
  try {const url = new URL(uri);return url.protocol === 'https:' && (url.hostname === 'framerusercontent.com' || url.hostname.endsWith('.framerusercontent.com') || url.hostname === 'fonts.gstatic.com')}
  catch {return false}
}
export async function bundleAssets(references:AssetReferences, fetchFn:AssetFetcher = globalThis.fetch):Promise<AssetResult> {
  const files:ArchiveFiles = {}
  const manifest:AssetRecord[] = []
  const warnings:string[] = []
  let totalBytes = 0
  for (const [i, asset] of references.urls.slice(0, MAX_ASSETS).entries()) {
    const row:AssetRecord = {...asset,bundled:false}
    if (!isFramerAsset(asset.url)) {
      row.reason = 'External or unsupported host; URL preserved without network request'
      manifest.push(row)
      continue
    }
    try {
      const response = await fetchFn(asset.url, {credentials:'omit',mode:'cors'})
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const declaredSize = Number(response.headers?.get('content-length') || 0)
      if (declaredSize > MAX_ASSET_BYTES || declaredSize + totalBytes > MAX_TOTAL_BYTES) throw new Error('Download size limit exceeded')
      const blob = new Uint8Array(await response.arrayBuffer())
      if (blob.byteLength > MAX_ASSET_BYTES || blob.byteLength + totalBytes > MAX_TOTAL_BYTES) throw new Error('Download size limit exceeded')
      const path = 'assets/file-' + String(i+1).padStart(4,'0') + extension(response.headers?.get('content-type')?.split(';')[0], asset.url)
      files[path] = blob
      totalBytes += blob.byteLength
      row.bundled = true
      row.path = path
    } catch (e) {
      row.reason = errMsg(e)
      warnings.push('Unable to download referenced asset ' + asset.url + ': ' + row.reason)
    }
    manifest.push(row)
  }
  if (references.urls.length > MAX_ASSETS) {
    warnings.push('Asset count limit reached; ' + (references.urls.length - MAX_ASSETS) + ' URLs left as references')
    for(const item of references.urls.slice(MAX_ASSETS))manifest.push({...item,bundled:false,reason:'Asset count limit exceeded'})
  }
  let svgBytes = 0
  for (const item of references.inlineSvg.slice(0, MAX_SVG_FILES).values()) {
    const path = item.path || svgPath(item.source)
    try {
      const payload = safeSvg(item.source)
      const bytes = new TextEncoder().encode(payload).byteLength
      if (svgBytes + bytes > MAX_SVG_BYTES) throw new Error('SVG archive exceeds 80MB limit')
      svgBytes += bytes
      files[path] = payload
      manifest.push({type:'svg',bundled:true,usedBy:[item.usedBy],nodeId:item.nodeId || null,nodeName:item.nodeName || null,path})
    } catch (error) {
      manifest.push({type:'svg',bundled:false,usedBy:[item.usedBy],path,reason:errMsg(error)})
      warnings.push('SVG content could not be safely bundled: ' + item.usedBy + ': ' + errMsg(error))
    }
  }
  if (references.inlineSvg.length > MAX_SVG_FILES) {
    warnings.push('SVG count limit reached; ' + (references.inlineSvg.length - MAX_SVG_FILES) + ' SVG items left as references')
    for(const item of references.inlineSvg.slice(MAX_SVG_FILES))manifest.push({type:'svg',bundled:false,path:item.path||svgPath(item.source),usedBy:[item.usedBy],nodeId:item.nodeId||null,reason:'SVG count limit exceeded'})
  }
  files['assets/fonts.css'] = buildFontCss(manifest, references.fontDescriptors?.length ? references.fontDescriptors : references.fontFamilies)
  files['assets/manifest.json'] = JSON.stringify({assets:manifest,bytes:totalBytes,warnings}, null, 2)
  return {files,manifest,warnings,totalBytes}
}

export function appendLibraryInstructions(library:LibraryResult, assetResult:AssetResult) {
  return '\n## Shared project library\n' +
    '- Import `library/tokens.css` and use `library/styles.json` for named light/dark colors and responsive text styles.\n' +
    '- Use `library/components/` for saved design components, `library/vector-sets/` for icon libraries, and `library/code/` for code components.\n' +
    '- `library/cms-schema.json` contains collection schemas only, not customer data.\n' +
    '- `assets/manifest.json` maps original URLs and SVG layers to assets/ files when browser CORS permits. Keep working remote URLs for unbundled assets and report anything missing.\n' +
    '- Framer variables beyond available styles are not guaranteed exportable. Do not assume every Assets panel item was captured.\n' +
    '- Do not execute Framer code components automatically; adapt them into the destination app.\n\n' +
    'Library summary: ' + JSON.stringify(library.summary) + ', bundled assets: ' + assetResult.manifest.filter(x=>x.bundled).length + '\n' +
    'Known limitations:\n' + library.limitations.concat(library.warnings, assetResult.warnings).map(x=>'- '+x).join('\n') + '\n'
}
