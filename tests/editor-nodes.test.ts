import test from 'node:test'
import assert from 'node:assert/strict'
import {compileCapturedArchive} from '../src/react-compiler.ts'
import {packCaptureDocuments} from '../src/cjson.ts'
import {svgPath} from '../src/vectors.ts'
import type {ArchiveFiles} from '../src/types.ts'
test('typed editor nodes reconcile plugin icon instances, real vector artwork, closed overlays and edge borders by exact IDs',async()=>{
 const manifest={format:'framer-to-agent/folder-export-v6',pages:[{id:'p',path:'/app',directory:'pages/app',breakpoints:[{id:'bp',directory:'pages/app/breakpoints/bp',width:1200}]}]}
 const root={id:'bp',kind:'FrameNode',attributes:{width:'1200px',height:'fit-content',layout:'stack'},children:[{id:'icon',kind:'ComponentInstanceNode',attributes:{componentIdentifier:'module:test:default',width:'15px',height:'fit-content'}},{id:'overlay',kind:'FrameNode',attributes:{visible:true},children:[{id:'label',kind:'TextNode',text:'Hidden overlay content'}]},{id:'shape',kind:'ShapeContainerNode',children:[{id:'path',kind:'PathNode'}]},{id:'frame',kind:'FrameNode',attributes:{border:{width:'1px',style:'solid',color:'#000000'},width:'33%'}}]}
 const editor={format:'framer-to-agent/editor-source-v1',adapter:'framer-authorized-tree-api',projectId:'project',branch:'main',scope:{pages:['p'],layouts:'all'},pages:[{id:'p',path:'/app',layout:null}],templates:[],text:[]}
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M0 0L12 12" stroke="#fff"/></svg>'
 const nodes={format:'framer-to-agent/editor-node-capture-v1',projectId:'project',branch:'main',pageId:'p',nodes:[{id:'icon',type:'IconNode',icon:'Book Open',set:'Lucide',width:'15px',height:'auto',$control__c:'#123456',$control__w:1},{id:'overlay',type:'RelativeOverlayNode'},{id:'shape',type:'ShapeContainerNode',svg,width:'12px',height:'12px'},{id:'frame',type:'FrameNode',width:'33.333%',htmlTag:'nav',ariaLabel:'Example navigation',ariaHidden:false,cursor:'pointer',pointerEvents:'auto',hoverEffect:{backgroundColor:'#123456',opacity:0.8,x:'0px',y:'0px',rotate:'0deg',scale:1,skewX:'0deg',skewY:'0deg',transition:{type:'tween',duration:'0.2s',delay:'0s',ease:[0.2,0,0,1]}},borderTop:'0px',borderRight:'0px',borderBottom:'1px',borderLeft:'0px',borderColor:'#123456',borderStyle:'solid'}].map(n=>({...n,$scopeId:'p',$groundNodeId:'bp'}))}
 const raw:ArchiveFiles={'manifest.json':JSON.stringify(manifest),'pages/app/design.json':JSON.stringify({roots:[root]}),'pages/app/breakpoints/bp/design.json':JSON.stringify({roots:[root]}),'library/editor-source.json':JSON.stringify(editor),'library/editor-nodes.json':JSON.stringify(nodes),'library/editor-icon-controls.json':JSON.stringify({Lucide:{controls:{$control__c:{type:'color',name:'color'},$control__w:{type:'number',name:'width'}}}}),'assets/manifest.json':JSON.stringify({assets:[]})}
 const before=structuredClone(raw),compiled=await compileCapturedArchive(raw)
 assert.deepEqual(compiled,await compileCapturedArchive(await packCaptureDocuments(raw)))
 assert.deepEqual(raw,before)
 const tsx=String(compiled.files['preview/src/pages/app/breakpoints/1200-0/Component.tsx'])
 assert.match(tsx,/<svg /)
 assert.match(tsx,/color: "#123456"/)
 assert.match(tsx,/height: "15px"/)
 assert.doesNotMatch(tsx,/Hidden overlay content/)
 assert.ok(compiled.files['preview/public/'+svgPath(svg)])
 const css=String(compiled.files['preview/src/pages/app/breakpoints/1200-0/component.css'])
 assert.match(css,/width: 33\.333%;/)
 assert.match(tsx,/<nav /)
 assert.match(tsx,/aria-label="Example navigation"/)
 assert.match(css,/cursor: pointer/)
 assert.match(css,/:hover \{/)
 assert.match(css,/opacity: 0\.8/)
 assert.match(css,/border-bottom: 1px solid #123456/)
 assert.doesNotMatch(css,/border: 1px solid #000000/)
 const report=JSON.parse(String(compiled.files['preview/editor-source-report.json']))
 assert.equal(report.nodes.applied,4)
 assert.equal(report.nodes.closedOverlays.length,1)
 assert.equal(report.nodes.unresolvedIcons.length,0)
})

