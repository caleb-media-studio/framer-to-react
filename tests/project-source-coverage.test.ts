import test from 'node:test'
import assert from 'node:assert/strict'
import {compileCapturedArchive} from '../src/react-compiler.ts'
import {packCaptureDocuments} from '../src/cjson.ts'
import {parseEditorNodes} from '../src/editor-nodes.ts'
import type {EditorSource} from '../src/editor-source.ts'
import type {ArchiveFiles,Manifest} from '../src/types.ts'
test('project-wide source resolution isolates identical occurrence IDs across routes and breakpoints',async()=>{
 const pages=['a','b'].map(id=>({id,path:'/'+id,directory:'pages/'+id,breakpoints:[{id:'bp',directory:'pages/'+id+'/breakpoints/bp',width:1200}]}))
 const manifest:Manifest={format:'framer-to-agent/folder-export-v6',pages}
 const raw:ArchiveFiles={'manifest.json':JSON.stringify(manifest),'assets/manifest.json':JSON.stringify({assets:[]})}
 const root={id:'bp',kind:'FrameNode',attributes:{width:'1200px'},children:[{id:'same-label',kind:'TextNode',text:'Same',attributes:{font:{family:'Geist',weight:400}}},{id:'same-icon',kind:'ComponentInstanceNode',attributes:{width:'14px'}}]}
 for(const page of pages){const value=JSON.stringify({roots:[root]});raw[page.directory+'/design.json']=value;raw[page.breakpoints[0].directory+'/design.json']=value}
 const editor:EditorSource={format:'framer-to-agent/editor-source-v1',adapter:'framer-authorized-tree-api',projectId:'test',branch:'main',scope:{pages:['a','b'],layouts:'all'},pages:pages.map(p=>({id:p.id,path:p.path,layout:null})),templates:[],text:pages.map((p,i)=>({id:'same-label',type:'RichTextNode',$scopeId:p.id,$groundNodeId:'bp',text:'Same',fontName:'Geist',fontSize:i?'15px':'11px',fontWeight:i?700:400,textColor:i?'#ffffff':'#9198a1'}))}
 const nodes={format:'framer-to-agent/editor-node-capture-v2',projectId:'test',branch:'main',pageIds:['a','b'],nodes:pages.map((p,i)=>({id:'same-icon',type:'IconNode',$scopeId:p.id,$groundNodeId:'bp',icon:i?'Plus':'Search',set:'Lucide',width:'14px',height:'auto'}))}
 raw['library/editor-source.json']=JSON.stringify(editor);raw['library/editor-nodes.json']=JSON.stringify(nodes)
 const original=structuredClone(raw)
 const result=await compileCapturedArchive(await packCaptureDocuments(raw))
 assert.deepEqual(result,await compileCapturedArchive(raw))
 const css=(id:string)=>String(result.files['preview/src/pages/'+id+'/breakpoints/1200-0/component.css'])
 assert.match(css('a'),/font-size: 11px/);assert.match(css('a'),/font-weight: 400/);assert.match(css('a'),/#9198a1/)
 assert.match(css('b'),/font-size: 15px/);assert.match(css('b'),/font-weight: 700/);assert.match(css('b'),/#ffffff/)
 const coverage=JSON.parse(String(result.files['preview/source-coverage.json']))
 assert.equal(coverage.textCoveredRoutes,2);assert.equal(coverage.nodeCoveredRoutes,2);assert.equal(coverage.routes[0].missingTypography,0);assert.equal(coverage.routes[1].missingTypography,0)
 assert.deepEqual(raw,original)
 assert.throws(()=>parseEditorNodes({...nodes,pageIds:['a']},editor,manifest),/identity mismatch/)
 const partial={...raw,'library/editor-source.json':JSON.stringify({...editor,scope:{pages:['a'],layouts:'all'},text:[editor.text[0]]}),'library/editor-nodes.json':JSON.stringify({...nodes,pageIds:['a'],nodes:[nodes.nodes[0]]})}
 const incomplete=await compileCapturedArchive(partial)
 const report=JSON.parse(String(incomplete.files['preview/source-coverage.json']))
 assert.equal(report.textCoveredRoutes,1);assert.equal(report.nodeCoveredRoutes,1);assert.equal(report.routes[1].missingTypography,1)
 const issues=JSON.parse(String(incomplete.files['preview/compile-report.json'])).captureIssues
 assert.ok(issues.some((i:{route:string;code:string})=>i.route==='/b'&&i.code==='editor-text-scope-missing'))
})


test('original page-tree shards use one validated compiler adapter for every route',async()=>{
 const {readProjectEditorCapture,EDITOR_PROJECT}=await import('../src/project-editor-capture.ts')
 const manifest:Manifest={format:'framer-to-agent/folder-export-v6',pages:['a','b'].map(id=>({id,path:'/'+id,directory:'pages/'+id,breakpoints:[{id:'bp',directory:'pages/'+id+'/breakpoints/bp',width:1200}]}))}
 const meta={format:'framer-to-agent/editor-source-v1',adapter:'framer-authorized-tree-api',projectId:'test',branch:'main',scope:{pages:[],layouts:'all'},pages:manifest.pages!.map(p=>({id:p.id,path:p.path,layout:null})),templates:[],text:[]}
 const raw:ArchiveFiles={'manifest.json':JSON.stringify(manifest),'library/editor-source.json':JSON.stringify(meta),'assets/manifest.json':JSON.stringify({assets:[]})}
 const index={format:'framer-to-agent/editor-project-v1',projectId:'test',branch:'main',pages:manifest.pages!.map(p=>({id:p.id,path:p.path,file:'library/editor-pages/'+p.id+'.json'}))}
 raw[EDITOR_PROJECT]=JSON.stringify(index)
 for(const [i,p] of manifest.pages!.entries()){
  const text={id:'same',type:'RichTextNode',$scopeId:p.id,$groundNodeId:'bp',text:'Same',fontName:'Geist',fontSize:i?'18px':'12px',fontWeight:i?600:400,textColor:i?'#ffffff':'#9198a1'}
  const tree={id:p.id,type:'WebPageNode',children:[{id:'bp',type:'FrameNode',$scopeId:p.id,$groundNodeId:'bp',children:[text]},{id:'loose-artwork',type:'SVGNode',name:'Loose canvas artwork',$scopeId:p.id,$groundNodeId:'loose-artwork',children:[]}]}
  raw['library/editor-pages/'+p.id+'.json']=JSON.stringify({format:'framer-to-agent/editor-page-v1',projectId:'test',branch:'main',pageId:p.id,path:p.path,tree,vectors:[]})
  const snap=JSON.stringify({roots:[{id:'bp',kind:'FrameNode',attributes:{width:'1200px'},children:[{id:'same',kind:'TextNode',text:'Same'}]}]})
  raw[p.directory+'/design.json']=snap;raw[p.breakpoints![0].directory+'/design.json']=snap
 }
 const result=await compileCapturedArchive(await packCaptureDocuments(raw))
 assert.deepEqual(result,await compileCapturedArchive(raw))
 assert.match(String(result.files['preview/src/pages/a/breakpoints/1200-0/component.css']),/font-size: 12px/)
 assert.match(String(result.files['preview/src/pages/b/breakpoints/1200-0/component.css']),/font-size: 18px/)
 assert.equal(JSON.parse(String(result.files['preview/source-coverage.json'])).textCoveredRoutes,2)
 const bad={...raw,'library/editor-pages/a.json':JSON.stringify({...JSON.parse(String(raw['library/editor-pages/a.json'])),branch:'wrong'})}
 assert.throws(()=>readProjectEditorCapture(bad,manifest),/Unrelated editor page/)
 const truncated=JSON.parse(String(raw['library/editor-pages/a.json']));truncated.tree.children[0].$truncated=true
 assert.throws(()=>readProjectEditorCapture({...raw,'library/editor-pages/a.json':JSON.stringify(truncated)},manifest),/Truncated editor/)
})
