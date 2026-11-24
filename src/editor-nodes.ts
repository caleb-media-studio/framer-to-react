import type {ArchiveFiles,DesignNode,Manifest,Attributes} from './types.ts'
import type {EditorSource} from './editor-source.ts'
import type {OfficialNode} from './official-layouts.ts'
import {resolveExactIcon} from './icon-resolver.ts'
import {safeSvg,svgPath} from './vectors.ts'
export const EDITOR_NODES='library/editor-nodes.json'
export const EDITOR_ICON_CONTROLS='library/editor-icon-controls.json'
export type IconControls=Record<string,{controls?:Record<string,{type?:string;name?:string;defaultValue?:unknown}>}>
export interface EditorNodes {format:'framer-to-agent/editor-node-capture-v1'|'framer-to-agent/editor-node-capture-v2';projectId:string;branch:string;pageId?:string;pageIds?:string[];nodes:OfficialNode[]}
const supported=new Set(['FrameNode','IconNode','SVGNode','ShapeContainerNode','RelativeOverlayNode','FixedOverlayNode','ComponentInstanceNode'])
const identity=(p:string,b:string,id:string)=>JSON.stringify([p,b,id])
export function parseEditorNodes(value:unknown,source:EditorSource,manifest:Manifest):EditorNodes{
 const d=value as EditorNodes
 if(!d||!['framer-to-agent/editor-node-capture-v1','framer-to-agent/editor-node-capture-v2'].includes(d.format)||d.projectId!==source.projectId||d.branch!==source.branch||!Array.isArray(d.nodes))throw Error('Invalid or unrelated editor node capture')
 const ids=d.format==='framer-to-agent/editor-node-capture-v1'?[d.pageId]:d.pageIds
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!source.scope.pages.includes(id)))throw Error('Invalid editor node capture scope')
 const pages=new Map((manifest.pages??[]).filter(p=>ids.includes(p.id)).map(p=>[p.id,p]))
 if(pages.size!==ids.length)throw Error('Editor node page missing')
 const seen=new Set<string>()
 for(const n of d.nodes){
  const page=pages.get(n.$scopeId)
  if(!supported.has(n.type)||typeof n.id!=='string'||!page||!page.breakpoints?.some(b=>b.id===n.$groundNodeId)||n.$truncated)throw Error('Editor node identity mismatch')
  const key=identity(n.$scopeId,n.$groundNodeId,n.id)
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
/** Framer native icon renderer rounds pixel dimensions before intrinsic sizing.
 * Keep the explicit editor lengths untouched in the capture; normalize only in the compiler.
 * Auto on the other axis follows the resolved source SVG's intrinsic ratio.
 */
export function nativeIconDimensions(n:OfficialNode,svg:string):{width?:string;height?:string}{
 const pixel=(v:unknown)=>typeof v==='string'&&/^\d+(?:\.\d+)?px$/.test(v)?parseFloat(v):undefined
 const w=pixel(n.width),h=pixel(n.height)
 const viewBox=/\bviewBox=(["'])([^"']+)\1/i.exec(svg)?.[2].trim().split(/[\s,]+/).map(Number)
 const ratio=viewBox?.length===4&&viewBox[2]>0&&viewBox[3]>0?viewBox[2]/viewBox[3]:null
 const out:{width?:string;height?:string}={}
 if(w!==undefined)out.width=Math.round(w)+'px'
 if(h!==undefined)out.height=Math.round(h)+'px'
 if(ratio&&w!==undefined&&n.height==='auto')out.height=Math.round(Math.round(w)/ratio)+'px'
 if(ratio&&h!==undefined&&n.width==='auto')out.width=Math.round(Math.round(h)*ratio)+'px'
 return out
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
  const k=identity(n.$scopeId,n.$groundNodeId,n.id)
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
   if(r.svg){a.svg=r.svg;a.vectorOrigin='editor-icon-registry';Object.assign(a,nativeIconDimensions(n,r.svg))}
   return {...node,kind:'IconNode',attributes:a,children:[]}
  }
  if(r.svg){
   a.svg=r.svg;a.vectorOrigin='editor-tree-svg'
   if(typeof n.width==='string'&&n.width!=='auto')a.width=n.width
   if(typeof n.height==='string'&&n.height!=='auto')a.height=n.height
   return {...node,kind:n.type,attributes:a,children:[]}
  }
  if(n.type==='ComponentInstanceNode'){
   a.editorComponentId=n.component
   a.controls={...a.controls}
   for(const [key,value] of Object.entries(n))if(key.startsWith('$control__'))a.controls[key.slice(10)]=value
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
 return {resolve,assets,scope:d.format==='framer-to-agent/editor-node-capture-v1'?[d.pageId!]:d.pageIds!,report:()=>({captured:rows.size,applied:applied.size,conflicts:[...conflicts],unmatched:[...rows.keys()].filter(k=>!applied.has(k)&&!conflicts.has(k)),closedOverlays:[...overlays],unresolvedIcons:[...unresolvedIcons]})}
}

export type EditorNodeResolver=Awaited<ReturnType<typeof createEditorNodeResolver>>
