import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle} from '../src/generator.ts'
import {compileCapturedArchive} from '../src/react-compiler.ts'
test('captured shorthand border widths paint each edge without altering frame geometry',()=>{
 const bundle=generateBundle({roots:[{id:'frame',kind:'FrameNode',attributes:{width:'100%',height:'51px',border:{width:'0px 0px 1px 0px',color:'#333333',style:'solid'}}}]})
 assert.match(bundle.css,/::after\s*\{[^}]*border-width: 0px 0px 1px 0px;[^}]*border-style: solid;[^}]*border-color: #333333;/)
 assert.doesNotMatch(bundle.css,/\.[\w-]+\s*\{[^}]*border-width:/)
})
test('generated app uses Framer text rasterization defaults',async()=>{
 const r=await compileCapturedArchive({'manifest.json':JSON.stringify({format:'framer-to-agent/selection-export-v6',pages:[{path:'/',directory:'',breakpoints:[]}]}),'design.json':JSON.stringify({roots:[{id:'root',kind:'FrameNode',attributes:{width:'1200px'}}]}),'assets/manifest.json':JSON.stringify({assets:[]})})
 assert.match(String(r.files['preview/src/styles.css']),/-webkit-font-smoothing:antialiased;/)
})
