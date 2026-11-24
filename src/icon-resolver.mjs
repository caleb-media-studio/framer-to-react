import {icons} from './lucide-data.mjs'
export function iconSVG(name,layer) {
  if (!/(^|[\/·])\s*icon\b/i.test(String(layer||''))) return null
  const key=String(name||'').replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  return Object.prototype.hasOwnProperty.call(icons,key)?{key,svg:icons[key]}:null
}
// Multi-source icon registry is being integrated.
const packs={Lucide:'lucide',Logos:'logos',Flowbite:'flowbite',Phosphor:'ph',Hero:'heroicons',Feather:'feather',Meteor:'meteor-icons',Material:'material-symbols',Nonicons:'nonicons',Mage:'mage',Sargam:'sargam'}
export const iconSets=['Lucide','Logos','Flowbite','Iconic','Phosphor','Hero','Feather','Meteor','Material','Basicons','Nonicons','Sargam','Mage']
const sourceById={"Y7SpbVH16cWqMhj75z1M":"Lucide","rTgCpOIUH6tdiqNh47fL":"Logos","2BtL64EofggzGo2O20Ku":"Flowbite","EqX8thWQjdZcOB1c6p5N":"Iconic","omX0gWFPqDwhaiWwf6ab":"Phosphor","DyJDRQD0f0RPOu0ZYoEG":"Hero","fiHEoJwBMFnT6QLOcpPz":"Feather","eO37kitVCMcNEgHMGd3K":"Meteor","JIScivAkNLgXrcOUxHXD":"Material","E1vFg1A6wcWAGuFi9Hz1":"Basicons","5EupTCi3bb5mAT1SnBTQ":"Nonicons","mbMVkRB5lkkRzWT95l5L":"Sargam","NCiKiaU9qhVJumKU6JAo":"Mage"}
export async function resolveIcon(name,layer,set) {
 const source=sourceById[set]||(iconSets.includes(set)?set:null)
 if(!source){const v=iconSVG(name,layer);return v?{...v,source:"Lucide",inferred:true}:null}
 if(!packs[source])return {source,unavailable:true}
 const data=(await import(`./icon-sets/${packs[source]}.mjs`)).default
 const key=String(name||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")
 const icon=data.icons[key]||data.icons[key+"-outline"]||data.icons[key+"-regular"]||data.icons[data.aliases?.[key]?.parent]
 if(!icon)return {source,key,unavailable:true}
 const w=icon.width||data.width||24,h=icon.height||data.height||24
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 ${w} ${h}" fill="currentColor">${icon.body}</svg>`
 return {source,key,svg,inferred:false}
}
