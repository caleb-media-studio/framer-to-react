import {zipSync,strToU8} from 'fflate'
import {packCaptureDocuments} from './cjson.ts'
import type {ArchiveFiles} from './types.ts'
const worker=globalThis as unknown as {onmessage:(event:MessageEvent<{files:ArchiveFiles;compressed:boolean}>)=>void;postMessage:(data:unknown,transfer?:Transferable[])=>void}
worker.onmessage=async ({data})=>{
 try{
  const files=data.compressed?await packCaptureDocuments(data.files):data.files
  const entries=Object.fromEntries(Object.entries(files).map(([p,v])=>[p,typeof v==='string'?strToU8(v):v]))
  const zip=zipSync(entries,{level:6})
  worker.postMessage({ok:true,zip},[zip.buffer])
 }catch(error){worker.postMessage({ok:false,error:String(error)})}
}
