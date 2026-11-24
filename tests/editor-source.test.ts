import test from 'node:test'
import assert from 'node:assert/strict'
import {compileCapturedArchive} from '../src/react-compiler.ts'
import {packCaptureDocuments} from '../src/cjson.ts'
import {parseEditorSource} from '../src/editor-source.ts'
import type {ArchiveFiles,Manifest} from '../src/types.ts'
test('editor source restores exact layout slot and occurrence-specific typography from one immutable archive',async()=>{
 const manifest:Manifest={format:'framer-to-agent/folder-export-v6',pages:[{id:'p',path:'/repo',directory:'pages/repo',breakpoints:[{id:'desktop',directory:'pages/repo/breakpoints/desktop',width:'1200px'}]}]}
 const root={id:'desktop',kind:'FrameNode',attributes:{width:'1200px',height:'fit-content'},children:[{id:'a',kind:'TextNode',text:'Same',attributes:{font:{family:'Geist',weight:400}}},{id:'b',kind:'TextNode',text:'Same',attributes:{font:{family:'Geist',weight:400}}}]}
 const editor={format:'framer-to-agent/editor-source-v1',adapter:'framer-authorized-tree-api',projectId:'test',branch:'main',scope:{pages:['p'],layouts:'all'},pages:[{id:'p',path:'/repo',layout:'shell'}],templates:[{id:'shell',name:'App shell',children:[{id:'shell-desktop',type:'FrameNode',width:'1200px',layout:'stack',stackDirection:'vertical',children:[{id:'nav',type:'RichTextNode',text:'Navigation',fontName:'Geist',fontSize:'12px',fontWeight:600,textColor:'#ffffff'},{id:'slot',type:'PlaceholderNode'}]}]}],text:[{id:'a',type:'RichTextNode',$scopeId:'p',$groundNodeId:'desktop',text:'Same',fontName:'Geist',fontWeight:400,fontSize:'11px',lineHeight:'1.4em',textColor:'var(--token-muted)'},{id:'b',type:'RichTextNode',$scopeId:'p',$groundNodeId:'desktop',text:'Same',fontName:'Geist',fontWeight:700,fontSize:'15px',textColor:'var(--token-primary)'}]}
 const raw:ArchiveFiles={'manifest.json':JSON.stringify(manifest),'pages/repo/design.json':JSON.stringify({roots:[root]}),'pages/repo/breakpoints/desktop/design.json':JSON.stringify({roots:[root]}),'library/editor-source.json':JSON.stringify(editor),'library/styles.json':JSON.stringify({colors:[{id:'muted',name:'Muted',light:'#9198a1',dark:'#9198a1'},{id:'primary',name:'Primary',light:'#ffffff',dark:'#ffffff'}]}),'assets/manifest.json':JSON.stringify({assets:[]})}
 const before=structuredClone(raw)
 const result=await compileCapturedArchive(await packCaptureDocuments(raw))
 const page=String(result.files['preview/src/pages/repo/Page.tsx'])
 assert.match(page,/Layout_0/)
 const shell=String(result.files['preview/src/layouts/templates/shell/shell-desktop/Component.tsx'])
 assert.match(shell,/Navigation/);assert.match(shell,/\{children\}/)
 const css=Object.entries(result.files).filter(([k])=>k.includes('/pages/repo/')&&k.endsWith('/component.css')).map(([,v])=>String(v)).join('\n')
 assert.match(css,/font-size: 11px;/);assert.match(css,/font-size: 15px;/);assert.match(css,/line-height: 1.2em;/);assert.match(css,/font-weight: 700;/);assert.match(css,/var\(--framer-muted\)/);assert.match(css,/var\(--framer-primary\)/)
 assert.equal(JSON.parse(String(result.files['preview/editor-source-report.json'])).applied,2)
 assert.equal(JSON.parse(String(result.files['preview/layout-report.json'])).assignedRoutes,1)
 assert.deepEqual(raw,before)
 assert.throws(()=>parseEditorSource({...editor,text:[{...editor.text[0],$groundNodeId:'foreign'}]},manifest),/breakpoint mismatch/)
})

