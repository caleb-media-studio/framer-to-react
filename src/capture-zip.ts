import {zipSync,strToU8} from 'fflate'
import {packCaptureDocuments} from './cjson.ts'
import type {ArchiveFiles} from './types.ts'
export interface CompressionStats {plainZipBytes:number;cjsonZipBytes:number;elapsedMs:number}
const zip=(files:Readonly<ArchiveFiles>)=>zipSync(Object.fromEntries(Object.entries(files).map(([p,v])=>[p,typeof v==='string'?strToU8(v):v])),{level:6})
/** Benchmark the identical capture, same ZIP level, without a second SDK traversal. */
export async function encodeCaptureZip(files:Readonly<ArchiveFiles>,compressed:boolean){
 if(!compressed)return {zip:zip(files),stats:undefined}
 const start=performance.now()
 const plainZipBytes=zip(files).byteLength
 const encoded=zip(await packCaptureDocuments(files))
 const stats:CompressionStats={plainZipBytes,cjsonZipBytes:encoded.byteLength,elapsedMs:Math.round(performance.now()-start)}
 return {zip:encoded,stats}
}
