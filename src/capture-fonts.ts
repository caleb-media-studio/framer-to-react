import type {SDKClient,Snapshot,DesignNode,FontDescriptor,AssetReferences} from './types.ts'
export interface CapturedFont extends FontDescriptor {selector?:string|null;status:'available'|'unavailable';reason?:string}
const family=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null
const weight=(v:unknown)=>typeof v==='number'&&[100,200,300,400,500,600,700,800,900].includes(v)?v:typeof v==='string'&&/^[1-9]00$/.test(v)?Number(v):undefined
const style=(v:unknown)=>v==='normal'||v==='italic'?v:undefined
/** Resolve only used, explicitly identified font variants via the documented SDK. */
export async function captureUsedFonts(sdk:SDKClient,snapshots:Snapshot[],warnings:string[]):Promise<CapturedFont[]>{
 const wanted=new Map<string,CapturedFont>()
 function inspect(f:unknown){
  if(!f||typeof f!=='object')return
  const a=f as Record<string,unknown>
  const name=family(a.family??a.fontFamily)
  if(!name)return
  const w=weight(a.weight??a.fontWeight),s=style(a.style??a.fontStyle)
  const url=typeof a.url==='string'?a.url:undefined
  const key=JSON.stringify([name,w??null,s??null,typeof a.selector==='string'?a.selector:null])
  const prior=wanted.get(key)
  if(!prior||(!prior.url&&url))wanted.set(key,{family:name,weight:w,style:s,selector:typeof a.selector==='string'?a.selector:undefined,url,status:url?'available':'unavailable'})
 }
 const walk=(n:DesignNode)=>{
  const a=n.attributes||{},ts=a.inlineTextStyle||{}
  inspect(a.font);inspect(ts.font)
  if(n.kind==='TextNode'||n.kind==='RichTextNode')inspect({family:a.fontFamily??a.fontName??ts.fontFamily,weight:a.fontWeight??ts.fontWeight,style:a.fontStyle??ts.fontStyle})
  for(const c of n.children||[])walk(c)
 }
 for(const snapshot of snapshots)for(const root of snapshot.roots)walk(root)
 for(const font of wanted.values()){
  if(font.url)continue
  // An unspecified weight/style must not be silently substituted with the SDK default.
  if(typeof sdk.getFont!=='function'||font.weight===undefined||font.style===undefined){
   font.reason='Exact variant or documented font lookup unavailable';continue
  }
  try{
   const actual=await sdk.getFont(font.family,{weight:font.weight,style:font.style})
   if(actual?.family===font.family&&actual.weight===font.weight&&actual.style===font.style&&typeof actual.url==='string'){
    font.url=actual.url;font.selector=actual.selector??font.selector;font.status='available'
   }else font.reason='SDK did not return this exact downloadable font variant'
  }catch(e){font.reason='Font lookup failed: '+String(e)}
 }
 const unavailable=[...wanted.values()].filter(f=>f.status==='unavailable').length
 if(unavailable)warnings.push(unavailable+' used font variants lack exact downloadable font data; see library/fonts.json')
 return [...wanted.values()]
}
export function includeCapturedFonts(refs:AssetReferences,fonts:CapturedFont[]):AssetReferences{
 const urls=new Map(refs.urls.map(x=>[x.url,x]))
 const descriptors=[...(refs.fontDescriptors||[])]
 for(const f of fonts)if(f.url){
  if(!urls.has(f.url))urls.set(f.url,{url:f.url,usedBy:['library/fonts.json']})
  if(!descriptors.some(x=>x.url===f.url&&x.family===f.family&&x.weight===f.weight&&x.style===f.style))descriptors.push(f)
 }
 return {...refs,urls:[...urls.values()],fontDescriptors:descriptors}
}
