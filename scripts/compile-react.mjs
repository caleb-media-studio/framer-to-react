#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {unzipSync} from 'fflate'
import {compileReactArchive} from '../src/react-compiler.mjs'
import {prepareOfficialLayouts} from '../src/official-layouts.mjs'
const [input,output,...args]=process.argv.slice(2)
if(!input||!output||args.length%2||args.some((x,i)=>i%2===0&&!['--evidence','--layout-source'].includes(x))){console.error('Usage: node scripts/compile-react.mjs <design.zip or extracted directory> <new-output-directory> [--evidence <directory>] [--layout-source <official.json>]');process.exit(2)}
const inPath=path.resolve(input),outPath=path.resolve(output)
if(fs.existsSync(outPath)||outPath===inPath||outPath.startsWith(inPath+path.sep))throw Error('Output must be a new independent directory, outside source')
const raw=Object.create(null)
const text=/\.(json|tsx?|css|md|svg|txt|mjs|js|jsx|html)$/i
function add(k,b){if(k.endsWith('/'))return;if(k.startsWith('preview/')||/\/node_modules\//.test(k))return;if(k.startsWith('/')||k.includes('\\')||k.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe archive path '+k);raw[k]=text.test(k)?new TextDecoder().decode(b):new Uint8Array(b)}
if(fs.statSync(inPath).isDirectory()){
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),rel=path.relative(inPath,p).split(path.sep).join('/');if(rel==='preview'||e.name==='node_modules')continue;if(e.isSymbolicLink())throw Error('Symlink in source '+rel);if(e.isDirectory())walk(p);else if(e.isFile())add(rel,fs.readFileSync(p))}}
 walk(inPath)
}else{
 const archive=unzipSync(new Uint8Array(fs.readFileSync(inPath)))
 for(const [k,v] of Object.entries(archive))add(k,v)
}
const evidence=[]
const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]))
if(options['--evidence']){
 const manifest=JSON.parse(raw['manifest.json']),pages=manifest.pages||[]
 for(const f of fs.readdirSync(options['--evidence'])){
  if(!/^.+\.\d+\.json$/.test(f))continue
  const doc=JSON.parse(fs.readFileSync(path.join(options['--evidence'],f),'utf8'))
  const candidates=pages.filter(p=>p.breakpoints?.some(b=>b.id===doc.breakpointId))
  if(candidates.length===1)evidence.push({route:candidates[0].path,doc,file:f})
 }
}
const layoutSource=options['--layout-source']?await prepareOfficialLayouts(JSON.parse(fs.readFileSync(options['--layout-source'],'utf8'))):null
const {files,report}=compileReactArchive(raw,{evidence,layoutSource})
// Atomic staging preserves source and never overwrites an existing destination.
const parent=path.dirname(outPath);fs.mkdirSync(parent,{recursive:true});const stage=fs.mkdtempSync(path.join(parent,'.react-compile-'))
try{for(const [rel,content] of Object.entries(files)){
 const name=rel.replace(/^preview\//,'');const dest=path.resolve(stage,name)
 if(!dest.startsWith(stage+path.sep))throw Error('Unsafe compiler output')
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
}
fs.renameSync(stage,outPath)
}catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
console.log(JSON.stringify({routes:report.routes,snapshots:report.snapshots,variants:report.emittedVariants,captureIssues:report.captureIssues.length,appliedReferenceNodes:report.appliedReferenceNodes,build:report.build.status,fidelity:report.fidelity.status,output:outPath}))
