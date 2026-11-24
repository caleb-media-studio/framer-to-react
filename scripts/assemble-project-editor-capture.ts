/** Assemble original-source capture documents into a NEW archive, never editing inputs. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate'
import {packCaptureDocuments,unpackCaptureDocuments,validMember} from '../src/cjson.ts'
import {EDITOR_SOURCE,parseEditorSource} from '../src/editor-source.ts'
import {EDITOR_ICON_CONTROLS} from '../src/editor-nodes.ts'
import {EDITOR_PROJECT,readProjectEditorCapture,type EditorPageCapture,type ProjectEditorIndex} from '../src/project-editor-capture.ts'
import type {ArchiveFiles,Manifest} from '../src/types.ts'
const [input,metadata,controls,shards,output,...flags]=process.argv.slice(2)
if(!input||!metadata||!controls||!shards||!output||flags.some(f=>f!=='--require-all'))throw Error('Usage: assemble-project-editor-capture.ts <plugin.zip> <editor-metadata.json> <icon-controls.json> <page-capture-dir> <new.zip> [--require-all]')
if(fs.existsSync(output))throw Error('Output archive must be new')
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const inputs=new Map<string,string>()
function read(p:string){const data=fs.readFileSync(p);inputs.set(p,sha(data));return data}
const original=read(input),raw:ArchiveFiles=Object.create(null),seen=new Set<string>()
let size=0
for(const [k,v] of Object.entries(unzipSync(original,{filter:f=>{
 if(f.name.endsWith('/'))return false
 if(!validMember(f.name)||seen.has(f.name))throw Error('Unsafe capture member')
 seen.add(f.name);size+=f.originalSize
 if(size>768*1024*1024||seen.size>100000)throw Error('Capture size limit exceeded')
 return !f.name.startsWith('preview/')
}})))raw[k]=/\.(json|cjson|cjsonref|tsx?|css|md|svg|txt|mjs|js|jsx|html)$/i.test(k)?strFromU8(v):v
const source=await unpackCaptureDocuments(raw)
if(source[EDITOR_SOURCE]!==undefined||source[EDITOR_PROJECT]!==undefined)throw Error('Original plugin archive already includes an editor capture')
const manifest=JSON.parse(String(source['manifest.json'])) as Manifest
const originalMetadata=parseEditorSource(JSON.parse(strFromU8(read(metadata))),manifest)
const base={...originalMetadata,scope:{pages:[],layouts:'all' as const},text:[]}
source[EDITOR_SOURCE]=JSON.stringify(base)
source[EDITOR_ICON_CONTROLS]=strFromU8(read(controls))
const index:ProjectEditorIndex={format:'framer-to-agent/editor-project-v1',projectId:base.projectId,branch:base.branch,pages:[]}
for(const p of manifest.pages??[]){
 if(typeof p.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(p.id))throw Error('Unsafe page ID')
 const file=path.join(shards,p.id+'.json')
 if(!fs.existsSync(file))continue
 const bytes=read(file),doc=JSON.parse(strFromU8(bytes)) as EditorPageCapture
 if(doc.pageId!==p.id||doc.path!==p.path)throw Error('Capture file identity mismatch')
 const member='library/editor-pages/'+p.id+'.json'
 source[member]=strFromU8(bytes)
 index.pages.push({id:p.id,path:p.path,file:member})
}
if(!index.pages.length)throw Error('No captured editor pages')
const missing=(manifest.pages??[]).filter(p=>!index.pages.some(e=>e.id===p.id)).map(p=>p.path)
if(flags.includes('--require-all')&&missing.length)throw Error('Incomplete project capture: '+missing.join(', '))
source[EDITOR_PROJECT]=JSON.stringify(index)
const validated=readProjectEditorCapture(source,manifest)
source['library/editor-capture-provenance.json']=JSON.stringify({format:'framer-to-agent/editor-project-provenance-v1',pluginZipSha256:sha(original),metadataSha256:inputs.get(metadata),iconControlsSha256:inputs.get(controls),pageSha256:Object.fromEntries(index.pages.map(p=>[p.id,inputs.get(path.join(shards,p.id+'.json'))])),missingRoutes:missing})
const packed=await packCaptureDocuments(source)
const zip=zipSync(Object.fromEntries(Object.entries(packed).map(([k,v])=>[k,typeof v==='string'?strToU8(v):v])),{level:6})
for(const [file,digest] of inputs)if(sha(fs.readFileSync(file))!==digest)throw Error('Source changed during capture assembly')
fs.writeFileSync(output,zip,{flag:'wx'})
console.log(JSON.stringify({output,bytes:zip.length,totalRoutes:manifest.pages?.length,coveredRoutes:index.pages.length,missingRoutes:missing,textRecords:validated.source?.text.length,typedRecords:validated.nodes?.nodes.length,sourceUnchanged:true}))
