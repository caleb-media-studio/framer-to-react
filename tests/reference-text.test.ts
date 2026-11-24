import type {DesignNode} from '../src/types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {buildOverlay,applyOverlay} from '../src/enrichment.ts'
import {generateBundle} from '../src/generator.ts'
const editor:DesignNode={id:'t',kind:'TextNode',text:'Original headingSecond line',attributes:{name:'Stale layer name',width:'100%'}}
const mk=(hardBreakText?:string,confidence='high',style:Record<string,string>={tag:'h2',blocks:'1',whiteSpace:'pre-wrap',fontSize:'32px'})=>({route:'/',doc:{breakpointId:'b',provenance:{viewport:{width:1200}},evidence:[{nodeId:'t',confidence,style,hardBreakText}]}})
const build=(e:Parameters<typeof buildOverlay>[0][number],n=editor)=>{const o=buildOverlay([e],new Map([['t',n]]));return {o,b:generateBundle(applyOverlay({roots:[n]},o))}}
test('restores exact published BRs despite stale layer name, preserving original snapshot and semantic tag',()=>{
 const {o,b}=build(mk('Original heading\nSecond line'))
 assert.equal(o.nodes.t.hardBreakText,'Original heading\nSecond line')
 assert.equal(o.nodes.t.tag,'h2')
 assert.match(b.tsx,/<h2 /);assert.ok(b.tsx.includes('Original heading\\nSecond line'))
 assert.equal(editor.text,'Original headingSecond line')
})
test('never replaces differing content or trusts ambiguous matches',()=>{
 assert.equal(build(mk('Changed heading\nSecond line')).o.nodes.t.hardBreakText,undefined)
 assert.equal(build(mk('Original heading\nSecond line','medium')).o.nodes.t,undefined)
 assert.equal(build(mk('Original heading\nSecond line'),{...editor,richTextHTML:'<p>Editor content</p>'}).o.nodes.t.hardBreakText,undefined)
})
test('uses actual source white-space for intrinsic text and does not accept arbitrary CSS',()=>{
 const {b}=build(mk(undefined,'high',{whiteSpace:'pre',tag:'p',blocks:'1'}))
 assert.match(b.css,/white-space: pre;/)
 assert.match(b.tsx,/<p /)
 assert.equal(build(mk(undefined,'high',{whiteSpace:'pre; color:red'})).o.nodes.t,undefined)
})
