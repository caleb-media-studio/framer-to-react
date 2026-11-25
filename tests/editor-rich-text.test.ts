import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveEditorRichText,hasExplicitRunProperty} from '../src/editor-rich-text.ts'
import {createEditorTextResolver} from '../src/editor-source.ts'
import {generateBundle} from '../src/generator.ts'
import type {EditorSource} from '../src/editor-source.ts'
test('mixed run font sizes and colors are preserved from original text blocks and line breaks',()=>{
 const t={id:'text',type:'RichTextNode',$scopeId:'p',$groundNodeId:'bp',text:'First\nSecond',tag:'p',lineHeight:'1.5em',textWrap:'balance',children:[{id:'b',type:'TextBlock',tag:'p',lineHeight:'1.5em',children:[{id:'r1',type:'TextRun',text:'First',fontName:'Geist',fontSize:'14px',fontWeight:400,textColor:'#9198a1'},{id:'br',type:'TextLineBreak'},{id:'r2',type:'TextRun',text:'Second',fontName:'Geist',fontSize:'13px',fontWeight:600,textColor:'#ffffff'}]}]}
 const rich=deriveEditorRichText(t)
 assert.ok(rich);assert.equal(rich.base.fontSize,'13px');assert.ok(hasExplicitRunProperty(rich,'textColor'))
 const source:EditorSource={format:'framer-to-agent/editor-source-v1',adapter:'framer-authorized-tree-api',projectId:'p',branch:'main',scope:{pages:['p'],layouts:'all'},pages:[],templates:[],text:[t]}
 const resolver=createEditorTextResolver(source)
 const snap=resolver.resolve({roots:[{id:'bp',kind:'FrameNode',children:[{id:'text',kind:'TextNode',text:'FirstSecond'}]}]},'p')
 const b=generateBundle(snap)
 assert.match(b.tsx,/"fontSize":"14px"/);assert.match(b.tsx,/"fontSize":"13px"/);assert.match(b.tsx,/"fontWeight":"600"/);assert.match(b.tsx,/<br \/>/)
 assert.match(b.tsx,/#9198a1/);assert.match(b.tsx,/#ffffff/);assert.match(b.css,/text-wrap: balance/)
 assert.equal(resolver.report().coverage[0].missing.length,0)
 assert.equal(deriveEditorRichText({...t,text:'unrelated'}),null)
})
