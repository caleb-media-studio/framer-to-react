import type {DesignNode,Snapshot,Severity,DiagnosticLocation,DiagnosticIssue,DiagnosticGroup,InventoryEntry,JsonObject,LibraryResult,AssetResult} from './types.ts'
interface DiagnosticOptions {snapshots?:Snapshot[];manifest?:{warnings?:string[];failures?:unknown[]};library?:Partial<LibraryResult>;assets?:Partial<AssetResult>;selection?:boolean}
import {svgMarkup} from './vectors.ts'
/**
 * An honest export report: actual failures are actionable issues; ordinary reusable
 * component instances are inventory, not 1,000+ fake errors.
 * Zero network calls. Every diagnostic retains its original source node details.
 */
const severityRank:Record<Severity,number> = {error: 0, warning: 1, review: 2, info: 3}
const MAX_EXAMPLES = 12

function text(value:unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
function inputIssue(source:string, severity:Severity, code:string, message:string, location:DiagnosticLocation = {}, fix = ''):DiagnosticIssue {
  return {severity, code, message, source, ...location, fix}
}
function nodeContext(node:DesignNode, page:string, trail:string[] = []):DiagnosticLocation & {nodeName:string} {
  const name = text(node.attributes?.name, `${node.kind || 'Layer'} (${node.id || '?'})`)
  const layerPath = node.layerPath || [...trail, name].join(' / ')
  return {page, layerPath, nodeName:name, nodeId:node.id || null, nodeType:node.kind || 'Unknown',
    componentIdentifier:node.attributes?.componentIdentifier || null,
    componentName:node.attributes?.componentName || null,
    capturedProperties:Object.keys(node.attributes || {}).sort()}
}
const codeForLegacy = (message:string):[Severity,string,string]|null => {
  if (/node limit|stopped at|incomplete|truncated|skipped unusually deep descendants/i.test(message)) return ['error','EXPORT_TRUNCATED','Raise the node limit or export a smaller section.']
  if (/could not read descendants/i.test(message)) return ['error','CHILDREN_READ_FAILED','Confirm plugin permissions and retry the affected page.']
  if (/could not read |plain text unavailable/i.test(message)) return ['warning','NODE_READ_FAILED','Inspect this layer in Framer, then retry the export.']
  if (/gradient rendering/i.test(message)) return ['review','GRADIENT_FIDELITY','Check complex gradients visually in the React result.']
  if (/rich text/i.test(message)) return ['review','RICH_TEXT_FIDELITY','Inspect the original HTML in design.json before rebuilding rich text.']
  if (/component behavior\/variants|review component semantics|review component semantics and interactivity/i.test(message)) return null
  if (/responsive breakpoints/i.test(message)) return ['review','RESPONSIVE_ASSEMBLY','Combine all exported breakpoint variants into one responsive component.']
  if (/folder grouping|path is inferred/i.test(message)) return ['review','PATH_INFERRED','Verify route mapping in manifest.json.']
  return ['warning','SDK_EXPORT_NOTE','Review this SDK message and the recorded source.']
}
function pushLegacy(out:DiagnosticIssue[], value:unknown, source:string, page = '') {
  const message = text(value)
  if (!message) return
  const match = codeForLegacy(message)
  if (!match) return
  out.push(inputIssue(source, match[0], match[1], message, {page}, match[2]))
}
function pushNodeIssues(node:DesignNode, page:string, out:DiagnosticIssue[], inventory:Map<string,InventoryEntry>, trail:string[] = [], depth = 0):void {
  if (!node || depth > 100) return
  const ctx = nodeContext(node, page, trail)
  const a = node.attributes || {}
  const isInstance = /ComponentInstanceNode|CodeComponentNode/.test(node.kind || '')
  if (isInstance) {
    const id = text(a.componentIdentifier, text(a.componentName, `anonymous-${node.kind}`))
    const entry:InventoryEntry = inventory.get(id) || {identifier:id, name:text(a.componentName, text(a.name, id)), kind:node.kind,
      count:0, pages:new Set<string>(), instances:[]}
    entry.count++
    entry.pages.add(page)
    entry.instances.push(ctx)
    inventory.set(id, entry)
    // An instance is not itself an error! The actual missing-component mismatch
    // will be diagnosed once for each definition in finalizeInventory().
  }
  if (node.kind === 'UnknownNode') {
    out.push(inputIssue('canvas', 'review', 'UNKNOWN_LAYER', 'Framer returned an unknown layer type. The TSX may need a semantic replacement.', ctx,
      'Inspect this layer in the Framer canvas and compare the generated markup.'))
  }
  if (node.kind === 'SVGNode' && !svgMarkup(node) && !a.image) {
    out.push(inputIssue('canvas', 'warning', 'SVG_DATA_MISSING', 'SVG layer is present but the export has no usable vector payload.', ctx,
      'Export the missing SVG asset manually or recreate it from the design.'))
  }
  if (/^PathNode$/.test(node.kind) && !svgMarkup(node)) {
    out.push(inputIssue('canvas','warning','VECTOR_PATH_UNAVAILABLE',
      'Framer exposes this vector path layer but not its SVG geometry through the documented plugin API.',ctx,
      'Export the original vector as an SVG image in Framer, or replace it with a saved SVGNode icon.'))
  }
  if (a.backgroundGradient && typeof a.backgroundGradient !== 'string') {
    out.push(inputIssue('canvas', 'review', 'GRADIENT_FIDELITY', 'Gradient data is preserved in JSON but needs CSS translation.', ctx,
      'Check the gradient against its original Framer layer.'))
  }
  if (typeof node.richTextHTML === 'string' && /<(?!\/?(?:p|div|br)\b)[a-z]/i.test(node.richTextHTML)) {
    out.push(inputIssue('canvas','review','RICH_TEXT_FIDELITY', 'Rich text formatting is in JSON but not fully reconstructed in the TSX draft.', ctx,
      'Use richTextHTML from design.json to restore original formatting.'))
  }
  if (/^(?:Text|RichText)Node$/.test(node.kind || '') && node.rect &&
      typeof node.text === 'string' && node.text.trim() &&
      !a.fontSize && !a.inlineTextStyle?.fontSize && !a.inlineTextStyle?.id) {
    out.push(inputIssue('typography', 'review', 'TEXT_METRICS_NOT_EXPOSED',
      'Framer did not expose this text layer\'s font size, line height, or alignment through the plugin snapshot.',
      ctx, 'Re-export using a capture adapter that exposes the original text style. Do not estimate font sizes from layer bounds.'))
  }
  for (const child of node.children || []) pushNodeIssues(child, page, out, inventory, [...trail, ctx.nodeName], depth + 1)
}
function finalizeInventory(inventory:Map<string,InventoryEntry>, componentIds:Set<string>, codeFiles:JsonObject[], out:DiagnosticIssue[]) {
  const componentReport = []
  const codeNames = (codeFiles || []).flatMap(f => [f.name, f.id, f.path]).filter(Boolean)
  for (const entry of inventory.values()) {
    const resolved = componentIds.has(entry.identifier) || codeNames.includes(entry.identifier)
    componentReport.push({identifier:entry.identifier, name:entry.name, type:entry.kind,
      count:entry.count, pages:[...entry.pages], resolvedDefinition:resolved,
      instances:entry.instances})
    if (!resolved) {
      out.push(inputIssue('component-library', 'review', 'COMPONENT_DEFINITION_NOT_EXPORTED',
        `The definition for ${entry.name} was not matched to exported component source. ${entry.count} instance(s) were captured, with their properties.`,
        {...entry.instances[0],componentIdentifier:entry.identifier,affectedInstances:entry.instances},
        'Check library/components.json and code-files.json. If Framer does not expose the definition, reconstruct it from the captured layer data.'))
    }
  }
  return componentReport.sort((a,b) => b.count - a.count)
}
function libraryIssues(library:Partial<LibraryResult>, out:DiagnosticIssue[]) {
  for (const s of library?.warnings || []) {
    const isUnsupported = /unavailable in this Framer API|unavailable in this Framer SDK/i.test(s)
    out.push(inputIssue('library',isUnsupported?'info':'warning',isUnsupported?'SDK_FEATURE_UNAVAILABLE':'LIBRARY_EXPORT_FAILED',s,
      {page:'Shared library'},isUnsupported?'Framer API does not expose this method in this editor.':'Check the named library item and try exporting again.'))
  }
}
function assetIssues(assets:Partial<AssetResult>, out:DiagnosticIssue[]) {
  for (const a of assets?.manifest || []) {
    if (a.bundled) continue
    const external = /External or unsupported host/i.test(a.reason || '')
    out.push(inputIssue('assets',external?'info':'warning',external?'EXTERNAL_ASSET_REFERENCE':'ASSET_BUNDLE_FAILED',
      `${external?'External asset URL preserved':'Asset could not be bundled'}: ${a.url || '(unknown URL)'}${a.reason ? ' (' + a.reason + ')' : ''}`,
      {page:'Referenced assets',assetUrl:a.url,usedBy:a.usedBy || []},
      external?'The agent can use the preserved URL; consider downloading it separately.':'Inspect assets/manifest.json and retry the source file if needed.'))
  }
}
function normalizeIssue(issue:DiagnosticIssue):DiagnosticIssue {
  const {source, severity, code, message, fix, ...location} = issue
  return {source, severity, code, message, fix, ...location}
}
function groupIssues(issues:DiagnosticIssue[]) {
  const groups = new Map<string,Omit<DiagnosticGroup,"affectedPages"> & {affectedPages:Set<string>}>()
  for (const item of issues) {
    // Keep different root-cause messages separated for actual failures, but merge
    // repeated review notes by component or kind instead of layer ID.
    const specificity = item.code === 'COMPONENT_DEFINITION_NOT_EXPORTED' ? item.componentIdentifier :
      ['LIBRARY_EXPORT_FAILED','SDK_FEATURE_UNAVAILABLE','PAGE_EXPORT_FAILED','ASSET_BUNDLE_FAILED','EXTERNAL_ASSET_REFERENCE'].includes(item.code) ? item.message :
      ['NODE_READ_FAILED','CHILDREN_READ_FAILED'].includes(item.code) ? item.message.split(':').slice(-1)[0].trim() :
      item.code === 'GRADIENT_FIDELITY' ? item.nodeType : ['SVG_DATA_MISSING','VECTOR_PATH_UNAVAILABLE'].includes(item.code) ? item.code : ''
    const key = [item.severity,item.code,specificity || ''].join('|')
    let group = groups.get(key)
    if (!group) {
      group = {code:item.code, severity:item.severity, title:item.code.replaceAll('_',' ').toLowerCase(),
        message:item.message, fix:item.fix, count:0, affectedPages:new Set(), examples:[], locations:[]}
      groups.set(key,group)
    }
    group.count += item.affectedInstances?.length || 1
    if (item.page) group.affectedPages.add(item.page)
    if (item.affectedInstances) for (const instance of item.affectedInstances) {
      if(instance.page) group.affectedPages.add(instance.page)
      const loc = normalizeIssue({...item, ...instance, affectedInstances:undefined})
      group.locations.push(loc)
      if (group.examples.length < MAX_EXAMPLES) group.examples.push(loc)
    }
    else {
      const loc = normalizeIssue(item)
      group.locations.push(loc)
      if (group.examples.length < MAX_EXAMPLES) group.examples.push(loc)
    }
  }
  return [...groups.values()].map(g=>({...g, affectedPages:[...g.affectedPages]}))
    .sort((a,b)=>(severityRank[a.severity]??9)-(severityRank[b.severity]??9) || b.count-a.count || a.code.localeCompare(b.code))
}

export function buildDiagnosticsReport({snapshots=[], manifest={}, library={}, assets={}, selection=false}:DiagnosticOptions={}) {
  const issues:DiagnosticIssue[] = []
  const inventory = new Map<string,InventoryEntry>()
  for (const snapshot of snapshots) {
    const page = snapshot.pagePath || (selection?'Canvas selection':'/')
    for (const root of snapshot.roots || []) pushNodeIssues(root, page, issues, inventory)
    for (const entry of snapshot.diagnostics || []) issues.push({...entry,page:entry.page || page})
    for (const legacy of snapshot.warnings || []) pushLegacy(issues, legacy, 'canvas', page)
    if (snapshot.truncated) issues.push(inputIssue('canvas','error','EXPORT_TRUNCATED',
      `The export stopped at ${snapshot.nodeCount} nodes, so content may be missing.`,{page},
      'Increase the node cap or export smaller page sections.'))
  }
  const componentDefs:JsonObject[] = JSON.parse(String(library?.files?.['library/components.json'] || '[]'))
  const codeFiles:JsonObject[] = JSON.parse(String(library?.files?.['library/code-files.json'] || '[]'))
  const componentIds = new Set<string>(componentDefs.flatMap(c=>[c.id,c.name]).filter(Boolean))
  const components = finalizeInventory(inventory,componentIds,codeFiles,issues)
  libraryIssues(library, issues)
  assetIssues(assets,issues)
  for (const warning of manifest.warnings || []) {
    // Page warnings are collected from each snapshot; avoid counting twice.
    if (snapshots.some(s=>(s.warnings||[]).some(w=>warning.endsWith(w)))) continue
    pushLegacy(issues,warning,'project')
  }
  for (const failure of manifest.failures || []) {
    issues.push(inputIssue('pages','error','PAGE_EXPORT_FAILED',String(failure),{},
      'Re-export this page and inspect the Framer console if it fails again.'))
  }
  // A single underlying truncation should never count twice (legacy warning + snapshot flag).
  const exact = new Set()
  const deduplicated = issues.filter(x=>{
    const key = [x.code,x.message,x.page,x.nodeId].join('|')
    if (exact.has(key)) return false
    exact.add(key)
    return true
  })
  const groups = groupIssues(deduplicated)
  const count = (s:Severity)=>groups.filter(x=>x.severity===s).reduce((sum,x)=>sum+x.count,0)
  const groupsOf = (s:Severity)=>groups.filter(x=>x.severity===s).length
  const summary = {errors:count('error'),warnings:count('warning'),reviews:groupsOf('review'),reviewOccurrences:count('review'),info:groupsOf('info'),
    groups:groups.length, pages:snapshots.length, componentInstances:components.reduce((n,c)=>n+c.count,0),
    componentTypes:components.length}
  return {format:'framer-to-agent/diagnostics-v1',generatedAt:new Date().toISOString(),summary,
    groups,components,sourceLimitations:library.limitations || []}
}

export function diagnosticsMarkdown(report:ReturnType<typeof buildDiagnosticsReport>) {
  const s = report.summary
  const lines = [ '# Framer export diagnostics',
    '', `Actual errors: **${s.errors}** | Warnings: **${s.warnings}** | Review notes: **${s.reviews}**`,
    '', `${s.componentInstances} component instances inventoried across ${s.componentTypes} component types. Component instances are not automatically errors.`,
    '', 'Every group includes its underlying page/layer/ID so an agent can locate the source. Full locations and data are in `diagnostics.json`.',
    '']
  for (const g of report.groups) {
    lines.push(`## ${g.severity.toUpperCase()}: ${g.code} (${g.count} affected)`,'',g.message,'',`Fix: ${g.fix || 'Review the underlying data.'}`,'')
    for (const loc of g.examples) {
      lines.push(`- ${loc.page || '?'}${loc.layerPath ? ' / '+loc.layerPath : ''} [${loc.nodeId || loc.componentIdentifier || 'project'}]`)
    }
    if (g.count>g.examples.length) lines.push(`- Plus ${g.count-g.examples.length} more; see diagnostics.json.`)
    lines.push('')
  }
  if (!report.groups.length) lines.push('No diagnostic issues were detected. This does not prove pixel-perfect conversion.','')
  return lines.join('\n')
}
