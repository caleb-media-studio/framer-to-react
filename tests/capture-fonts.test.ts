import test from 'node:test'
import assert from 'node:assert/strict'
import {captureUsedFonts,includeCapturedFonts} from '../src/capture-fonts.ts'
import type {Snapshot} from '../src/types.ts'
const snapshot:Snapshot={roots:[{id:'p',kind:'FrameNode',children:[
 {id:'a',kind:'TextNode',attributes:{font:{family:'Example',weight:600,style:'normal'}}},
 {id:'b',kind:'TextNode',attributes:{font:{family:'Example',weight:600,style:'normal'}}},
 {id:'c',kind:'TextNode',attributes:{font:{family:'Other',weight:700,style:'italic'}}},
 {id:'d',kind:'TextNode',attributes:{font:{family:'Unknown'}}}
]}]}
test('capture exact used variants once and report missing or mismatched font data',async()=>{
 const calls:string[]=[],warnings:string[]=[]
 const result=await captureUsedFonts({getFont:async(family:string,a:{weight:number;style:string})=>{
  calls.push(family);return {family,weight:family==='Example'?a.weight:400,style:a.style,url:'https://framerusercontent.com/example.woff2'}
 }},[snapshot],warnings)
 assert.deepEqual(calls,['Example','Other'])
 assert.equal(result[0].status,'available');assert.equal(result[1].status,'unavailable');assert.equal(result[2].status,'unavailable')
 assert.equal(warnings.length,1)
 const refs=includeCapturedFonts({urls:[],inlineSvg:[]},result)
 assert.equal(refs.urls.length,1);assert.equal(refs.fontDescriptors?.[0].weight,600)
})
