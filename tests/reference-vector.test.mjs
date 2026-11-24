import test from 'node:test'
import assert from 'node:assert/strict'
import {serializeReferenceVector} from '../src/reference-vector.mjs'
import {buildOverlay,applyOverlay} from '../src/enrichment.mjs'
import {generateBundle} from '../src/generator.mjs'
const vector={viewBox:'0 0 24 24',shapes:[{tag:'path',attrs:{d:'M 0 0 L 24 24',fill:'none',stroke:'#123456','stroke-width':'2'}}]}
const n={id:'icon',kind:'ComponentInstanceNode',attributes:{name:'Icon',width:'16px',height:'fit-content'},children:[]}
const prov={source:'published-site',url:'https://example.test/',viewport:{width:1200,height:900},responseSha256:'hash'}
function overlay(v=vector,extra={},node=n){return buildOverlay([{route:'/',doc:{breakpointId:'b',provenance:prov,vectorProvenance:prov,evidence:[],vectors:[{nodeId:'icon',confidence:'high',vector:v,...extra}]}}],new Map([['icon',node]]),new Map([['icon','b']]))}
test('serializes only safe structured geometry',()=>{
 assert.match(serializeReferenceVector(vector),/<path d="M 0 0 L 24 24"/)
 for(const v of [{...vector,shapes:[{tag:'script',attrs:{}}]},{...vector,shapes:[{tag:'path',attrs:{d:'M 0 0',onload:'alert(1)'}}]},{...vector,shapes:[{tag:'path',attrs:{fill:'url(https://evil.test/)'}}]}, {...vector,viewBox:'0 0 0 24'}])assert.equal(serializeReferenceVector(v),null)
})
test('generates a local vector asset reference without modifying raw source',()=>{
 const o=overlay(), b=generateBundle(applyOverlay({roots:[n]},o))
 assert.equal(o.coverage[0].vectors,1)
 assert.match(b.tsx,/<img .*src="\/assets\/vectors\/[a-f0-9]+\.svg"/)
 assert.equal(n.attributes.svg,undefined)
})
test('rejects ambiguous and unsafe vector matches or editor-owned artwork',()=>{
 assert.equal(overlay(vector,{confidence:'medium'}).nodes.icon,undefined)
 assert.equal(overlay({...vector,shapes:[{tag:'image',attrs:{}}]}).nodes.icon,undefined)
 assert.equal(overlay(vector,{}, {...n,attributes:{...n.attributes,svg:'<svg></svg>'}}).nodes.icon,undefined)
})
