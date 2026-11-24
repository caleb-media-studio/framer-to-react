/**
 * CJSON/1: deterministic dictionary-coded JSON values. Browser, Bun and Node.
 * This is a transport encoding, never a source transformation.
 */
import type {ArchiveFiles} from './types.ts'
export const CJSON_DATA='design.cjson'
export const CJSON_REF='design.cjsonref'
export const CJSON_FORMAT='framer-to-react/cjson-v1'
export const CJSON_REF_FORMAT='framer-to-react/cjsonref-v1'
type JSONValue=null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue}
type Encoded=null|boolean|number|string|Encoded[]
interface Dictionary {format:typeof CJSON_REF_FORMAT;keys:string[];shapes:number[][];strings:string[]}
interface Data {format:typeof CJSON_FORMAT;referenceSha256:string;documents:[string,Encoded][]}
const MAX_DEPTH=128,MAX_VALUES=20_000_000,MAX_BYTES=512*1024*1024,MAX_DICT=1_000_000
const utf8=new TextEncoder()
export function isCaptureDocument(path:string):boolean {
 return path==='manifest.json'||path==='diagnostics.json'||path==='design.json'||/^pages\/.+\/design\.json$/.test(path)||(/^library\/.+\.json$/.test(path)&&!path.startsWith('library/code/'))||path==='assets/manifest.json'
}
export function validMember(path:unknown):path is string {
 return typeof path==='string'&&path.length>0&&path.length<=2048&&!path.startsWith('/')&&!path.includes('\\')&&path.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'&&!/[\x00-\x1f]/.test(p))
}
const sha256=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(s))),b=>b.toString(16).padStart(2,'0')).join('')
const size=(s:string)=>utf8.encode(s).length
function checkNumber(n:number){if(!Number.isFinite(n)||Number.isInteger(n)&&!Number.isSafeInteger(n))throw Error('CJSON requires finite numbers and safe JSON integers')}
function stringIndex(s:string,m:Map<string,number>,list:string[]){let i=m.get(s);if(i===undefined){i=list.length;list.push(s);m.set(s,i)}return i}
function limitCounter(){let n=0;return(depth:number)=>{if(depth>MAX_DEPTH||++n>MAX_VALUES)throw Error('CJSON value/depth limit exceeded')}}
/** Only capture-owned JSON documents are encoded. Code and binary assets stay byte-for-byte unchanged. */
export async function packCaptureDocuments(files:Readonly<ArchiveFiles>):Promise<ArchiveFiles>{
 if(CJSON_DATA in files||CJSON_REF in files)throw Error('Archive is already CJSON or contains reserved names')
 const docs:[string,JSONValue][]=[]
 const counts=new Map<string,number>(),keys:string[]=[],keyMap=new Map<string,number>(),shapes:number[][]=[],shapeMap=new Map<string,number>()
 const tick=limitCounter()
 const count=(v:JSONValue,depth=0):void=>{
  tick(depth)
  if(typeof v==='string'){counts.set(v,(counts.get(v)||0)+1);return}
  if(typeof v==='number'){checkNumber(v);return}
  if(v!==null&&typeof v==='object'){
   if(Array.isArray(v))v.forEach(x=>count(x,depth+1))
   else for(const k of Object.keys(v)){stringIndex(k,keyMap,keys);count(v[k],depth+1)}
  }
 }
 const out:ArchiveFiles=Object.create(null)
 for(const name of Object.keys(files).sort()){
  if(!validMember(name))throw Error('Unsafe archive member: '+name)
  const value=files[name]
  if(!isCaptureDocument(name)){out[name]=value;continue}
  if(typeof value!=='string'||size(value)>MAX_BYTES)throw Error('Invalid capture document: '+name)
  const parsed=JSON.parse(value) as JSONValue
  count(parsed);docs.push([name,parsed])
 }
 if(!docs.some(([name])=>name==='manifest.json'))throw Error('CJSON archive requires manifest.json')
 // Repeated values only, with conservative savings estimate; stable ordering by frequency then code unit.
 const strings=[...counts].filter(([s,n])=>n>=2&&size(JSON.stringify(s))>=12&&n*(size(JSON.stringify(s))-12)>size(JSON.stringify(s))+1)
 .sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0)).map(([s])=>s)
 const stringMap=new Map(strings.map((s,i)=>[s,i]))
 const encode=(v:JSONValue):Encoded=>{
  if(typeof v==='string'){const i=stringMap.get(v);return i===undefined?v:[-2,i]}
  if(typeof v==='number'&&Object.is(v,-0))return [-3]
  if(v===null||typeof v!=='object')return v
  if(Array.isArray(v))return [-1,...v.map(encode)]
  const shape=Object.keys(v).map(k=>keyMap.get(k)!)
  const sig=shape.join(',')
  let i=shapeMap.get(sig)
  if(i===undefined){i=shapes.length;shapes.push(shape);shapeMap.set(sig,i)}
  return [i,...Object.values(v).map(encode)]
 }
 const encoded=docs.map(([name,v]):[string,Encoded]=>[name,encode(v)])
 if(Math.max(keys.length,shapes.length,strings.length)>MAX_DICT)throw Error('CJSON dictionary limit exceeded')
 const ref:Dictionary={format:CJSON_REF_FORMAT,keys,shapes,strings}
 const reference=JSON.stringify(ref)
 const data:Data={format:CJSON_FORMAT,referenceSha256:await sha256(reference),documents:encoded}
 out[CJSON_REF]=reference;out[CJSON_DATA]=JSON.stringify(data)
 return out
}
const index=(n:unknown,length:number):number=>{if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>=length)throw Error('Invalid CJSON dictionary reference');return n}
const list=(v:unknown):unknown[]=>{if(!Array.isArray(v)||v.length>MAX_DICT)throw Error('Invalid CJSON dictionary');return v}
const uniqueStrings=(v:unknown):string[]=>{const a=list(v);if(a.some(s=>typeof s!=='string')||new Set(a).size!==a.length)throw Error('Invalid CJSON string dictionary');return a as string[]}
/** Verify the exact reference bytes before decoding. No external lookup or network. */
export async function unpackCaptureDocuments(files:Readonly<ArchiveFiles>):Promise<ArchiveFiles>{
 const hasData=Object.hasOwn(files,CJSON_DATA),hasRef=Object.hasOwn(files,CJSON_REF)
 if(!hasData&&!hasRef)return Object.assign(Object.create(null),files)
 const payload=files[CJSON_DATA],reference=files[CJSON_REF]
 if(typeof payload!=='string'||typeof reference!=='string'||size(payload)>MAX_BYTES||size(reference)>MAX_BYTES)throw Error('Incomplete or oversized CJSON pair')
 const d=JSON.parse(payload) as Data,ref=JSON.parse(reference) as Dictionary
 if(d?.format!==CJSON_FORMAT||ref?.format!==CJSON_REF_FORMAT)throw Error('Unsupported CJSON version')
 if(d.referenceSha256!==await sha256(reference))throw Error('CJSON reference checksum mismatch')
 const keys=uniqueStrings(ref.keys),strings=uniqueStrings(ref.strings)
 const shapes=list(ref.shapes).map(s=>{const a=list(s).map(i=>index(i,keys.length));if(new Set(a).size!==a.length)throw Error('Duplicate key in CJSON shape');return a})
 const tick=limitCounter()
 let decodedStringBytes=0
 const string=(s:string)=>{decodedStringBytes+=s.length*2;if(decodedStringBytes>MAX_BYTES)throw Error('CJSON decoded string budget exceeded');return s}
 const decode=(v:unknown,depth=0):JSONValue=>{
  tick(depth)
  if(v===null||typeof v==='boolean')return v
  if(typeof v==='number'){checkNumber(v);return v}
  if(typeof v==='string')return string(v)
  if(!Array.isArray(v)||!v.length)throw Error('Invalid CJSON value')
  const [tag,...body]=v
  if(tag===-1)return body.map(x=>decode(x,depth+1))
  if(tag===-2){if(body.length!==1)throw Error('Invalid CJSON string reference');return string(strings[index(body[0],strings.length)])}
  if(tag===-3){if(body.length)throw Error('Invalid CJSON negative zero');return -0}
  const shape=shapes[index(tag,shapes.length)]
  if(shape.length!==body.length)throw Error('CJSON object arity mismatch')
  const obj:{[key:string]:JSONValue}=Object.create(null)
  for(let i=0;i<shape.length;i++){const key=string(keys[shape[i]]);obj[key]=decode(body[i],depth+1)}
  return obj
 }
 const out:ArchiveFiles=Object.create(null)
 for(const [k,v] of Object.entries(files)){
  if(!validMember(k))throw Error('Unsafe archive member: '+k)
  if(k===CJSON_DATA||k===CJSON_REF)continue
  if(isCaptureDocument(k))throw Error('Mixed CJSON/plain capture documents are ambiguous')
  out[k]=v
 }
 if(!Array.isArray(d.documents)||d.documents.length>MAX_DICT)throw Error('Invalid CJSON document list')
 let outputBytes=0
 // JSON.stringify normalizes whitespace, but does not modify logical values. Preserve -0 explicitly.
 const stringify=(v:JSONValue):string=>v===null||typeof v!=='object'?(typeof v==='number'&&Object.is(v,-0)?'-0':JSON.stringify(v)):Array.isArray(v)?'['+v.map(stringify).join(',')+']':'{'+Object.keys(v).map(k=>JSON.stringify(k)+':'+stringify(v[k])).join(',')+'}'
 for(const row of d.documents){
  if(!Array.isArray(row)||row.length!==2||!validMember(row[0])||!isCaptureDocument(row[0])||Object.hasOwn(out,row[0]))throw Error('Invalid or duplicate CJSON document')
  const decoded=stringify(decode(row[1]));outputBytes+=size(decoded)
  if(outputBytes>MAX_BYTES)throw Error('CJSON decoded document budget exceeded')
  out[row[0]]=decoded
 }
 if(!Object.hasOwn(out,'manifest.json'))throw Error('Missing decoded manifest.json')
 return out
}
