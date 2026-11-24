import type {CompressionStats} from './capture-zip.ts'
import {captureUsedFonts,includeCapturedFonts} from './capture-fonts.ts'
import type {ArchiveFiles,AssetRecord,Folder,PageDescriptor,PageRecord,Snapshot,SDKClient,Manifest} from './types.ts'
import {errorMessage,textFile} from './types.ts'
interface ExportManifest extends Manifest {pages:PageRecord[];folder:string;warnings:string[];failures:string[];assets?:{referenced:number;bundled:number;bytes:number}}
import { framer } from '@framer/plugin'
import { captureSelection } from './exporter.ts'
import { discoverPages, buildPageTree, withinFolder, capturePage, packagePage } from './pages.ts'
import {exportProjectLibrary, collectAssetReferences, bundleAssets, appendLibraryInstructions} from './library.ts'
import {buildDiagnosticsReport, diagnosticsMarkdown} from './diagnostics.ts'
import {jsonSafe} from './exporter.ts'
import './main.css'

const $ = <T extends HTMLElement = HTMLElement>(id:string):T => {
  const element=document.getElementById(id)
  if(!element) throw new Error('Plugin UI element missing: '+id)
  return element as T
}
// The public SDK exposes different optional traits depending on the editor build.
const sdk = framer as unknown as SDKClient
const selectedText = $('selection')
const foldersEl = $('folders')
const refreshBtn = $<HTMLButtonElement>('refresh')
const exportBtn = $<HTMLButtonElement>('export')
const compressedEl = $<HTMLInputElement>('compressed')
const selectionBtn = $<HTMLButtonElement>('export-selection')
const copyBtn = $<HTMLButtonElement>('copy')
const status = $('status')
const warningsEl = $('warnings')
const diagnosticPanel = $('diagnostic-panel')
const diagnosticList = $('diagnostic-list')
const diagnosticSummary = $('diagnostic-summary')
const diagnosticFilter = $<HTMLSelectElement>('diagnostic-filter')
const copyReportBtn = $<HTMLButtonElement>('copy-report')
const scopeEl = $('scope')
const summaryEl = $('summary')
let allPages:PageDescriptor[] = []
let discoveredWarnings:string[] = []
let scope = '/'
let busy = false
let lastHandoff:string|null = null
let lastReport:ReturnType<typeof buildDiagnosticsReport>|null = null

function setStatus(message:string, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}
function slug(s:unknown) {
  return String(s || 'framer-design').replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'framer-design'
}
async function writeZip(files:ArchiveFiles, name:string) {
  setStatus('Encoding archive and benchmarking compression on the same capture...')
  const compressed=compressedEl.checked
  const {zip,stats}=await new Promise<{zip:Uint8Array;stats?:CompressionStats}>((resolve,reject)=>{
    const worker=new Worker(new URL('./archive-worker.ts',import.meta.url),{type:'module'})
    worker.onmessage=({data}:MessageEvent<{ok:boolean;zip?:Uint8Array;stats?:CompressionStats;error?:string}>)=>{
      worker.terminate()
      if(data.ok&&data.zip)resolve({zip:data.zip,stats:data.stats});else reject(Error(data.error||'Archive encoding failed'))
    }
    worker.onerror=e=>{worker.terminate();reject(Error(e.message||'Archive worker failed'))}
    worker.postMessage({files,compressed})
  })
  const blob = new Blob([new Uint8Array(zip)], {type:'application/zip'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = compressed ? name.slice(0,-4)+'-cjson.zip' : name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 20000)
  const size=(n:number)=>(n/1_000_000).toFixed(2)+' MB'
  const result=$('compression-result')
  result.hidden=false
  if(stats){
    const saved=100*(1-stats.cjsonZipBytes/stats.plainZipBytes)
    result.textContent='Same capture: JSON ZIP '+size(stats.plainZipBytes)+' → CJSON ZIP '+size(stats.cjsonZipBytes)+' ('+(saved>=0?saved.toFixed(1)+'% smaller':(-saved).toFixed(1)+'% larger')+'). '+(stats.elapsedMs/1000).toFixed(1)+'s encoding and benchmark.'
    return 'Downloaded CJSON ZIP. '
  }
  result.textContent='Plain JSON ZIP: '+size(zip.byteLength)
  return 'Downloaded ZIP. '
}

function showReport(report:ReturnType<typeof buildDiagnosticsReport>) {
  lastReport = report
  diagnosticPanel.hidden = false
  const s = report.summary
  diagnosticSummary.textContent = `${s.errors} errors · ${s.warnings} warnings · ${s.reviews} review notes · ${s.componentInstances} component instances inventoried`
  copyReportBtn.disabled = false
  const filter = diagnosticFilter.value
  diagnosticList.replaceChildren()
  const matching = report.groups.filter(g => filter === 'all' || g.severity === filter)
  if (!matching.length) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'No findings in this category.'
    diagnosticList.append(empty)
  }
  for (const group of matching) {
    const details = document.createElement('details')
    details.className = `diagnostic-item severity-${group.severity}`
    const summary = document.createElement('summary')
    summary.textContent = `${group.severity.toUpperCase()} · ${group.code.replaceAll('_', ' ')} (${group.count})`
    const desc = document.createElement('p')
    desc.textContent = group.message
    const fix = document.createElement('p')
    fix.className = 'hint'
    fix.textContent = 'Suggested action: ' + (group.fix || 'Inspect the affected layer.')
    details.append(summary,desc,fix)
    if (group.examples.length) {
      const examples = document.createElement('ul')
      for (const loc of group.examples) {
        const item = document.createElement('li')
        item.textContent = `${loc.page || 'Project'}${loc.layerPath ? ' / ' + loc.layerPath : ''} [${loc.nodeId || loc.componentIdentifier || 'project'}]`
        examples.append(item)
      }
      details.append(examples)
    }
    if (group.count > group.examples.length) {
      const plus = document.createElement('p')
      plus.className = 'hint'
      plus.textContent = `${group.count - group.examples.length} more locations are in diagnostics.json.`
      details.append(plus)
    }
    diagnosticList.append(details)
  }
}
function countPages(folder:Folder<PageDescriptor>):number {
  return folder.pages.length + folder.children.reduce((acc, child) => acc + countPages(child), 0)
}
function renderFolder(parent:HTMLElement, item:Folder<PageDescriptor>, depth = 0):void {
  const n = countPages(item)
  const folder = document.createElement('div')
  folder.className = 'folder-item'
  const row = document.createElement('div')
  row.className = 'tree-row' + (scope === item.path ? ' chosen' : '')
  row.style.paddingLeft = `${10 + depth * 14}px`
  const button = document.createElement('button')
  button.className = 'tree-button'
  button.type = 'button'
  const isRoot = item.path === '/'
  button.textContent = `${isRoot ? '◫' : '▸'}  ${isRoot ? 'Entire project' : item.name}`
  button.title = `Select ${item.path} (${n} pages)`
  button.addEventListener('click', () => selectScope(item.path))
  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = String(n)
  const quick = document.createElement('button')
  quick.className = 'quick-export'
  quick.textContent = '↧'
  quick.type = 'button'
  quick.title = `Export ${item.path} and all descendant pages`
  quick.setAttribute('aria-label', `Export folder ${item.path}`)
  quick.addEventListener('click', (e) => {e.stopPropagation(); selectScope(item.path); exportFolder(item.path)})
  row.append(button, count, quick)
  row.addEventListener('contextmenu', async e => {
    e.preventDefault()
    selectScope(item.path)
    if (typeof framer.showContextMenu === 'function') {
      try {
        await framer.showContextMenu([{label:`Export ${item.path === '/' ? 'entire project' : item.path} as design archive`, onAction:() => exportFolder(item.path)}], {
          location:{x:e.clientX, y:e.clientY}, placement:'bottom-left', width:230,
        })
      } catch { setStatus('Use the download arrow beside the folder to export.') }
    } else setStatus('Use the download arrow beside the folder to export.')
  })
  folder.appendChild(row)
  for (const sub of item.children) renderFolder(folder, sub, depth + 1)
  for (const page of item.pages) {
    const row = document.createElement('div')
    row.className = 'tree-row page-row' + (scope === page.path ? ' chosen' : '')
    row.style.paddingLeft = `${24 + depth * 14}px`
    const b = document.createElement('button')
    b.className = 'tree-button'
    b.textContent = `${page.type === 'design' ? '◇' : '▤'}  ${page.path === '/' ? 'Home /' : page.path.split('/').at(-1)}`
    b.title = page.path
    b.addEventListener('click', () => selectScope(page.path))
    const quick = document.createElement('button')
    quick.type = 'button'
    quick.className = 'quick-export'
    quick.textContent = '↧'
    quick.title = `Export page ${page.path}`
    quick.setAttribute('aria-label', `Export page ${page.path}`)
    quick.addEventListener('click', e => {e.stopPropagation(); selectScope(page.path); exportFolder(page.path, [page])})
    row.append(b, quick)
    row.addEventListener('contextmenu', async e => {
      e.preventDefault()
      selectScope(page.path)
      if (typeof framer.showContextMenu === 'function') {
        try {
          await framer.showContextMenu([{label:'Export page as design archive', onAction:() => exportFolder(page.path, [page])}], {
            location:{x:e.clientX, y:e.clientY}, placement:'bottom-left', width:200,
          })
        } catch { setStatus('Use the download arrow to export this page.') }
      }
    })
    folder.appendChild(row)
  }
  parent.appendChild(folder)
}
function selectScope(path:string) {
  scope = path
  const pages = allPages.filter(p => withinFolder(p.path, scope))
  scopeEl.textContent = scope === '/' ? 'Entire project' : scope
  summaryEl.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} included, with nested paths and breakpoints.`
  exportBtn.disabled = busy || pages.length === 0
  renderTree()
}
function renderTree() {
  foldersEl.replaceChildren()
  const root = buildPageTree(allPages)
  renderFolder(foldersEl, root)
}
async function scanPages() {
  if (busy) return
  busy = true
  refreshBtn.disabled = exportBtn.disabled = true
  setStatus('Scanning Framer pages...')
  try {
    const result = await discoverPages(sdk)
    allPages = result.pages
    discoveredWarnings = result.warnings
    if (allPages.length === 0) {
      scopeEl.textContent = 'No pages available'
      summaryEl.textContent = 'Check editor permissions and page API access.'
      foldersEl.replaceChildren()
    } else selectScope(scope)
    setStatus(`Found ${allPages.length} page${allPages.length === 1 ? '' : 's'}. Click a folder to select, or its arrow to export.`)
    if (discoveredWarnings.length) {
      warningsEl.hidden = false
      warningsEl.textContent = discoveredWarnings.join('\n')
    }
  } catch (err) {
    setStatus(errorMessage(err), true)
    foldersEl.textContent = 'Could not enumerate project pages.'
  } finally {
    busy = false
    refreshBtn.disabled = false
    exportBtn.disabled = !allPages.some(p => withinFolder(p.path, scope))
    await refreshSelection()
  }
}
async function refreshSelection() {
  try {
    const items = await framer.getSelection()
    selectedText.textContent = items.length ? items.map(n => ("name" in n ? n.name : undefined) || n.id).join(', ') : 'Nothing selected'
    selectionBtn.disabled = busy || !items.length
  } catch {
    selectedText.textContent = 'Unavailable'
    selectionBtn.disabled = true
  }
}
async function exportFolder(path:string, explicitPages:PageDescriptor[]|null = null) {
  if (busy) return
  const list = explicitPages || allPages.filter(p => withinFolder(p.path, path))
  if (!list.length) return setStatus('This folder has no discoverable pages.', true)
  busy = true
  refreshBtn.disabled = exportBtn.disabled = selectionBtn.disabled = copyBtn.disabled = true
  warningsEl.hidden = true
  diagnosticPanel.hidden = true
  const rawOnly = true
  const manifest:ExportManifest = {captureAdapter:'framer-public-plugin-api',format:'framer-to-agent/folder-export-v6',captureOnly:rawOnly,requestedPages:list.length, folder:path, exportedAt:new Date().toISOString(),
    pages:[], warnings:[...discoveredWarnings], failures:[]}
  const files:ArchiveFiles = {}
  const usedPaths = new Set()
  const capturedSnapshots:Snapshot[] = []
  try {
    // Official read-only publish metadata identifies the selected source revision.
    for (const [key,method] of [['project','getProjectInfo'],['publish','getPublishInfo']]) {
      try { if(typeof sdk[method]==='function')manifest[key]=jsonSafe(await sdk[method]()) }
      catch(e){manifest.warnings.push(method+' unavailable: '+errorMessage(e))}
    }
    for (const [i,page] of list.entries()) {
      setStatus(`Hydrating and reading ${i + 1}/${list.length}: ${page.path} (canvas may jump)...`)
      // Yield so the plugin UI gets a chance to render progress for larger exports.
      await new Promise(resolve => setTimeout(resolve, 0))
      try {
        const snapshot = await capturePage(page)
        const item = packagePage(page, snapshot, {rawOnly})
        if (usedPaths.has(item.record.directory)) {
          const msg = `Duplicate export directory for ${page.path}; page ${page.id} skipped to prevent overwriting.`
          manifest.failures.push(msg)
          continue
        }
        usedPaths.add(item.record.directory)
        capturedSnapshots.push(snapshot)
        Object.assign(files, item.files)
        manifest.pages.push(item.record)
      } catch (err) {
        manifest.failures.push(`${page.path}: ${errorMessage(err)}`)
      }
    }
    if (!manifest.pages.length) throw new Error('No pages could be read. Check plugin permissions and the Framer console.')
    for (const p of manifest.pages) manifest.warnings.push(...(p.warnings??[]).map(w => `${p.path}: ${w}`))
    if (manifest.failures.length) manifest.warnings.push(...manifest.failures)
    setStatus('Reading shared components, saved styles, code files, and CMS schema...')
    const library = await exportProjectLibrary(sdk,{rawOnly})
    Object.assign(files, library.files)
    files['library/capture-capabilities.json']=JSON.stringify({adapter:'framer-public-plugin-api',layoutTemplates:'not exposed by installed public Plugin API',overlayTriggers:'not guaranteed by installed public Plugin API',vectorPathGeometry:'only when exposed on SDK node or SVG method',fontVariants:'used exact variants, missing sources reported'},null,2)
    setStatus('Collecting referenced images and SVG assets...')
    const snapshots=[...capturedSnapshots,...library.componentSnapshots]
    const fonts=await captureUsedFonts(sdk,snapshots,library.warnings)
    files['library/fonts.json']=JSON.stringify(fonts,null,2)
    const assets=await bundleAssets(includeCapturedFonts(collectAssetReferences(snapshots),fonts))
    Object.assign(files, assets.files)
    manifest.library = library.summary
    manifest.assets = {referenced:assets.manifest.length,bundled:assets.manifest.filter(x => x.bundled).length,bytes:assets.totalBytes}
    manifest.limitations = library.limitations
    manifest.warnings.push(...library.warnings, ...assets.warnings)
    const report = buildDiagnosticsReport({snapshots:capturedSnapshots,library,assets,
      manifest:{warnings:discoveredWarnings,failures:manifest.failures}})
    manifest.diagnostics = report.summary
    files['diagnostics.json'] = JSON.stringify(report, null, 2)
    files['diagnostics.md'] = diagnosticsMarkdown(report)
    files['manifest.json'] = JSON.stringify(manifest, null, 2)
    files['AGENT.md'] = '# Raw Framer design archive\n\nCompile the immutable ZIP with the standalone React compiler. The capture contains no generated React.\n'
    files['README.md'] = '# Framer design archive v6\n\nContains source JSON (or design.cjson and design.cjsonref), original code and assets. See diagnostics.md for any unavailable source fields. Compile the ZIP with framer-to-react compile.\n'
    const saved = await writeZip(files, `framer-${slug(path === '/' ? 'entire-project' : path)}-${rawOnly?'design':'react'}.zip`)
    lastHandoff = textFile(files,'AGENT.md')
    copyBtn.disabled = false
    setStatus(saved + `Exported ${manifest.pages.length}/${list.length} pages and ${manifest.assets.bundled}/${manifest.assets.referenced} assets. ${report.summary.errors} actual errors and ${report.summary.warnings} warnings. Open diagnostics below.`)
    showReport(report)
  } catch (err) {
    setStatus(errorMessage(err), true)
  } finally {
    busy = false
    refreshBtn.disabled = false
    exportBtn.disabled = !allPages.length
    await refreshSelection()
  }
}
async function exportSelection() {
  if (busy) return
  busy = true
  selectionBtn.disabled = exportBtn.disabled = true
  warningsEl.hidden = true
  diagnosticPanel.hidden = true
  try {
    const snapshot = await captureSelection(sdk, 4000)
    const rawOnly = true
    const bundle = {componentName:'selection',json:JSON.stringify(snapshot,null,2),agent:'# Raw selection archive\nCompile with the standalone React compiler.'}
    setStatus('Reading reusable components and styles...')
    const library = await exportProjectLibrary(sdk,{rawOnly})
    const snapshots=[snapshot,...library.componentSnapshots]
    const fonts=await captureUsedFonts(sdk,snapshots,library.warnings)
    library.files['library/fonts.json']=JSON.stringify(fonts,null,2)
    const assets=await bundleAssets(includeCapturedFonts(collectAssetReferences(snapshots),fonts))
    const report = buildDiagnosticsReport({snapshots:[snapshot],library,assets,selection:true})
    const handoff = bundle.agent + '\nConsult diagnostics.md and diagnostics.json for actual issues and component inventory.\n' + appendLibraryInstructions(library, assets)
    lastHandoff = handoff
    const selectionFiles:ArchiveFiles = {
      'design.json':bundle.json,
      'AGENT.md':handoff,
      'README.md':'# Selection export\n\nRun: `cd preview && npm install && npm run dev`\n\nSee AGENT.md and diagnostics.md for limitations.\n',
      ...library.files,
      ...assets.files,
      'diagnostics.json':JSON.stringify(report,null,2),
      'diagnostics.md':diagnosticsMarkdown(report),
      'manifest.json':JSON.stringify({format:'framer-to-agent/selection-export-v6',captureAdapter:'framer-public-plugin-api',captureOnly:rawOnly,pages:[{path:'/',directory:'',breakpoints:[]}],nodeCount:snapshot.nodeCount,library:library.summary,assets:{referenced:assets.manifest.length,bundled:assets.manifest.filter(x=>x.bundled).length},diagnostics:report.summary,limitations:library.limitations},null,2),
    }
    selectionFiles['README.md'] = '# Raw design selection\n\nCompile this immutable archive independently.\n'
    const saved = await writeZip(selectionFiles, `framer-${slug(bundle.componentName)}.zip`)
    copyBtn.disabled = false
    setStatus(saved + `Exported ${snapshot.nodeCount} layers and ${assets.manifest.filter(x=>x.bundled).length} bundled assets. ${report.summary.errors} errors, ${report.summary.warnings} warnings.`)
    showReport(report)
  } catch (err) {
    setStatus(errorMessage(err), true)
  } finally {
    busy = false
    exportBtn.disabled = !allPages.length
    await refreshSelection()
  }
}
diagnosticFilter.addEventListener('change', () => {if (lastReport) showReport(lastReport)})
copyReportBtn.addEventListener('click', async () => {
  if (!lastReport) return
  try {
    await navigator.clipboard.writeText(diagnosticsMarkdown(lastReport))
    setStatus('Diagnostic report copied. The ZIP contains full per-layer JSON.')
  } catch {setStatus('Clipboard denied. Use diagnostics.md inside your ZIP.',true)}
})
refreshBtn.addEventListener('click', scanPages)
exportBtn.addEventListener('click', () => exportFolder(scope))
selectionBtn.addEventListener('click', exportSelection)
copyBtn.addEventListener('click', async () => {
  if (!lastHandoff) return
  try {
    await navigator.clipboard.writeText(lastHandoff)
    setStatus('AGENT.md instructions copied.')
  } catch {
    setStatus('Clipboard denied. Use AGENT.md inside your ZIP.', true)
  }
})

framer.showUI({position:'center', width:490, height:630}).then(() => {
  scanPages()
  refreshSelection()
  framer.subscribeToSelection(refreshSelection)
}).catch(err => setStatus(errorMessage(err), true))
