import {EDITOR_NODES,EDITOR_ICON_CONTROLS,parseEditorNodes} from '../src/editor-nodes.ts'
/** Capture-stage assembly, not compiler evidence injection. Original input bytes remain immutable. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate'
import {packCaptureDocuments,unpackCaptureDocuments,validMember} from '../src/cjson.ts'
import {EDITOR_SOURCE,parseEditorSource} from '../src/editor-source.ts'
import type {ArchiveFiles,Manifest} from '../src/types.ts'
const [input,editor,output,nodeFile,controlFile]=process.argv.slice(2)
if(!input||!editor||!output||![5,7].includes(process.argv.length))throw Error('Usage: node scripts/compose-editor-capture.ts <plugin.zip> <editor-source.json> <new.zip> [editor-nodes.json editor-icon-controls.json]')
if(fs.existsSync(output)||path.resolve(input)===path.resolve(output)||path.resolve(editor)===path.resolve(output))throw Error('Output must be a new archive')
const original=fs.readFileSync(input),editorBytes=fs.readFileSync(editor),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const raw:ArchiveFiles=Object.create(null),seen=new Set<string>()
let size=0
const entries=unzipSync(original,{filter:f=>{
 if(f.name.endsWith('/'))return false
 if(!validMember(f.name)||seen.has(f.name))throw Error('Unsafe capture member')
 seen.add(f.name);size+=f.originalSize
 if(size>768*1024*1024||seen.size>100000)throw Error('Capture size limit exceeded')
 return !f.name.startsWith('preview/')
}})
for(const [k,v] of Object.entries(entries))raw[k]=/\.(json|cjson|cjsonref|tsx?|css|md|svg|txt|mjs|js|jsx|html)$/i.test(k)?strFromU8(v):v
const decoded=await unpackCaptureDocuments(raw)
if(decoded[EDITOR_SOURCE]!==undefined)throw Error('Archive already includes an editor capture')
const manifest=JSON.parse(String(decoded['manifest.json'])) as Manifest
const editorText=new TextDecoder('utf-8',{fatal:true}).decode(editorBytes)
const source=parseEditorSource(JSON.parse(editorText),manifest)
 const extra:ArchiveFiles={};const extraFingerprints:Record<string,string>={}
 if(nodeFile&&controlFile){const nodeBytes=fs.readFileSync(nodeFile),controlBytes=fs.readFileSync(controlFile);const nt=new TextDecoder('utf-8',{fatal:true}).decode(nodeBytes),ct=new TextDecoder('utf-8',{fatal:true}).decode(controlBytes);parseEditorNodes(JSON.parse(nt),source,manifest);JSON.parse(ct);extra[EDITOR_NODES]=nt;extra[EDITOR_ICON_CONTROLS]=ct;extraFingerprints[EDITOR_NODES]=sha(nodeBytes);extraFingerprints[EDITOR_ICON_CONTROLS]=sha(controlBytes)}
const captured={...decoded,...extra,[EDITOR_SOURCE]:editorText,'library/editor-capture-provenance.json':JSON.stringify({format:'framer-to-agent/editor-capture-provenance-v1',pluginZipSha256:sha(original),editorSourceSha256:sha(editorBytes),extraFingerprints,assembledAt:new Date().toISOString()})}
const packed=await packCaptureDocuments(captured)
const zip=zipSync(Object.fromEntries(Object.entries(packed).map(([k,v])=>[k,typeof v==='string'?strToU8(v):v])),{level:6})
if(sha(fs.readFileSync(input))!==sha(original)||sha(fs.readFileSync(editor))!==sha(editorBytes)||(nodeFile&&sha(fs.readFileSync(nodeFile))!==extraFingerprints[EDITOR_NODES])||(controlFile&&sha(fs.readFileSync(controlFile))!==extraFingerprints[EDITOR_ICON_CONTROLS]))throw Error('Source changed during assembly')
fs.writeFileSync(output,zip,{flag:'wx'})
console.log(JSON.stringify({output,bytes:zip.length,pluginZipSha256:sha(original),editorSourceSha256:sha(editorBytes),sourceUnchanged:true}))

