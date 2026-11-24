#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {unzipSync,zipSync,strToU8} from 'fflate'
import {createHash} from 'node:crypto'
import {compileCapturedArchive,type ArchiveFiles} from '../src/react-compiler.ts'
import {packCaptureDocuments,unpackCaptureDocuments,validMember,CJSON_DATA,CJSON_REF} from '../src/cjson.ts'

const argv=process.argv.slice(2)
if(argv.includes('--help')||argv.includes('-h')||!argv.length){
 console.log('framer-to-react compile <design.zip|directory|design.cjson> --out <new-directory>\nframer-to-react pack <design.zip|directory> --out <new.zip>\nframer-to-react unpack <design.zip|directory|design.cjson> --out <new-directory>\n\nThe compiler uses only the archive; published reference data is for verification only.')
 process.exit(0)
}
if(argv[0]==='--version'){console.log(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);process.exit(0)}
let command='compile',input:string,output:string
if(['compile','pack','unpack'].includes(argv[0])){
 [command,input]=argv
 if(argv.length!==4||argv[2]!=='--out')throw Error('Expected '+command+' <input> --out <output>; external evidence flags are no longer accepted')
 output=argv[3]
}else{
 if(argv.length!==2)throw Error('Usage: framer-to-react compile <input> --out <output>')
 ;[input,output]=argv
}
const inPath=path.resolve(input),outPath=path.resolve(output)
if(fs.existsSync(outPath)||outPath===inPath||outPath.startsWith(inPath+path.sep))throw Error('Output must be a new independent path outside source')
const root=fs.statSync(inPath).isDirectory()?inPath:inPath.endsWith('.cjson')?path.dirname(inPath):null
if(root&&(outPath===root||outPath.startsWith(root+path.sep)))throw Error('Output must be outside the source directory')
const raw:ArchiveFiles=Object.create(null)
const text=/\.(json|cjson|cjsonref|tsx?|css|md|svg|txt|mjs|js|jsx|html)$/i
const fingerprints=new Map<string,string>()
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
function add(k:string,b:Uint8Array){
 if(k.endsWith('/'))return
 if(k.startsWith('preview/')||/\/node_modules\//.test(k))return
 if(!validMember(k)||Object.hasOwn(raw,k))throw Error('Unsafe or duplicate archive path '+k)
 raw[k]=text.test(k)?new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b):new Uint8Array(b)
}
function read(file:string){const bytes=fs.readFileSync(file);fingerprints.set(file,digest(bytes));return bytes}
if(root){
 const walk=(dir:string):void=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name),rel=path.relative(root,p).split(path.sep).join('/')
  if(rel==='preview'||e.name==='node_modules'||e.name==='.git')continue
  if(e.isSymbolicLink())throw Error('Symlink in source '+rel)
  if(e.isDirectory())walk(p);else if(e.isFile())add(rel,read(p))
 }}
 if(inPath.endsWith('.cjson')&&path.basename(inPath)!==CJSON_DATA)throw Error('Expected design.cjson with design.cjsonref in the same capture directory')
 walk(root)
}else{
 const seen=new Set<string>();let expanded=0
 const archive=unzipSync(new Uint8Array(read(inPath)),{filter:file=>{
  const name=file.name
  if(name.endsWith('/'))return false
  if(!validMember(name)||seen.has(name))throw Error('Unsafe or duplicate ZIP member: '+name)
  seen.add(name)
  if(name.startsWith('preview/')||name.includes('/node_modules/'))return false
  expanded+=file.originalSize
  if(expanded>768*1024*1024||seen.size>100000)throw Error('ZIP expansion budget exceeded')
  return true
 }})
 for(const [k,v] of Object.entries(archive))add(k,v)
}
const verifySource=()=>{for(const [p,hash] of fingerprints)if(digest(fs.readFileSync(p))!==hash)throw Error('Source changed while processing: '+p)}
const parent=path.dirname(outPath);fs.mkdirSync(parent,{recursive:true})
if(command==='pack'){
 const packed=await packCaptureDocuments(raw)
 const zip=zipSync(Object.fromEntries(Object.entries(packed).map(([k,v])=>[k,typeof v==='string'?strToU8(v):v])),{level:6})
 verifySource()
 fs.writeFileSync(outPath,zip,{flag:'wx'})
 console.log(JSON.stringify({format:'CJSON/1',bytes:zip.length,output:outPath,sourceUnchanged:true}))
}else{
 const result=command==='compile'?await compileCapturedArchive(raw):null
 const files=result?.files??await unpackCaptureDocuments(raw)
 const stage=fs.mkdtempSync(path.join(parent,'.framer-output-'))
 try{
  for(const [rel,content] of Object.entries(files)){
   const name=result?rel.replace(/^preview\//,''):rel
   const dest=path.resolve(stage,name)
   if(!validMember(name)||!dest.startsWith(stage+path.sep))throw Error('Unsafe output path')
   fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
  }
  verifySource()
  if(fs.existsSync(outPath))throw Error('Output appeared during compilation')
  fs.renameSync(stage,outPath)
 }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
 console.log(JSON.stringify({...(result?{routes:result.report.routes,variants:result.report.emittedVariants,captureIssues:result.report.captureIssues.length,build:result.report.build.status,fidelity:result.report.fidelity.status}:{}),output:outPath,sourceUnchanged:true}))
}
