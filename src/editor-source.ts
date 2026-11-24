import type {ArchiveFiles,Manifest,Snapshot,DesignNode} from './types.ts'
import type {OfficialDocument,OfficialNode} from './official-layouts.ts'
export const EDITOR_SOURCE='library/editor-source.json'
export interface EditorSource extends Omit<OfficialDocument,'format'> {
 format:'framer-to-agent/editor-source-v1'
 adapter:'framer-authorized-tree-api'
 projectId:string
 branch:string
 scope:{pages:string[];layouts:'all'}
 text:OfficialNode[]
}
export function parseEditorSource(value:unknown,manifest:Manifest):EditorSource{
 if(!value||typeof value!=='object')throw Error('Invalid editor capture')
 const d=value as EditorSource
 if(d.format!=='framer-to-agent/editor-source-v1'||d.adapter!=='framer-authorized-tree-api'||typeof d.projectId!=='string'||!d.projectId||typeof d.branch!=='string'||!Array.isArray(d.pages)||!Array.isArray(d.templates)||!Array.isArray(d.text)||!Array.isArray(d.scope?.pages)||d.scope.layouts!=='all')throw Error('Invalid editor capture format')
 const bindings=new Map(d.pages.map(p=>[p.id,p]))
 if(bindings.size!==d.pages.length)throw Error('Duplicate editor page identity')
 for(const page of manifest.pages??[]){
  const b=bindings.get(page.id??'')
  if(!b||b.path!==page.path)throw Error('Editor capture page identity mismatch: '+page.path)
 }
 const ids=new Set(d.templates.map(t=>t.id))
 if(ids.size!==d.templates.length||d.pages.some(p=>p.layout&&!ids.has(p.layout)))throw Error('Incomplete editor layout capture')
 const scopes=new Set(d.scope.pages)
 for(const id of scopes)if(!bindings.has(id))throw Error('Unknown editor capture scope')
 const seen=new Set<string>()
 for(const t of d.text){
  if(t.type!=='RichTextNode'||typeof t.id!=='string'||typeof t.$scopeId!=='string'||!scopes.has(t.$scopeId)||typeof t.$groundNodeId!=='string'||typeof t.text!=='string'||t.$truncated)throw Error('Invalid editor text record')
  const page=manifest.pages?.find(p=>p.id===t.$scopeId)
  if(!page?.breakpoints?.some(b=>b.id===t.$groundNodeId))throw Error('Editor text breakpoint mismatch: '+t.id)
  const key=JSON.stringify([t.$scopeId,t.$groundNodeId,t.id])
  if(seen.has(key))throw Error('Duplicate editor text identity')
  seen.add(key)
 }
 return d
}
const styleFields=['fontSize','fontWeight','fontStyle','fontName','lineHeight','letterSpacing','textColor','textAlign','textAlignment','textTransform','textDecoration','tag'] as const
export function createEditorTextResolver(d:EditorSource,nodeResolver?:import('./editor-nodes.ts').EditorNodeResolver){
 const nodes=new Map(d.text.map(t=>[JSON.stringify([t.$scopeId,t.$groundNodeId,t.id]),t]))
 const applied=new Set<string>(),conflicts=new Set<string>(),complex=new Set<string>()
 const resolve=(snapshot:Snapshot,pageId:string):Snapshot=>{
  const visit=(node:DesignNode,bp:string):DesignNode=>{
   const key=JSON.stringify([pageId,bp,node.id]),t=nodes.get(key)
   let current=nodeResolver?.resolve(node,pageId,bp)??node
   if(t&&(node.kind==='TextNode'||node.kind==='RichTextNode')){
    if(node.text!==t.text&&String(node.text??'').replace(/\n/g,'')!==t.text.replace(/\n/g,''))conflicts.add(key)
    else{
     const a={...node.attributes},font={...a.font}
     for(const field of styleFields)if(t[field]!==undefined&&t[field]!==null)a[field]=t[field]
     if(typeof t.fontName==='string')font.family=t.fontName
     if(typeof t.fontWeight==='number')font.weight=t.fontWeight
     if(typeof t.fontStyle==='string')font.style=t.fontStyle
     a.font=font
     const inline={...a.inlineTextStyle}
     for(const [from,to] of [['fontSize','fontSize'],['lineHeight','lineHeight'],['letterSpacing','letterSpacing'],['textColor','color'],['textAlignment','alignment'],['textAlign','alignment'],['textDecoration','decoration'],['textTransform','transform']] as const)if(t[from]!=null)inline[to]=t[from]
     if(Object.keys(inline).length)a.inlineTextStyle=inline
     if((t.children??[]).length>1||(t.children??[]).some(b=>(b.children??[]).length>1))complex.add(key)
     applied.add(key);current={...node,attributes:a,text:t.text}
    }
   }
   return {...current,children:(current.children??[]).map(c=>visit(c,bp))}
  }
  return {...snapshot,roots:snapshot.roots.map(r=>visit(r,r.id))}
 }
 return {resolve,report:()=>({captured:nodes.size,applied:applied.size,unmatched:[...nodes.keys()].filter(k=>!applied.has(k)&&!conflicts.has(k)),conflicts:[...conflicts],complexRuns:[...complex],scope:d.scope,...(nodeResolver?{nodes:nodeResolver.report()}:{})})}
}

