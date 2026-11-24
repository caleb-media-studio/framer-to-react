import test from 'node:test'
import assert from 'node:assert/strict'
import {packagePage} from '../src/pages.mjs'
import {compileReactArchive} from '../src/react-compiler.mjs'
const root={id:'page',kind:'WebPageNode',attributes:{name:'Home'},children:[{id:'desktop',kind:'FrameNode',attributes:{name:'Desktop',isBreakpoint:true,isPrimaryBreakpoint:true,width:'1200px',height:'fit-content'},children:[{id:'text',kind:'TextNode',text:'Original content',attributes:{name:'Heading'}},{id:'image',kind:'ImageNode',attributes:{name:'Image',image:'https://example.test/picture.png',width:'100px',height:'100px'}}]}]}
function archive(){
 const item=packagePage({id:'page',path:'/',type:'web'},{roots:[root],nodeCount:4,truncated:false,warnings:[]},{rawOnly:true})
 return {...item.files,'manifest.json':JSON.stringify({format:'framer-to-agent/folder-export-v5',captureOnly:true,pages:[item.record],requestedPages:1,failures:[]}),
 'assets/manifest.json':JSON.stringify({assets:[{url:'https://example.test/picture.png',path:'assets/picture.png',bundled:true}]}),'assets/picture.png':new Uint8Array([1,2,3])}
}
test('raw-only page archive independently compiles from JSON, never requiring draft JSX',()=>{
 const raw=archive(),before=JSON.stringify(raw)
 assert.ok(!Object.keys(raw).some(p=>p.endsWith('Component.tsx')||p.endsWith('component.css')))
 const {files,report}=compileReactArchive(raw)
 assert.equal(report.emittedVariants,1)
 assert.equal(report.fidelity.status,'unverified')
 assert.equal(report.build.status,'not-run')
 const generated=Object.entries(files).find(([p])=>p.endsWith('/breakpoints/1200-0/Component.tsx'))[1]
 assert.match(generated,/Original content/)
 assert.match(generated,/\/assets\/picture.png/)
 assert.deepEqual(files['preview/public/assets/picture.png'],raw['assets/picture.png'])
 assert.equal(JSON.stringify(raw),before)
})
test('compiler ignores stale generated drafts and refuses missing captured breakpoint files',()=>{
 const raw=archive()
 const m=JSON.parse(raw['manifest.json']),dir=m.pages[0].breakpoints[0].directory
 raw[dir+'/Component.tsx']='throw Error("stale")'
 const {files}=compileReactArchive(raw)
 assert.ok(!Object.values(files).some(x=>typeof x==='string'&&x.includes('throw Error("stale")')))
 delete raw[dir+'/design.json']
 assert.throws(()=>compileReactArchive(raw),/Missing/)
})
test('capture issues are reported separately from rendering and unsafe archive members are rejected',()=>{
 const raw=archive();delete raw['assets/picture.png']
 const {report}=compileReactArchive(raw)
 assert.ok(report.captureIssues.some(i=>i.severity==='error'&&i.message.includes('asset absent')))
 raw['../escape']='unsafe'
 assert.throws(()=>compileReactArchive(raw),/Unsafe archive member/)
})
