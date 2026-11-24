import type {Manifest,PageRecord,DesignNode,Evidence,CaptureDiagnostics} from '../src/types.ts'
// Opt-in post-export enrichment. Input: an extracted plugin export (unchanged) and a directory of published-site evidence
// files (written by the evidence collector). Output: a NEW export directory whose generated Component.tsx/component.css
// and preview use high-confidence reference values. Raw design.json files are copied byte-for-byte; provenance for every
// applied field is in reference/overlay.json, the evidence itself in reference/evidence/.
// Usage: node scripts/enrich-export.ts <exportDir> <evidenceDir> <outDir>
import fs from 'node:fs'
import path from 'node:path'
import {generateBundle} from '../src/generator.ts'
import {buildOverlay, applyOverlay} from '../src/enrichment.ts'
import {generatePreviewFiles} from '../src/preview.ts'
import {serializeReferenceVector} from '../src/reference-vector.ts'
import {svgPath} from '../src/vectors.ts'

const [exportDir, evidenceDir, outDir] = process.argv.slice(2)
if (!exportDir || !evidenceDir || !outDir) { console.error('Usage: node scripts/enrich-export.ts <exportDir> <evidenceDir> <outDir>'); process.exit(2) }
const manifestPath = path.join(exportDir, 'manifest.json')
if (!fs.existsSync(manifestPath)) { console.error(`No manifest.json in ${exportDir}; pass the extracted export root.`); process.exit(2) }
if (path.resolve(outDir) === path.resolve(exportDir)) { console.error('outDir must differ from exportDir; the raw export is never modified.'); process.exit(2) }
const manifest=JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest & {pages:PageRecord[]}

fs.cpSync(exportDir, outDir, {recursive: true, filter: src => path.relative(exportDir, src) !== 'preview'})

const routeFile = (route:string) => (route === '/' ? '_index' : route.replace(/^\//, '').replace(/\//g, '_'))
const docs:(Evidence & {file:string})[] = [], editorNodes = new Map<string,DesignNode>(), nodeBreakpoint = new Map<string,string>(), skipped:{file:string;reason:string}[] = []
const walk = (n:DesignNode, fn:(node:DesignNode)=>void):void => { fn(n); for (const c of n.children || []) walk(c, fn) }
for (const page of manifest.pages) {
  const design = JSON.parse(fs.readFileSync(path.join(exportDir, page.directory, 'design.json'), 'utf8'))
  for (const r of design.roots || []) walk(r, n => editorNodes.set(n.id, n))
  // Ownership comes from each breakpoint snapshot, so evidence can only touch layers of the breakpoint it was measured on.
  for (const bp of page.breakpoints || []) {
    const bpDesign = JSON.parse(fs.readFileSync(path.join(exportDir, bp.directory, 'design.json'), 'utf8'))
    for (const r of bpDesign.roots || []) walk(r, n => nodeBreakpoint.set(n.id, bp.id))
  }
  for (const f of fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : []) {
    const m = f.match(/^(.+)\.(\d+)\.json$/)
    if (!m || m[1] !== routeFile(page.path)) continue
    const doc = JSON.parse(fs.readFileSync(path.join(evidenceDir, f), 'utf8'))
    if (doc.provenance?.viewport?.width !== Number(m[2])) { skipped.push({file: f, reason: 'filename width differs from provenance viewport'}); continue }
    docs.push({route: page.path, file: f, doc})
  }
}
const overlay = buildOverlay(docs, editorNodes, nodeBreakpoint)
overlay.skippedEvidence = skipped
fs.mkdirSync(path.join(outDir, 'reference/evidence'), {recursive: true})
for (const {file, doc} of docs) fs.writeFileSync(path.join(outDir, 'reference/evidence', file), JSON.stringify(doc, null, 2))
fs.writeFileSync(path.join(outDir, 'reference/overlay.json'), JSON.stringify(overlay, null, 2))
const fidelity = ['# Reference enrichment', '',
  'Values below came from the published site, not the Framer editor. Only `high` confidence layer matches were applied, only to fields the editor capture lacked. Medium/low matches and unmatched layers are NOT applied and remain unverified.', '',
  '| route | width | status | high | medium | low | applied layers | applied fields | unmatched export | unmatched live | foreign-breakpoint skipped |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...overlay.coverage.map(r => `| ${r.route} | ${r.width} | ${r.status} | ${r.high} | ${r.medium} | ${r.low} | ${r.applied} | ${r.appliedFields} | ${r.unmatchedArchive} | ${r.unmatchedLive} | ${r.foreignNode} |`),
  '', `Conflicts (editor value kept): ${overlay.conflicts.length}`,
  ...overlay.conflicts.slice(0, 200).map(c => `- ${c.route} @${c.width} ${c.nodeId} ${c.field}: editor ${JSON.stringify(c.editor)} vs reference ${JSON.stringify(c.reference)} (kept ${c.kept})`),
  '', `Evidence files skipped: ${skipped.length}`, ...skipped.map(x => `- ${x.file}: ${x.reason}`),
  '', `Routes in export without evidence: ${manifest.pages.filter(p => !docs.some(d => d.route === p.path)).map(p => p.path).join(', ') || 'none'}`, '']
fs.writeFileSync(path.join(outDir, 'reference/FIDELITY.md'), fidelity.join('\n'))

// Materialize only validated reference geometry, as local standalone SVG files.
let referenceVectors=0
for(const node of Object.values(overlay.nodes)){
  const svg=serializeReferenceVector(node.vector)
  if(!svg)continue
  const destination=path.join(outDir,svgPath(svg))
  fs.mkdirSync(path.dirname(destination),{recursive:true})
  fs.writeFileSync(destination,svg)
  referenceVectors++
}
// Regenerate drafts from the raw snapshot + overlay. design.json is not rewritten.
let regenerated = 0
for (const page of manifest.pages) {
  const dirs = (page.breakpoints || []).map(b => b.directory)
  const primary = (page.breakpoints || []).find(b => b.primary)?.directory || dirs[0]
  for (const dir of dirs) {
    const design = JSON.parse(fs.readFileSync(path.join(exportDir, dir, 'design.json'), 'utf8'))
    const bundle = generateBundle(applyOverlay(design, overlay))
    fs.writeFileSync(path.join(outDir, dir, 'Component.tsx'), bundle.tsx)
    fs.writeFileSync(path.join(outDir, dir, 'component.css'), bundle.css)
    if (dir === primary) {
      fs.writeFileSync(path.join(outDir, page.directory, 'Component.tsx'), bundle.tsx)
      fs.writeFileSync(path.join(outDir, page.directory, 'component.css'), bundle.css)
    }
    regenerated++
  }
}

const files:Record<string,string> = {}
const textFile = /\.(json|tsx?|css|md|svg|txt|mjs|js)$/
const read = (dir:string):void => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
  const p = path.join(dir, e.name), rel = path.relative(outDir, p).split(path.sep).join('/')
  if (e.isDirectory()) { if (rel !== 'preview' && rel !== 'reference/evidence') read(p) } else if (textFile.test(e.name)) files[rel] = fs.readFileSync(p, 'utf8')
} }
read(outDir)
let diagnostics:CaptureDiagnostics|null = null
try { diagnostics = JSON.parse(files['diagnostics.json']) } catch {}
const preview = generatePreviewFiles(manifest.pages, files, {title: manifest.projectName || 'Framer export', diagnostics})
for (const [rel, content] of Object.entries(preview)) {
  const p = path.join(outDir, rel); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, content)
}
const assets = path.join(outDir, 'assets')
if (fs.existsSync(assets)) fs.cpSync(assets, path.join(outDir, 'preview/public/assets'), {recursive: true})

const sum = (k:string) => overlay.coverage.reduce((n, r) => n + Number(r[k] || 0), 0)
console.log(JSON.stringify({evidenceFiles: docs.length, appliedNodes: Object.keys(overlay.nodes).length, appliedFields: sum('appliedFields'),
  high: sum('high'), medium: sum('medium'), low: sum('low'), conflicts: overlay.conflicts.length, foreignNode: sum('foreignNode'), skippedEvidence: skipped.length, regenerated, referenceVectors}))
