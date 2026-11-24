import test from 'node:test'
import assert from 'node:assert/strict'
import {buildOverlay,applyOverlay} from '../src/enrichment.ts'
import {generateBundle} from '../src/generator.ts'
import type {DesignNode,TextEvidence} from '../src/types.ts'
const n:DesignNode={id:'p',kind:'TextNode',text:'Bold and plain',attributes:{name:'Paragraph',font:{family:'Inter',weight:400}}}
const runs:NonNullable<TextEvidence["inlineRuns"]>=[{text:'Bold',style:{fontSize:'14px',fontWeight:'600',lineHeight:'21.84px',color:'rgb(200, 208, 217)'}},{text:' and plain',style:{}}]
function compile(e:Partial<TextEvidence>={},node=n){
 const overlay=buildOverlay([{route:'/',doc:{breakpointId:'b',evidence:[{nodeId:'p',confidence:'high',style:{tag:'p',blocks:'1',fontSize:'13px'},inlineRuns:runs,...e}]}}],new Map([['p',node]]))
 return {overlay,tsx:generateBundle(applyOverlay({roots:[node]},overlay)).tsx}
}
test('preserves measured inline typography with exact original text',()=>{
 const {overlay,tsx}=compile()
 assert.deepEqual(overlay.nodes.p.inlineRuns,runs)
 assert.match(tsx,/<span style=/)
 assert.ok(tsx.includes('"fontSize":"14px"')&&tsx.includes('{"Bold"}')&&tsx.includes('{" and plain"}'))
 assert.equal(n.reference,undefined)
})
test('rejects changed text, ambiguous matches, editor-owned inline styling and unsafe styles',()=>{
 for(const e of [{confidence:'low'}, {inlineRuns:[{text:'Changed',style:{fontSize:'14px'}}]}, {inlineRuns:[{text:n.text!,style:{background:'url(https://evil.test)'}}]}])assert.doesNotMatch(compile(e).tsx,/<span style=/)
 assert.doesNotMatch(compile({}, {...n,richTextHTML:'<p>Editor owned</p>'}).tsx,/<span style=/)
})
