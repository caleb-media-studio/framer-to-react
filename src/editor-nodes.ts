import type {ArchiveFiles,DesignNode,Manifest,Attributes} from './types.ts'
import type {EditorSource} from './editor-source.ts'
import type {OfficialNode} from './official-layouts.ts'
import {resolveExactIcon} from './icon-resolver.ts'
import {safeSvg,svgPath} from './vectors.ts'
export const EDITOR_NODES='library/editor-nodes.json'
export const EDITOR_ICON_CONTROLS='library/editor-icon-controls.json'
export type IconControls=Record<string,{controls?:Record<string,{type?:string;name?:string;defaultValue?:unknown}>}>
export interface EditorNodes {format:'framer-to-agent/editor-node-capture-v1';projectId:string;branch:string;pageId:string;nodes:OfficialNode[]}
const supported=new Set(['FrameNode','IconNode','SVGNode','ShapeContainerNode','RelativeOverlayNode','FixedOverlayNode'])
const identity=(p:string,b:string,id:string)=>JSON.stringify([p,b,id])
export function parseEditorNodes(value:unknown,source:EditorSource,manifest:Manifest):EditorNodes{
 const d=value as EditorNodes
 if(!d||d.format!=='framer-to-agent/editor-node-capture-v1'||d.projectId!==source.projectId||d.branch!==source.branch||!Array.isArray(d.nodes)||!source.scope.pages.includes(d.pageId))throw Error('Invalid or unrelated editor node capture')
 const page=manifest.pages?.find(p=>p.id===d.pageId),seen=new Set<string>()
 if(!page)throw Error('Editor node page missing')
 for(const n of d.nodes){
  if(!supported.has(n.type)||typeof n.id!=='string'||n.$scopeId!==d.pageId||!page.breakpoints?.some(b=>b.id===n.$groundNodeId)||n.$truncated)throw Error('Editor node identity mismatch')
  const key=identity(d.pageId,n.$groundNodeId,n.id)
  if(seen.has(key))throw Error('Duplicate editor node identity')
  seen.add(key)
 }
 return d
}
/** Resolve control values only by declared control type and name. */
export function iconPaint(n:OfficialNode,controls:IconControls){
 const schema=controls[n.set]?.controls??{}
 let color:unknown,strokeWidth:unknown
 for(const [key,def] of Object.entries(schema)){
  const value=n[key]??def.defaultValue
  if(def.type==='color'&&def.name==='color')color=value
  if(def.type==='number'&&def.name==='width')strokeWidth=value
 }
 return {color:typeof color==='string'?color:undefined,strokeWidth:typeof strokeWidth==='number'&&Number.isFinite(strokeWidth)&&strokeWidth>=0&&strokeWidth<=24?strokeWidth:undefined}
}
export async function sourceIcon(n:OfficialNode,controls:IconControls){
 const paint=iconPaint(n,controls)
 const match=await resolveExactIcon(n.icon,n.set,paint)
 if(!match?.svg)return null
 const svg=safeSvg(paint.strokeWidth===undefined?match.svg:match.svg.replace(/\bstroke-width=(["'])[\d.]+\1/g,'stroke-width="'+paint.strokeWidth+'"'))
 return {svg,color:paint.color}
}
export async function createEditorNodeResolver(d:EditorNodes,controls:IconControls){
 const rows=new Map<string,{node:OfficialNode;svg?:string;color?:string}>()
 const assets:ArchiveFiles={},applied=new Set<string>(),conflicts=new Set<string>(),unresolvedIcons=new Set<string>(),overlays=new Set<string>()
 for(const n of d.nodes){
  const k=identity(d.pageId,n.$groundNodeId,n.id)
  const row:{node:OfficialNode;svg?:string;color?:string}={node:n}
  if(n.type==='IconNode'){
   const icon=await sourceIcon(n,controls)
   if(icon){row.svg=icon.svg;row.color=icon.color}else unresolvedIcons.add(k)
  }else if((n.type==='SVGNode'||n.type==='ShapeContainerNode')&&typeof n.svg==='string')row.svg=safeSvg(n.svg)
  if(row.svg)assets[svgPath(row.svg)]=row.svg
  rows.set(k,row)
 }
 const resolve=(node:DesignNode,pageId:string,bp:string):DesignNode=>{
  const key=identity(pageId,bp,node.id),r=rows.get(key)
  if(!r)return node
  const n=r.node
  const compatible=n.type===node.kind||(n.type==='IconNode'&&node.kind==='ComponentInstanceNode')||(/OverlayNode$/.test(n.type)&&node.kind==='FrameNode')
  if(!compatible){conflicts.add(key);return node}
  applied.add(key)
  const a:Attributes={...node.attributes,editorKind:n.type}
  if(typeof n.visible==='boolean')a.visible=n.visible
  if(/OverlayNode$/.test(n.type)){overlays.add(key);return {...node,kind:n.type,attributes:a}}
  if(n.type==='IconNode'){
   a.icon=n.icon;a.set=n.set
   if(r.color)a.color=r.color
   if(typeof n.width==='string'&&n.width!=='auto')a.width=n.width
   if(typeof n.height==='string'&&n.height!=='auto')a.height=n.height
   else if(typeof a.width==='string'&&/^\d+(?:\.\d+)?px$/.test(a.width))a.height=a.width
   if(r.svg){a.svg=r.svg;a.vectorOrigin='editor-icon-registry'}
   return {...node,kind:'IconNode',attributes:a,children:[]}
  }
  if(r.svg){
   a.svg=r.svg;a.vectorOrigin='editor-tree-svg'
   if(typeof n.width==='string'&&n.width!=='auto')a.width=n.width
   if(typeof n.height==='string'&&n.height!=='auto')a.height=n.height
   return {...node,kind:n.type,attributes:a,children:[]}
  }
  if(n.type==='FrameNode'){
   // Prefer explicit source edge strokes; don't paint an all-sides border on a single divider.
   if(typeof n.borderStyle==='string'&&typeof n.borderColor==='string'&&['Top','Right','Bottom','Left'].some(side=>typeof n['border'+side]==='string')){
    delete a.border
    for(const side of ['Top','Right','Bottom','Left']){
     const k='border'+side
     if(typeof n[k]==='string')a[k]=n[k]+' '+n.borderStyle+' '+n.borderColor
    }
   }
   if(n.radius!=null)a.borderRadius=n.radius
   if(typeof n.fill==='string')a.backgroundColor=n.fill
   if(Array.isArray(n.onTap)&&n.onTap.length)a.onTap=n.onTap
  }
  return {...node,kind:n.type,attributes:a}
 }
 return {resolve,assets,report:()=>({captured:rows.size,applied:applied.size,conflicts:[...conflicts],unmatched:[...rows.keys()].filter(k=>!applied.has(k)&&!conflicts.has(k)),closedOverlays:[...overlays],unresolvedIcons:[...unresolvedIcons]})}
}

export type EditorNodeResolver=Awaited<ReturnType<typeof createEditorNodeResolver>>
