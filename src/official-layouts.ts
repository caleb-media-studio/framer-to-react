import {deriveEditorRichText} from './editor-rich-text.ts'
import type {ColorResolver} from './design-tokens.ts'
import type {DesignNode,Snapshot,Attributes,ArchiveFiles,LayoutSource,LayoutTemplate,LayoutVariant,LayoutBinding,PageRecord,Issue} from './types.ts'
export interface OfficialNode {id:string;type:string;children?:OfficialNode[];[key:string]:any}
export interface OfficialDocument {format:string;templates:(Omit<OfficialNode,'type'> & {type?:string;id:string;children?:OfficialNode[]})[];pages:LayoutBinding[]}
import {generateBundle} from './generator.ts'
import {svgMarkup,svgPath,safeSvg} from './vectors.ts'
import {relativeModule} from './reuse.ts'
import {sourceIcon,nativeIconDimensions, type IconControls} from './editor-nodes.ts'

const walk=(n:OfficialNode,fn:(n:OfficialNode)=>void):void=>{fn(n);for(const c of n.children||[])walk(c,fn)}
const ident=(id:unknown)=>String(id).replace(/[^a-zA-Z0-9_-]/g,'_')
const length=(v:unknown)=>v==='auto'?'fit-content':v
const copied=['name','visible','position','top','right','bottom','left','centerX','centerY','minWidth','maxWidth','minHeight','maxHeight','layout','stackDirection','stackAlignment','stackDistribution','stackWrapEnabled','gap','padding','overflow','overflowX','overflowY','opacity','zIndex','fontName','fontSize','fontWeight','fontStyle','openTypeFontFeatures','lineHeight','letterSpacing','textColor','textAlign','textAlignment','tag','link','ariaLabel','ariaHidden','htmlTag','cursor','pointerEvents','hoverEffect','svg','backgroundImage','aspectRatio','gridColumnCount','gridRowCount','gridColumnWidth','gridColumnMinWidth','gridColumnWidthType','gridRowHeight','gridRowHeightType','gridItemColumnSpan','gridItemRowSpan','gridItemFillCellWidth','gridItemFillCellHeight']

// This is an additional authorized source format, not a mutation of the raw plugin export.
// Exact page IDs and template IDs are mandatory. No route-name or product-specific rules.
export function createOfficialNodeConverter(controls:IconControls={},componentIds=new Map<string,string>(),vectors=new Map<string,string>()){
 const assets:ArchiveFiles={},issues:Issue[]=[]
 async function convert(n:OfficialNode):Promise<DesignNode>{
  if(n.$truncated)throw Error('Incomplete official source '+n.id)
  const a:Attributes={};for(const k of copied)if(n[k]!==undefined)a[k]=n[k]
  if(n.width!==undefined)a.width=length(n.width)
  if(n.height!==undefined)a.height=length(n.height)
  if(typeof n.fill==='string')a.backgroundColor=n.fill
  if(n.radius!==undefined)a.borderRadius=n.radius
  if(typeof n.border==='string')a.border=n.border
  if(vectors.has(n.id))a.svg=vectors.get(n.id)
  if(n.type==='ComponentInstanceNode'&&typeof n.component==='string'){a.componentIdentifier=componentIds.get(n.component)??n.component;a.controls={};for(const [k,v] of Object.entries(n))if(k.startsWith('$control__'))a.controls[k.slice(10)]=v}
  if(n.borderColor)for(const side of ['Top','Right','Bottom','Left'])if(n['border'+side])a['border'+side]=n['border'+side]+' '+(n.borderStyle??'solid')+' '+n.borderColor
  if(typeof n.rotation==='string'&&/^-?[\d.]+deg$/.test(n.rotation))a.rotation=parseFloat(n.rotation)
  if(n.link?.openInNewTab)a.linkOpenInNewTab=true
  const kind=n.type==='RichTextNode'?'TextNode':n.type
  const out:DesignNode={id:n.id,kind,attributes:a,children:[]}
  if(kind==='TextNode'){
   if(typeof n.text==='string')out.text=n.text
   else if(n.text?.type==='reference'&&typeof n.text.id==='string'&&typeof n.text.providerId==='string'){a.editorTextReference={id:n.text.id,providerId:n.text.providerId};out.text=''}
   else out.text=''
   a.editorTextSource=true
   const rich=deriveEditorRichText(n);if(rich){Object.assign(a,rich.base);a.editorRichText=rich}
   if(typeof n.textWrap==='string')a.textWrap=n.textWrap
   if(n.tag)a.tag=n.tag
   const blocks=n.children||[]
   if(blocks.length>1||blocks.some(b=>(b.children||[]).length>1))issues.push({stage:'compile',severity:'review',nodeId:n.id,message:'Rich text run formatting requires verification'})
  }else if(/OverlayNode$/.test(kind)){
   // Default-state layout does not include unopened overlay content; retain the official
   // source tree and report the interaction until its behavior is implemented.
   a.visible=false;issues.push({stage:'compile',severity:'review',nodeId:n.id,message:'Source overlay interaction not yet implemented'})
  }else{
   if(kind==='IconNode'&&!a.svg){
    const v=await sourceIcon(n,controls)
    if(v?.svg){a.svg=v.svg;a.vectorOrigin='editor-icon-registry';a.height=a.height==='fit-content'?a.width:a.height;Object.assign(a,nativeIconDimensions(n,v.svg))
      if(v.color)a.color=v.color
      issues.push({stage:'compile',severity:'review',nodeId:n.id,message:'Library icon needs rendered source verification'})
    }else issues.push({stage:'compile',severity:'warning',nodeId:n.id,message:'Unresolved icon source'})
   }
   for(const c of n.children||[])out.children!.push(await convert(c))
  }
  if(n.onTap?.length)issues.push({stage:'compile',severity:'review',nodeId:n.id,message:'Captured tap actions require interaction verification'})
  const svg=svgMarkup(out);if(svg){try{assets[svgPath(svg)]=safeSvg(svg)}catch(e){issues.push({stage:'compile',severity:'warning',nodeId:n.id,message:String(e)})}}
  return out
 }
 return {convert,assets,issues}
}
export async function prepareOfficialLayouts(doc:OfficialDocument,controls:IconControls={},componentIds=new Map<string,string>()):Promise<LayoutSource>{
 if(doc?.format!=='framer-to-agent/official-layout-tree-v1'||!Array.isArray(doc.templates)||!Array.isArray(doc.pages))throw Error('Invalid official layout source')
 const {convert,assets,issues}=createOfficialNodeConverter(controls,componentIds),templates:LayoutTemplate[]=[]
 for(const t of doc.templates){
  const variants:LayoutVariant[]=[]
  for(const bp of t.children||[]){
   let slots=0;walk(bp,n=>{if(n.type==='PlaceholderNode')slots++})
   if(slots!==1)throw Error('Expected exactly one layout content slot: '+bp.id)
   const root=await convert(bp)
   // A template's fixed editor canvas height is not a fixed document height.
   // The placeholder supplies the actual page content; the shared shell hugs it.
   root.attributes={...root.attributes,width:'100%',height:'fit-content',minHeight:'100vh',position:'relative',isBreakpoint:true}
   for(const k of ['top','right','bottom','left','centerX','centerY'])delete root.attributes[k]
   variants.push({id:bp.id,width:parseFloat(bp.width),mediaQuery:bp.$mediaQuery?.range||null,root})
  }
  templates.push({id:t.id,name:t.name,variants})
 }
 return {format:'framer-to-agent/layout-source-v1',bindings:doc.pages,templates,assets,issues}
}

export function layoutModules(source:LayoutSource|null,pages:PageRecord[],resolveCapturedIcon?:(node:DesignNode)=>string|null,resolveCapturedColor?:ColorResolver,resolveCanvasComponent?:(id:unknown)=>DesignNode|null){
 const files:ArchiveFiles={},assignments=new Map<string,LayoutTemplate>(),issues=[...(source?.issues||[])]
 if(!source)return {files,assignments,issues}
 if(source.format!=='framer-to-agent/layout-source-v1')throw Error('Unsupported normalized layout source')
 const defs=new Map(source.templates.map(t=>[t.id,t]))
 const bindings=new Map(source.bindings.map(b=>[b.id,b]))
 for(const page of pages){
  const b=bindings.get(page.id ?? "")
  if(!b||b.path!==page.path){issues.push({stage:'capture',severity:'review',route:page.path,message:'No exact official layout binding for page'});continue}
  if(!b.layout)continue
  const t=defs.get(b.layout);if(!t)throw Error('Missing bound layout '+b.layout)
  assignments.set(page.path,t)
 }
 for(const t of new Set(assignments.values()))for(const v of t.variants){
  const path='preview/src/layouts/templates/'+ident(t.id)+'/'+ident(v.id)+'/Component.tsx'
  const bundle=generateBundle({roots:[v.root],pagePath:'layout:'+t.id},{layoutSlot:true,resolveCapturedIcon,resolveCapturedColor,resolveCanvasComponent})
  files[path]=bundle.tsx
  files[path.replace('Component.tsx','component.css')]=bundle.css
 }
 for(const [p,v] of Object.entries(source.assets||{}))files['preview/public/'+p]=v
 return {files,assignments,issues}
}

export function selectLayoutVariant(t:LayoutTemplate,width:number){
 const sorted=[...t.variants].sort((a,b)=>b.width-a.width)
 return sorted.find(v=>v.width<=width)||sorted.at(-1)!
}
export function layoutModulePath(t:LayoutTemplate,v:LayoutVariant){return 'preview/src/layouts/templates/'+ident(t.id)+'/'+ident(v.id)+'/Component.tsx'}
export function contentWithinLayout(snapshot:Snapshot):Snapshot{
 return {...snapshot,roots:snapshot.roots.map(root=>{
  const a:Attributes={...root.attributes,width:'100%',height:'fit-content',position:'relative',isBreakpoint:false,backgroundColor:'transparent',overflow:'visible'}
  for(const k of ['top','right','bottom','left','centerX','centerY','minHeight','maxHeight'])delete a[k]
  return {...root,attributes:a}
 })}
}
