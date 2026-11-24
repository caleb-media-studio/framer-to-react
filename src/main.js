import { framer } from '@framer/plugin'
import { zipSync, strToU8 } from 'fflate'
import { captureSelection } from './exporter.mjs'
import { generateBundle } from './generator.mjs'
import { discoverPages, buildPageTree, withinFolder, capturePage, packagePage, projectHandoff } from './pages.mjs'
import {exportProjectLibrary, collectAssetReferences, bundleAssets, appendLibraryInstructions} from './library.mjs'
import {buildDiagnosticsReport, diagnosticsMarkdown} from './diagnostics.mjs'
import {compileReactArchive} from './react-compiler.mjs'
import {jsonSafe} from './exporter.mjs'
import {hydrateArchiveCodeComponents} from './archive-hydration.mjs'
import './main.css'

const $ = (id) => document.getElementById(id)
const selectedText = $('selection')
const foldersEl = $('folders')
const refreshBtn = $('refresh')
const exportBtn = $('export')
const rawOnlyEl = $('raw-only')
const selectionBtn = $('export-selection')
const copyBtn = $('copy')
const status = $('status')
const warningsEl = $('warnings')
const diagnosticPanel = $('diagnostic-panel')
const diagnosticList = $('diagnostic-list')
const diagnosticSummary = $('diagnostic-summary')
const diagnosticFilter = $('diagnostic-filter')
const copyReportBtn = $('copy-report')
const scopeEl = $('scope')
const summaryEl = $('summary')
let allPages = []
let discoveredWarnings = []
let scope = '/'
let busy = false
let lastHandoff = null
let lastSelectionBundle = null
let lastReport = null

function setStatus(message, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}
function slug(s) {
  return String(s || 'framer-design').replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'framer-design'
}
async function writeZip(files, name) {
  const zipEntries = {}
  for (const [path, content] of Object.entries(files)) zipEntries[path] = content instanceof Uint8Array ? content : strToU8(content)
  const zip = zipSync(zipEntries, {level: 6})
  const blob = new Blob([zip], {type:'application/zip'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 20000)
  return 'Downloaded ZIP. '
}

function showReport(report) {
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
function relinkDownloadedAssets(files, records) {
  const mapping = (records || []).filter(item => item.bundled && item.url && item.path)
  for (const [path, content] of Object.entries(files)) {
    if (!/(?:^pages\/|^library\/components\/|^preview\/src\/|^Component\.tsx$)/.test(path) || !/\.(tsx|css)$/.test(path) || typeof content !== 'string') continue
    let next = content
    for (const record of mapping) next = next.replaceAll(record.url, '/' + record.path)
    files[path] = next
  }
}
function countPages(folder) {
  return folder.pages.length + folder.children.reduce((acc, child) => acc + countPages(child), 0)
}
function renderFolder(parent, item, depth = 0) {
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
        await framer.showContextMenu([{label:`Export ${item.path === '/' ? 'entire project' : item.path} as React`, onAction:() => exportFolder(item.path)}], {
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
          await framer.showContextMenu([{label:'Export page as React', onAction:() => exportFolder(page.path, [page])}], {
            location:{x:e.clientX, y:e.clientY}, placement:'bottom-left', width:200,
          })
        } catch { setStatus('Use the download arrow to export this page.') }
      }
    })
    folder.appendChild(row)
  }
  parent.appendChild(folder)
}
function selectScope(path) {
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
    const result = await discoverPages(framer)
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
    setStatus(err.message || String(err), true)
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
    selectedText.textContent = items.length ? items.map(n => n.name || n.id).join(', ') : 'Nothing selected'
    selectionBtn.disabled = busy || !items.length
  } catch {
    selectedText.textContent = 'Unavailable'
    selectionBtn.disabled = true
  }
}
async function exportFolder(path, explicitPages = null) {
  if (busy) return
  const list = explicitPages || allPages.filter(p => withinFolder(p.path, path))
  if (!list.length) return setStatus('This folder has no discoverable pages.', true)
  busy = true
  refreshBtn.disabled = exportBtn.disabled = selectionBtn.disabled = copyBtn.disabled = true
  warningsEl.hidden = true
  diagnosticPanel.hidden = true
  const rawOnly = rawOnlyEl.checked
  const manifest = {format:'framer-to-agent/folder-export-v5',captureOnly:rawOnly,requestedPages:list.length, folder:path, exportedAt:new Date().toISOString(),
    pages:[], warnings:[...discoveredWarnings], failures:[]}
  const files = {}
  const usedPaths = new Set()
  const capturedSnapshots = []
  try {
    // Official read-only publish metadata identifies the selected source revision.
    for (const [key,method] of [['project','getProjectInfo'],['publish','getPublishInfo']]) {
      try { if(typeof framer[method]==='function')manifest[key]=jsonSafe(await framer[method]()) }
      catch(e){manifest.warnings.push(method+' unavailable: '+String(e?.message||e))}
    }
    for (const [i,page] of list.entries()) {
      setStatus(`Reading ${i + 1}/${list.length}: ${page.path}...`)
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
        manifest.failures.push(`${page.path}: ${String(err?.message || err)}`)
      }
    }
    if (!manifest.pages.length) throw new Error('No pages could be read. Check plugin permissions and the Framer console.')
    for (const p of manifest.pages) manifest.warnings.push(...p.warnings.map(w => `${p.path}: ${w}`))
    if (manifest.failures.length) manifest.warnings.push(...manifest.failures)
    setStatus('Reading shared components, saved styles, code files, and CMS schema...')
    const library = await exportProjectLibrary(framer,{rawOnly})
    Object.assign(files, library.files)
    if (!rawOnly) hydrateArchiveCodeComponents(manifest.pages, files)
    setStatus('Collecting referenced images and SVG assets...')
    const assets = await bundleAssets(collectAssetReferences([...capturedSnapshots, ...library.componentSnapshots]))
    Object.assign(files, assets.files)
    relinkDownloadedAssets(files, assets.manifest)
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
    if (!rawOnly) {
      Object.assign(files, compileReactArchive(files).files)
      relinkDownloadedAssets(files, assets.manifest)
    }
    files['AGENT.md'] = projectHandoff(manifest) + '\nRead diagnostics.md for actual failures and grouped review notes. Full per-layer data is in diagnostics.json.\n' + appendLibraryInstructions(library, assets)
    files['README.md'] = `# Framer to React folder export\n\nFolder: ${path}\nExported pages: ${manifest.pages.length} of ${list.length}\n\n**Run immediately:** cd preview && npm install && npm run dev and open Vite's localhost URL.\n\nRead AGENT.md and manifest.json. Each route is under pages/ with TSX, CSS, design.json, and breakpoint variants. Shared components, code files, styles and CMS schema are under library/. Referenced images and SVGs are under assets/ where Framer allows local download.\nThis is Framer Plugin API data, not its private source format.\n`
    if (rawOnly) {
      files['AGENT.md'] = '# Raw Framer design archive\n\nCompile this immutable archive with the standalone React compiler. Read manifest.json and diagnostics.json for capture coverage and API limitations.\n'
      files['README.md'] = '# Framer design archive\n\nContains raw design.json trees, component definitions, original code files, styles, assets and capture diagnostics. No generated React or preview. Compile using scripts/compile-react.mjs in Framer to React.\n'
    }
    const saved = await writeZip(files, `framer-${slug(path === '/' ? 'entire-project' : path)}-${rawOnly?'design':'react'}.zip`)
    lastHandoff = files['AGENT.md']
    copyBtn.disabled = false
    setStatus(saved + `Exported ${manifest.pages.length}/${list.length} pages and ${manifest.assets.bundled}/${manifest.assets.referenced} assets. ${report.summary.errors} actual errors and ${report.summary.warnings} warnings. Open diagnostics below.`)
    showReport(report)
  } catch (err) {
    setStatus(err.message || String(err), true)
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
    const snapshot = await captureSelection(framer, 4000)
    const rawOnly = rawOnlyEl.checked
    const bundle = rawOnly ? {componentName:"selection",json:JSON.stringify(snapshot,null,2),agent:"# Raw selection archive\nCompile design.json with the React compiler."} : generateBundle(snapshot)
    lastSelectionBundle = bundle
    setStatus('Reading reusable components and styles...')
    const library = await exportProjectLibrary(framer,{rawOnly})
    const assets = await bundleAssets(collectAssetReferences([snapshot, ...library.componentSnapshots]))
    const report = buildDiagnosticsReport({snapshots:[snapshot],library,assets,selection:true})
    const handoff = bundle.agent + '\nConsult diagnostics.md and diagnostics.json for actual issues and component inventory.\n' + appendLibraryInstructions(library, assets)
    lastHandoff = handoff
    const selectionFiles = {
      ...(!rawOnly?{'Component.tsx':bundle.tsx,'component.css':bundle.css}:{}),
      'design.json':bundle.json,
      'AGENT.md':handoff,
      'README.md':'# Selection export\n\nRun: `cd preview && npm install && npm run dev`\n\nSee AGENT.md and diagnostics.md for limitations.\n',
      ...library.files,
      ...assets.files,
      'diagnostics.json':JSON.stringify(report,null,2),
      'diagnostics.md':diagnosticsMarkdown(report),
      'manifest.json':JSON.stringify({format:'framer-to-agent/selection-export-v5',captureOnly:rawOnly,pages:[{path:'/',directory:'',breakpoints:[]}],nodeCount:snapshot.nodeCount,library:library.summary,assets:{referenced:assets.manifest.length,bundled:assets.manifest.filter(x=>x.bundled).length},diagnostics:report.summary,limitations:library.limitations},null,2),
    }
    if (!rawOnly) {
      hydrateArchiveCodeComponents([{directory:'',breakpoints:[]}], selectionFiles)
      relinkDownloadedAssets(selectionFiles, assets.manifest)
      Object.assign(selectionFiles, compileReactArchive(selectionFiles).files)
      relinkDownloadedAssets(selectionFiles, assets.manifest)
    } else selectionFiles['README.md'] = '# Raw design selection\n\nCompile this archive independently. No React draft is included.\n'
    const saved = await writeZip(selectionFiles, `framer-${slug(bundle.componentName)}.zip`)
    copyBtn.disabled = false
    setStatus(saved + `Exported ${snapshot.nodeCount} layers and ${assets.manifest.filter(x=>x.bundled).length} bundled assets. ${report.summary.errors} errors, ${report.summary.warnings} warnings.`)
    showReport(report)
  } catch (err) {
    setStatus(err.message || String(err), true)
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
}).catch(err => setStatus(err.message || String(err), true))
