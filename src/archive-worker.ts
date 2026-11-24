import {encodeCaptureZip} from './capture-zip.ts'
import type {ArchiveFiles} from './types.ts'
const worker=globalThis as unknown as {onmessage:(event:MessageEvent<{files:ArchiveFiles;compressed:boolean}>)=>void;postMessage:(data:unknown,transfer?:Transferable[])=>void}
worker.onmessage=async ({data})=>{
 try{
  const {zip,stats}=await encodeCaptureZip(data.files,data.compressed)
  worker.postMessage({ok:true,zip,stats},[zip.buffer])
 }catch(error){worker.postMessage({ok:false,error:String(error)})}
}
