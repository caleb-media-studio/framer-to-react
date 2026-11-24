import type {ArchiveFiles,DesignNode,Issue} from './types.ts'
import type {EditorSource} from './editor-source.ts'
import type {IconControls} from './editor-nodes.ts'
import {createOfficialNodeConverter,type OfficialNode} from './official-layouts.ts'
import {collectCanvasComponents} from './preview.ts'
export const EDITOR_COMPONENTS='library/editor-components.json'
export async function prepareEditorComponents(files:Readonly<ArchiveFiles>,source:EditorSource,controls:IconControls){
 const value=files[EDITOR_COMPONENTS]
 if(value===undefined)return undefined
 if(typeof value!=='string')throw Error('Invalid editor component source')
 const d=JSON.parse(value)
 if(d.format!=='framer-to-agent/editor-components-v1'||d.projectId!==source.projectId||d.branch!==source.branch||!Array.isArray(d.components))throw Error('Unrelated editor component source')
 const legacy=collectCanvasComponents(files),ids=new Map([...legacy].map(([id,node])=>[node.id,id]))
 if(ids.size!==legacy.size)throw Error('Duplicate captured component definition identity')
 const vectors=new Map<string,string>()
 for(const v of d.vectors??[]){if(typeof v.id!=='string'||typeof v.svg!=='string'||vectors.has(v.id))throw Error('Invalid component vector');vectors.set(v.id,v.svg)}
 const {convert,assets,issues}=createOfficialNodeConverter(controls,ids,vectors)
 const components=new Map(legacy),seen=new Set<string>()
 for(const c of d.components as OfficialNode[]){
  if(c.type!=='ComponentNode'||typeof c.id!=='string'||seen.has(c.id)||!ids.has(c.id))throw Error('Unmatched original component definition '+c.id)
  seen.add(c.id)
  const root=await convert(c)
  const defaults:Record<string,string>={}
  for(const variable of c.variables??[]){
   if(variable?.type!=='string'||typeof variable.id!=='string')continue
   const value=c['$control__'+variable.id]??variable.initialValue
   if(typeof value==='string')defaults[variable.id]=value
  }
  const primary=c.children?.find(v=>v.$isPrimary===true)
  if(!primary)issues.push({stage:'capture',severity:'review',nodeId:c.id,message:'Component primary variant identity unavailable'})
  root.attributes={...root.attributes,editorComponentId:c.id,defaultVariantId:primary?.id,editorTextDefaults:defaults}
  const fill=(n:DesignNode)=>{
   const ref=n.attributes?.editorTextReference
   if(ref){
    if(ref.providerId===c.id&&Object.hasOwn(defaults,ref.id))n.text=defaults[ref.id]
    else issues.push({stage:'compile',severity:'review',nodeId:n.id,message:'Unresolved component text variable '+String(ref.id)})
   }
   for(const child of n.children??[])fill(child)
  }
  fill(root);components.set(ids.get(c.id)!,root)
 }
 if(seen.size!==legacy.size)issues.push({stage:'capture',severity:'review',message:'Original editor component definitions incomplete',count:legacy.size-seen.size})
 return {components,assets,issues,covered:seen.size,total:legacy.size}
}
