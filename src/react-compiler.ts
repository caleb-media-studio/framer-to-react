import {generatePreviewFiles} from './preview.ts'
import {serializeReferenceVector} from './reference-vector.ts'
import {svgPath} from './vectors.ts'
import {buildOverlay} from './enrichment.ts'

import type {ArchiveFiles,DesignNode,Snapshot,Manifest,Issue,Evidence,LayoutSource,CaptureDiagnostics} from './types.ts'
export type {ArchiveFiles,DesignNode,Snapshot,Breakpoint,PageRecord,Manifest,Issue,ReferenceDocument,Evidence,LayoutSource} from './types.ts'
export interface CompileOptions {evidence?:Evidence[];layoutSource?:LayoutSource|null}
interface AssetRecord {url?:string;path?:string;bundled?:boolean}
interface AssetManifest {assets?:AssetRecord[]}
interface GeneratedPackage {scripts:Record<string,string>;[key:string]:unknown}

const safePath = (p:unknown):p is string => typeof p==='string' && p.length<=2048 && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s=>s && s!=='.' && s!=='..' && !/[\x00-\x1f]/.test(s))
const prefix = (dir:string) => dir ? dir+'/' : ''
const parse = <T>(files:ArchiveFiles,key:string):T => { const content=files[key]; if(typeof content!=='string')throw Error('Missing '+key);return JSON.parse(content) as T }
const walk = (node:DesignNode,fn:(n:DesignNode)=>void):void => {fn(node);for(const c of node.children||[])walk(c,fn)}

/** Pure archive -> React compiler. No Framer SDK, network or editor dependency. */
export function compileReactArchive(rawFiles:ArchiveFiles,{evidence=[],layoutSource=null}:CompileOptions={}){
 const manifest=parse<Manifest>(rawFiles,'manifest.json')
 if(!/^framer-to-agent\/(folder|selection)-export-v[1-9]\d*$/.test(manifest.format||''))throw Error('Unsupported capture archive format')
 const pages=manifest.pages || (manifest.format.includes('selection')?[{path:'/',directory:'',breakpoints:[]}]:[])
 if(!Array.isArray(pages)||!pages.length)throw Error('No captured pages')
 const source:ArchiveFiles={};const issues:Issue[]=[];const nodeBreakpoint=new Map<string,string>(),editorNodes=new Map<string,DesignNode>(),routes=new Set<string>(),dirs=new Set<string>()
 let snapshots=0,variants=0
 // Copy only source inputs; never trust generated page drafts or a pre-existing preview.
 for(const [p,v] of Object.entries(rawFiles)){
  if(!safePath(p))throw Error('Unsafe archive member: '+p)
  if(p==='manifest.json'||p==='diagnostics.json'||p==='design.json'||/^pages\/.+\/design\.json$/.test(p)||p.startsWith('assets/')||p.startsWith('library/')&&!/\/components\/.*\/(Component\.tsx|component\.css|AGENT\.md)$/.test(p))source[p]=v
 }
 for(const page of pages){
  if(typeof page.path!=='string'||!page.path.startsWith('/')||routes.has(page.path))throw Error('Invalid or duplicate route '+page.path)
  routes.add(page.path)
  if(page.directory!==''&&!safePath(page.directory)||dirs.has(page.directory))throw Error('Invalid or duplicate page directory '+page.directory)
  dirs.add(page.directory)
  const root=parse<Snapshot>(source,prefix(page.directory)+'design.json');if(!Array.isArray(root.roots)||!root.roots.length)throw Error('Empty page snapshot '+page.path)
  snapshots++;for(const n of root.roots)walk(n,x=>editorNodes.set(x.id,x))
  if(page.truncated||root.truncated)issues.push({stage:'capture',severity:'error',route:page.path,message:'Page capture truncated'})
  const bps=page.breakpoints||[]
  for(const bp of bps){
   if(!safePath(bp.directory)||!bp.directory.startsWith(prefix(page.directory)+'breakpoints/')||dirs.has(bp.directory))throw Error('Invalid or duplicate breakpoint directory '+bp.directory)
   dirs.add(bp.directory);const d=parse<Snapshot>(source,bp.directory+'/design.json')
   if(!Array.isArray(d.roots)||!d.roots.length||d.roots[0].id!==bp.id)throw Error('Breakpoint identity mismatch '+bp.directory)
   snapshots++;for(const n of d.roots)walk(n,x=>{nodeBreakpoint.set(x.id,bp.id);editorNodes.set(x.id,x)})
  }
  variants+=bps.length||1
 }
 for(const failure of manifest.failures||[])issues.push({stage:'capture',severity:'error',message:String(failure)})
 if((manifest.requestedPages??pages.length)>pages.length)issues.push({stage:'capture',severity:'error',message:'Requested page coverage incomplete'})
 const validEvidence=evidence.filter(e=>routes.has(e.route)&&pages.find(p=>p.path===e.route)?.breakpoints?.some(b=>b.id===e.doc?.breakpointId&&parseFloat(String(b.width??''))===e.doc?.provenance?.viewport?.width))
 const overlay=buildOverlay(validEvidence,editorNodes,nodeBreakpoint)
 for(const n of Object.values(overlay.nodes)){
  const svg=serializeReferenceVector(n.vector);if(svg)source[svgPath(svg)]=svg
 }
 source['reference/overlay.json']=JSON.stringify(overlay,null,2)
 let diagnostics:CaptureDiagnostics|null=null;try{diagnostics=parse<CaptureDiagnostics>(source,'diagnostics.json')}catch{}
 const captureDiagnostics=diagnostics?.summary??null
 for(const group of diagnostics?.groups||[]){
  if(['error','warning','review'].includes(group.severity))issues.push({stage:'capture',severity:group.severity,code:group.code,message:group.message,count:group.count})
 }
 const files=generatePreviewFiles(pages,source,{title:manifest.projectName||'Framer export',diagnostics,layoutSource})
 let assets:AssetRecord[]=[];try{assets=parse<AssetManifest>(source,'assets/manifest.json').assets||[]}catch{issues.push({stage:'capture',severity:'warning',message:'Asset manifest missing'})}
 const mappings:[string,string][]=[]
 for(const a of assets){
  if(a.bundled){
   if(!safePath(a.path)||!a.path.startsWith('assets/')||source[a.path]===undefined)issues.push({stage:'capture',severity:'error',message:'Bundled asset absent: '+a.path})
   else if(typeof a.url==='string')mappings.push([a.url,'/'+a.path])
  }else issues.push({stage:'capture',severity:'warning',message:'Asset not bundled: '+(a.url||a.path||'unknown')})
 }
 for(const [p,v] of Object.entries(files))if(p.startsWith('preview/src/')&&/\.(tsx|css)$/.test(p)&&typeof v==='string'){
  // Do not rewrite original code-component source. Its dependencies need separate analysis.
  if(p.startsWith('preview/src/components/code/'))continue
  let next=v;for(const [url,local] of mappings)next=next.replaceAll(url,local);files[p]=next
 }
 const emitted=Object.keys(files).filter(p=>/\/breakpoints\/[^/]+\/Component\.tsx$/.test(p)).length
 if(emitted!==variants)throw Error('Compiler emitted '+emitted+' of '+variants+' expected variants')
 const report={format:'framer-to-agent/compile-report-v1',routes:pages.length,snapshots,expectedVariants:variants,emittedVariants:emitted,captureIssues:issues,captureDiagnostics,captureStatus:issues.some(i=>i.severity==='error')?'incomplete':issues.length?'limitations-reported':'no-known-structural-errors',appliedReferenceNodes:Object.keys(overlay.nodes).length,referenceCoverage:overlay.coverage,skippedEvidence:evidence.length-validEvidence.length,build:{status:'not-run'},fidelity:{status:'unverified',reason:'A separate browser comparison against the authorized source is required.'}}
 const pkg=parse<GeneratedPackage>(files,'preview/package.json')
 pkg.scripts['build:react']=pkg.scripts.build
 pkg.scripts.build='node scripts/build-react.ts'
 files['preview/package.json']=JSON.stringify(pkg,null,2)
 files['preview/scripts/build-react.ts']=`import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
const p=new URL('../compile-report.json',import.meta.url)
const report=JSON.parse(fs.readFileSync(p,'utf8'))
const startedAt=new Date().toISOString()
report.build={status:'running',startedAt};fs.writeFileSync(p,JSON.stringify(report,null,2))
const command=process.platform==='win32'?'npm.cmd':'npm'
const result=spawnSync(command,['run','build:react'],{stdio:'inherit',shell:process.platform==='win32'})
report.build={status:result.status===0?'passed':'failed',startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,error:result.error?.message}
fs.writeFileSync(p,JSON.stringify(report,null,2));process.exitCode=result.status??1
`
 files['preview/compile-report.json']=JSON.stringify(report,null,2)
 files['preview/reference-overlay.json']=JSON.stringify(overlay,null,2)
 return {files,report}
}
