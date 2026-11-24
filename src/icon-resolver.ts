import iconData from './lucide-data.json' with {type:'json'}
const icons: Record<string,string> = iconData
export function iconSVG(name:unknown,layer:unknown) {
  if (!/(^|[\/·])\s*icon\b/i.test(String(layer||''))) return null
  const key=String(name||'').replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  return Object.prototype.hasOwnProperty.call(icons,key)?{key,svg:icons[key]}:null
}
// Multi-source icon registry is being integrated.
const packs:Record<string,string>={Lucide:'lucide',Logos:'logos',Flowbite:'flowbite',Phosphor:'ph',Hero:'heroicons',Feather:'feather',Meteor:'meteor-icons',Material:'material-symbols',Nonicons:'nonicons',Mage:'mage',Sargam:'sargam'}
interface IconPack {width?:number;height?:number;icons:Record<string,{body:string;width?:number;height?:number}>;aliases?:Record<string,{parent:string}>}
export interface ResolvedIcon {source:string;key?:string;svg?:string;inferred?:boolean;unavailable?:boolean}
const packLoaders: Record<string, () => Promise<{default:IconPack}>> = {
  "lucide": () => import("./icon-sets/lucide.json", {with:{type:"json"}}),
  "logos": () => import("./icon-sets/logos.json", {with:{type:"json"}}),
  "flowbite": () => import("./icon-sets/flowbite.json", {with:{type:"json"}}),
  "ph": () => import("./icon-sets/ph.json", {with:{type:"json"}}),
  "heroicons": () => import("./icon-sets/heroicons.json", {with:{type:"json"}}),
  "feather": () => import("./icon-sets/feather.json", {with:{type:"json"}}),
  "meteor-icons": () => import("./icon-sets/meteor-icons.json", {with:{type:"json"}}),
  "material-symbols": () => import("./icon-sets/material-symbols.json", {with:{type:"json"}}),
  "nonicons": () => import("./icon-sets/nonicons.json", {with:{type:"json"}}),
  "mage": () => import("./icon-sets/mage.json", {with:{type:"json"}}),
  "sargam": () => import("./icon-sets/sargam.json", {with:{type:"json"}}),
}
export const iconSets=['Lucide','Logos','Flowbite','Iconic','Phosphor','Hero','Feather','Meteor','Material','Basicons','Nonicons','Sargam','Mage']
const sourceById:Record<string,string>={"Y7SpbVH16cWqMhj75z1M":"Lucide","rTgCpOIUH6tdiqNh47fL":"Logos","2BtL64EofggzGo2O20Ku":"Flowbite","EqX8thWQjdZcOB1c6p5N":"Iconic","omX0gWFPqDwhaiWwf6ab":"Phosphor","DyJDRQD0f0RPOu0ZYoEG":"Hero","fiHEoJwBMFnT6QLOcpPz":"Feather","eO37kitVCMcNEgHMGd3K":"Meteor","JIScivAkNLgXrcOUxHXD":"Material","E1vFg1A6wcWAGuFi9Hz1":"Basicons","5EupTCi3bb5mAT1SnBTQ":"Nonicons","mbMVkRB5lkkRzWT95l5L":"Sargam","NCiKiaU9qhVJumKU6JAo":"Mage"}
export async function resolveIcon(name:unknown,layer:unknown,set:unknown):Promise<ResolvedIcon|null> {
 const source=typeof set==="string"?(sourceById[set]||(iconSets.includes(set)?set:null)):null
 if(!source){const v=iconSVG(name,layer);return v?{...v,source:"Lucide",inferred:true}:null}
 if(!packs[source])return {source,unavailable:true}
 const data:IconPack=(await packLoaders[packs[source]]()).default
 const key=String(name||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")
 const icon=data.icons[key]||data.icons[key+"-outline"]||data.icons[key+"-regular"]||data.icons[data.aliases?.[key]?.parent ?? ""]
 if(!icon)return {source,key,unavailable:true}
 const w=icon.width||data.width||24,h=icon.height||data.height||24
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 ${w} ${h}" fill="currentColor">${icon.body}</svg>`
 return {source,key,svg,inferred:false}
}

// Exact documented icon identity only. No guessed fallback shape or variant.
export async function resolveExactIcon(name:unknown,set:unknown):Promise<ResolvedIcon|null>{
 if(typeof name!=='string'||typeof set!=='string')return null
 const source=sourceById[set]||(iconSets.includes(set)?set:null)
 if(!source||!packs[source])return null
 const pack=(await packLoaders[packs[source]]()).default
 // The editor uses display names (e.g. Git Pull Request), registries use kebab-case.
 // Resolve only a canonical exact key or a registry-declared alias, never infer a variant.
 const displayKey=name.trim().replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase().replace(/\s+/g,'-')
 const canonical=Object.hasOwn(pack.icons,name)?name:Object.hasOwn(pack.icons,displayKey)?displayKey:pack.aliases?.[displayKey]?.parent
 const icon=canonical&&Object.hasOwn(pack.icons,canonical)?pack.icons[canonical]:null
 if(!icon||!canonical)return null
 const w=icon.width||pack.width||24,h=icon.height||pack.height||24
 return {source,key:canonical,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" fill="currentColor">'+icon.body+'</svg>',inferred:false}
}
