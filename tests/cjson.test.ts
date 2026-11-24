import test from 'node:test'
import assert from 'node:assert/strict'
import {packCaptureDocuments,unpackCaptureDocuments,CJSON_DATA,CJSON_REF} from '../src/cjson.ts'
import {compileCapturedArchive,compileReactArchive} from '../src/react-compiler.ts'
import type {ArchiveFiles} from '../src/types.ts'
import {createHash} from 'node:crypto'
const manifest={format:'framer-to-agent/selection-export-v6',captureOnly:true,pages:[{path:'/',directory:'',breakpoints:[]}]}
const make=():ArchiveFiles=>({
 'manifest.json':JSON.stringify(manifest,null,2),
 'design.json':JSON.stringify({roots:[{id:'root',kind:'FrameNode',attributes:{width:'1200px',height:'fit-content'},children:[{id:'label',kind:'TextNode',text:'Source label',attributes:{font:{family:'Inter',weight:600,style:'normal'},fontSize:'12px',color:'#9198a1'}}]}]},null,2),
 'assets/manifest.json':JSON.stringify({assets:[],warnings:[]},null,2),
 'library/code/original.tsx':'export function Original(){return <div>Original</div>}\n',
 'assets/example.png':new Uint8Array([0,128,255,3]),
})
const asText=(v:string|Uint8Array)=>{assert.equal(typeof v,'string');return v as string}
test('CJSON deterministic lossless round trip including repeated structures and arbitrary JSON keys',async()=>{
 const raw=make()
 raw['library/data.json']='{"__proto__":{"safe":true},"constructor":"value","nested":[[1,2],null,false,{},[]],"unicode":"日本語 العربية 😊","negativeZero":-0,"repeat":"a repeated very long string","repeat2":"a repeated very long string"}'
 const before=structuredClone(raw)
 const packed=await packCaptureDocuments(raw),again=await packCaptureDocuments(raw)
 assert.equal(packed[CJSON_DATA],again[CJSON_DATA]);assert.equal(packed[CJSON_REF],again[CJSON_REF])
 const decoded=await unpackCaptureDocuments(packed)
 for(const [k,v] of Object.entries(raw)){
  if(k.endsWith('.json'))assert.deepEqual(JSON.parse(asText(decoded[k])),JSON.parse(asText(v)))
  else assert.deepEqual(decoded[k],v)
 }
 assert.equal(Object.is(JSON.parse(asText(decoded['library/data.json'])).negativeZero,-0),true)
 assert.deepEqual(raw,before)
 assert.equal(Object.hasOwn(Object.prototype,'safe'),false)
})
test('plain and CJSON archives compile identically without external evidence',async()=>{
 const raw=make(),packed=await packCaptureDocuments(raw)
 const a=compileReactArchive(raw),b=await compileCapturedArchive(packed)
 assert.deepEqual(a,b)
 assert.equal(a.report.sourceOnly,true)
 assert.throws(()=>Reflect.apply(compileReactArchive,undefined,[raw,{evidence:[]}]),/only the immutable capture/)
})
test('rejects mismatched reference, missing pair, mixed documents and malformed tokens',async()=>{
 const packed=await packCaptureDocuments(make())
 const data=asText(packed[CJSON_DATA]),ref=asText(packed[CJSON_REF])
 await assert.rejects(unpackCaptureDocuments({...packed,[CJSON_REF]:ref+' '}),/checksum/)
 await assert.rejects(unpackCaptureDocuments({[CJSON_DATA]:data}),/pair/)
 await assert.rejects(unpackCaptureDocuments({...packed,'manifest.json':JSON.stringify(manifest)}),/Mixed/)
 const d=JSON.parse(data);d.documents[0][1]=[-2,9999999]
 await assert.rejects(unpackCaptureDocuments({...packed,[CJSON_DATA]:JSON.stringify(d)}),/dictionary reference/)
 d.documents[0][1]=[-1];d.documents[0][0]='../escape.json'
 await assert.rejects(unpackCaptureDocuments({...packed,[CJSON_DATA]:JSON.stringify(d)}),/Invalid or duplicate/)
 const corrupt=JSON.parse(ref);corrupt.shapes=[[0,0]];const r=JSON.stringify(corrupt)
 const payload=JSON.parse(data);payload.referenceSha256=createHash('sha256').update(r).digest('hex')
 await assert.rejects(unpackCaptureDocuments({...packed,[CJSON_REF]:r,[CJSON_DATA]:JSON.stringify(payload)}),/Duplicate key/)
})
test('rejects nonrepresentable integers and already-packed archives',async()=>{
 const raw=make();raw['library/unsafe.json']='{"number":9007199254740993}'
 await assert.rejects(packCaptureDocuments(raw),/safe JSON integers/)
 await assert.rejects(packCaptureDocuments(await packCaptureDocuments(make())),/already CJSON/)
})
test('compiler ignores stale verification overlays and node reference fields',()=>{
 const raw=make(),a=compileReactArchive(raw)
 const d=JSON.parse(asText(raw['design.json']));d.roots[0].children[0].reference={textStyle:{fontSize:'99px',color:'red'}}
 raw['design.json']=JSON.stringify(d);raw['reference/overlay.json']=JSON.stringify({nodes:{label:{textStyle:{fontSize:'99px'}}}})
 assert.deepEqual(compileReactArchive(raw),a)
})

test('stale legacy reference vector cannot suppress a captured icon identity',async()=>{
 const raw=make(),d=JSON.parse(asText(raw['design.json']))
 const icon={id:'arrow',kind:'IconNode',attributes:{icon:'arrow-right',set:'Lucide',width:'24px',height:'24px'}}
 d.roots[0].children.push(icon)
 raw['design.json']=JSON.stringify(d)
 const expected=await compileCapturedArchive(raw)
 const paths=Object.keys(expected.files).filter(k=>k.startsWith('preview/public/assets/vectors/')&&k.endsWith('.svg'))
 assert.ok(paths.length>0,'captured identity resolves a real SVG')
 const reference={vector:{viewBox:'0 0 24 24',shapes:[{tag:'path',attrs:{d:'M0 0L10 10',stroke:'#fff'}}]}}
 d.roots[0].children.at(-1).reference=reference
 const stale={...raw,'design.json':JSON.stringify(d)}
 assert.deepEqual(await compileCapturedArchive(stale),expected)
 assert.deepEqual(await compileCapturedArchive(await packCaptureDocuments(stale)),expected)
})
