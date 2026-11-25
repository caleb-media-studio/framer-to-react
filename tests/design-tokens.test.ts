import test from 'node:test'
import assert from 'node:assert/strict'
import {createDesignTokens} from '../src/design-tokens.ts'
import {compileCapturedArchive} from '../src/react-compiler.ts'
import {packCaptureDocuments} from '../src/cjson.ts'
import type {ArchiveFiles} from '../src/types.ts'

test('exact captured color IDs become Tailwind tokens with dark values and backlinks',async()=>{
 const raw:ArchiveFiles={
  'manifest.json':JSON.stringify({format:'framer-to-agent/selection-export-v6',captureOnly:true,pages:[{path:'/',directory:'',breakpoints:[]}]}),
  'library/styles.json':JSON.stringify({colors:[{id:'style-a',name:'Brand / Accent',light:'#123456',dark:'#654321'},{id:'style-b',name:'Brand / Accent',light:'#abcdef',dark:'#fedcba'}]}),
  'design.json':JSON.stringify({roots:[{id:'root',kind:'FrameNode',attributes:{width:'1200px',backgroundColor:{id:'style-a',light:'#123456',dark:'#654321'},border:{width:'1px',color:{id:'style-b',light:'#abcdef'}}},children:[{id:'title',kind:'TextNode',text:'Label',attributes:{inlineTextStyle:{fontSize:11,color:{id:'style-b',light:'#abcdef'}}}}]}]}),
  'assets/manifest.json':JSON.stringify({assets:[]})
 }
 const before=structuredClone(raw)
 const result=await compileCapturedArchive(await packCaptureDocuments(raw))
 const css=String(result.files['preview/src/tokens.css'])
 assert.match(css,/@theme inline/)
 assert.match(css,/--color-brand-accent: var\(--framer-brand-accent\)/)
 assert.match(css,/\[data-theme="dark"\]/)
 assert.match(css,/#654321/)
 const tokens=JSON.parse(String(result.files['preview/design-tokens.json']))
 assert.equal(tokens.colors.length,2)
 assert.notEqual(tokens.colors[0].token,tokens.colors[1].token)
 assert.deepEqual(new Set(tokens.references.map((r:{id:string})=>r.id)),new Set(['style-a','style-b']))
 assert.ok(tokens.references.some((r:{nodeId:string;field:string})=>r.nodeId==='title'&&r.field==='textColor'))
 const generated=Object.entries(result.files).filter(([k])=>k.endsWith('/component.css')).map(([,v])=>String(v)).join('\n')
 assert.match(generated,/background-color:\s*var\(--framer-brand-accent\)/)
 assert.ok(generated.includes('var(--framer-'+tokens.colors[1].token+')'))
 assert.match(String(result.files['preview/design-tokens.csv']),/style-a/)
 assert.deepEqual(raw,before)
})
test('unknown color references use captured literals, never infer by style name',()=>{
 const t=createDesignTokens({'library/styles.json':JSON.stringify({colors:[{id:'known',name:'A',light:'#123456',dark:'#654321'}]})})
 assert.equal(t.resolve({id:'unknown',name:'A',light:'#abcdef'}),'#abcdef')
 assert.equal(t.resolve({id:'unknown',name:'A'}),null)
 assert.equal(t.resolve({id:'known'}),'var(--framer-a)')
 assert.equal(t.resolve('red;display:none'),null)
 assert.deepEqual(t.report().unknownIds,['unknown'])
})

