import fs from 'node:fs'
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate'
import {isCaptureDocument,packCaptureDocuments,validMember} from '../src/cjson.ts'
import type {ArchiveFiles} from '../src/types.ts'
const input=process.argv[2]
if(!input)throw Error('Usage: bun scripts/benchmark-cjson.ts design.zip')
let expanded=0
const all=unzipSync(fs.readFileSync(input),{filter:file=>{
 if(file.name.endsWith('/')||file.name.startsWith('preview/'))return false
 if(!validMember(file.name))throw Error('Unsafe member')
 expanded+=file.originalSize
 if(expanded>768*1024*1024)throw Error('Expansion budget exceeded')
 return true
}})
const plain:Record<string,Uint8Array>={},compact:Record<string,Uint8Array>={},raw:ArchiveFiles={}
for(const [k,v] of Object.entries(all)){
 if(k.endsWith('/')||k.startsWith('preview/')||k.includes('/node_modules/'))continue
 plain[k]=v
 compact[k]=isCaptureDocument(k)?strToU8(JSON.stringify(JSON.parse(strFromU8(v)))):v
 raw[k]=isCaptureDocument(k)?strFromU8(v):v
}
const bytes=(o:Record<string,Uint8Array>)=>Object.values(o).reduce((n,v)=>n+v.byteLength,0)
const t=performance.now(),packed=await packCaptureDocuments(raw),packMs=performance.now()-t
const compressed=Object.fromEntries(Object.entries(packed).map(([k,v])=>[k,typeof v==='string'?strToU8(v):v]))
const levels=Object.fromEntries(Object.entries({plain,compact,cjson:compressed}).map(([name,obj])=>[name,{raw:bytes(obj),zip:zipSync(obj,{level:6}).byteLength}]))
console.log(JSON.stringify({sameMembers:true,zipLevel:6,levels,packMs},null,2))
