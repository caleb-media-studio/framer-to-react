import type {ArchiveFiles,Manifest} from './types.ts'
import {EDITOR_SOURCE,parseEditorSource,type EditorSource} from './editor-source.ts'
import {EDITOR_NODES,EDITOR_ICON_CONTROLS,parseEditorNodes,type EditorNodes,type IconControls} from './editor-nodes.ts'
import type {OfficialNode} from './official-layouts.ts'

export const EDITOR_PROJECT='library/editor-project.json'
export interface ProjectEditorIndex {
 format:'framer-to-agent/editor-project-v1'
 projectId:string
 branch:string
 pages:{id:string;path:string;file:string}[]
}
export interface EditorPageCapture {
 format:'framer-to-agent/editor-page-v1'
 projectId:string
 branch:string
 pageId:string
 path:string
 tree:OfficialNode
 vectors?:{id:string;svg:string}[]
}
const typedKinds=new Set(['FrameNode','IconNode','SVGNode','ShapeContainerNode','RelativeOverlayNode','FixedOverlayNode'])
const read=(files:Readonly<ArchiveFiles>,name:string)=>{
 const s=files[name];if(typeof s!=='string')throw Error('Missing editor capture document '+name)
 return JSON.parse(s)
}
/** One authoritative source adapter for both compilation and verification. Source
 * trees stay untouched; page/breakpoint-scoped lookup records are derived in memory. */
export function readProjectEditorCapture(files:Readonly<ArchiveFiles>,manifest:Manifest){
 const raw=files[EDITOR_SOURCE]
 const index=files[EDITOR_PROJECT]
 const controls:IconControls=typeof files[EDITOR_ICON_CONTROLS]==='string'?read(files,EDITOR_ICON_CONTROLS):{}
 if(typeof raw!=='string'){
  if(index!==undefined||files[EDITOR_NODES]!==undefined)throw Error('Editor capture requires project metadata')
  return {source:null,nodes:undefined,controls}
 }
 const base=parseEditorSource(JSON.parse(raw),manifest)
 if(index===undefined)return {source:base,nodes:typeof files[EDITOR_NODES]==='string'?parseEditorNodes(read(files,EDITOR_NODES),base,manifest):undefined,controls}
 if(files[EDITOR_NODES]!==undefined||base.text.length||base.scope.pages.length)throw Error('Ambiguous project and legacy editor captures')
 const project=read(files,EDITOR_PROJECT) as ProjectEditorIndex
 if(project.format!=='framer-to-agent/editor-project-v1'||project.projectId!==base.projectId||project.branch!==base.branch||!Array.isArray(project.pages))throw Error('Invalid project editor index')
 const expected=new Map((manifest.pages??[]).map(p=>[p.id,p]))
 const seen=new Set<string>(),text:OfficialNode[]=[],nodes:OfficialNode[]=[]
 for(const entry of project.pages){
  const p=expected.get(entry.id)
  if(!p||p.path!==entry.path||seen.has(entry.id)||!/^[A-Za-z0-9_-]+$/.test(entry.id)||entry.file!=='library/editor-pages/'+entry.id+'.json')throw Error('Invalid editor project page identity')
  seen.add(entry.id)
  const doc=read(files,entry.file) as EditorPageCapture
  if(doc.format!=='framer-to-agent/editor-page-v1'||doc.projectId!==project.projectId||doc.branch!==project.branch||doc.pageId!==entry.id||doc.path!==entry.path||doc.tree?.id!==entry.id||doc.tree?.type!=='WebPageNode')throw Error('Unrelated editor page capture '+entry.path)
  const vectors=new Map<string,string>()
  for(const v of doc.vectors??[]){if(typeof v.id!=='string'||typeof v.svg!=='string'||vectors.has(v.id))throw Error('Invalid captured vector');vectors.set(v.id,v.svg)}
  const expectedBreakpoints=new Set((p.breakpoints??[]).map(b=>b.id))
  const roots=doc.tree.children??[]
  if(roots.length!==expectedBreakpoints.size||new Set(roots.map(b=>b.id)).size!==roots.length||roots.some(b=>!expectedBreakpoints.has(b.id)))throw Error('Editor page breakpoint coverage mismatch '+entry.path)
  if(doc.tree.$truncated)throw Error('Truncated editor page '+entry.path)
  function visit(n:OfficialNode,bp:string){
   if(n.$truncated)throw Error('Truncated editor node '+n.id)
   if(n.type==='RichTextNode'||typedKinds.has(n.type)){
    if(n.$scopeId!==entry.id||n.$groundNodeId!==bp)throw Error('Editor page node identity mismatch '+n.id)
    if(n.type==='RichTextNode'){
     // Retain exact rich-text block/run records; check for truncation inside them too.
     const check=(x:OfficialNode)=>{if(x.$truncated)throw Error('Truncated rich text '+n.id);for(const c of x.children??[])check(c)}
     check(n);text.push(n);return
    }
    const {children:_,...record}=n;const svg=vectors.get(n.id);nodes.push(svg===undefined?record:{...record,svg});vectors.delete(n.id)
   }
   for(const c of n.children??[])visit(c,bp)
  }
  for(const b of roots)visit(b,b.id)
  if(vectors.size)throw Error('Unmatched editor vector identity')
 }
 const source=parseEditorSource({...base,scope:{pages:[...seen],layouts:'all'},text},manifest)
 const typed:EditorNodes={format:'framer-to-agent/editor-node-capture-v2',projectId:base.projectId,branch:base.branch,pageIds:[...seen],nodes}
 return {source,nodes:seen.size?parseEditorNodes(typed,source,manifest):undefined,controls}
}
