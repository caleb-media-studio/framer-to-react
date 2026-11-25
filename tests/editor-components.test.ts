import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareEditorComponents} from '../src/editor-components.ts'
import {expandCanvasInstance,generateBundle} from '../src/generator.ts'
import type {EditorSource} from '../src/editor-source.ts'
import type {ArchiveFiles} from '../src/types.ts'
test('original shared definition resolves variable defaults and occurrence overrides without style leakage',async()=>{
 const id='local-module:canvasComponent/c:default'
 const legacy={id:'c',kind:'ComponentNode',children:[{id:'v',kind:'FrameNode',children:[]}]}
 const comp={id:'c',type:'ComponentNode',name:'Button',variables:[{id:'label',type:'string',initialValue:'Default'}],children:[{id:'v',type:'FrameNode',$isPrimary:true,children:[{id:'text',type:'RichTextNode',text:{type:'reference',id:'label',providerId:'c'},fontName:'Geist',fontSize:'13px',fontWeight:600,textColor:'#123456'}]},{id:'other',type:'FrameNode',children:[{id:'otherText',type:'RichTextNode',text:{type:'reference',id:'label',providerId:'c'},fontName:'Geist',fontSize:'15px',fontWeight:700,textColor:'#abcdef'}]}]}
 const source:EditorSource={format:'framer-to-agent/editor-source-v1',adapter:'framer-authorized-tree-api',projectId:'project',branch:'main',scope:{pages:[],layouts:'all'},pages:[],templates:[],text:[]}
 const raw:ArchiveFiles={'library/components.json':JSON.stringify([{id,folder:'library/components/c'}]),'library/components/c/design.json':JSON.stringify({roots:[legacy]}),'library/editor-components.json':JSON.stringify({format:'framer-to-agent/editor-components-v1',projectId:'project',branch:'main',components:[comp],vectors:[]})}
 const before=structuredClone(raw),prepared=await prepareEditorComponents(raw,source,{})
 assert.ok(prepared);assert.equal(prepared.covered,1)
 const definition=prepared.components.get(id)
 const a=expandCanvasInstance({id:'a',kind:'ComponentInstanceNode',attributes:{componentIdentifier:id,editorComponentId:'c',controls:{label:'First'}}},definition)
 const b=expandCanvasInstance({id:'b',kind:'ComponentInstanceNode',attributes:{componentIdentifier:id,editorComponentId:'c',controls:{variant:'other',label:'Second'}}},definition)
 assert.equal(a?.children?.[0].text,'First');assert.equal(b?.children?.[0].text,'Second')
 const output=generateBundle({roots:[a!,b!]})
 assert.match(output.css,/font-size: 13px/);assert.match(output.css,/font-size: 15px/)
 assert.match(output.css,/#123456/);assert.match(output.css,/#abcdef/)
 assert.match(output.tsx,/a::text/);assert.match(output.tsx,/b::otherText/)
 assert.throws(()=>expandCanvasInstance({id:'x',kind:'ComponentInstanceNode',attributes:{controls:{variant:'unknown'}}},definition),/Unresolved captured component variant/)
 assert.deepEqual(raw,before)
})
