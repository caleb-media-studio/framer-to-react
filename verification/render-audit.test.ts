import test from 'node:test'
import assert from 'node:assert/strict'
import {compareRenderAudit,lineFields,type PaintedLine,type RenderText} from './render-audit.ts'
const box={x:20,y:40,width:300,height:1}
const line:PaintedLine={name:'rule',axis:'horizontal',box,color:'rgb(51, 51, 51)',opacity:1}
const text:RenderText={name:'label',text:'Schedule',box:{...box,height:12},style:{fontFamily:'Inter',fontSize:'10px',fontWeight:'600',lineHeight:'12px',letterSpacing:'normal',textAlign:'left',textTransform:'none',color:'rgb(145, 152, 161)',fontStyle:'normal',textDecorationLine:'none'}}
test('pass 2 catches missing dividers even when all text matches',()=>{
 const r=compareRenderAudit({texts:[text],lines:[line]},{texts:[text],lines:[]})
 assert.equal(r.textMatched,1);assert.equal(r.lineMatched,0)
 assert.deepEqual(r.findings[0].fields,[{field:'divider.presence',expected:'present',actual:'missing'}])
})
test('checks exact weight, color and size even for repeated labels',()=>{
 const other={...text,box:{...text.box,y:100}}
 const r=compareRenderAudit({texts:[text,other],lines:[]},{texts:[other,{...text,style:{...text.style,fontWeight:'400',fontSize:'16px',color:'rgb(255, 255, 255)'}}],lines:[]})
 assert.equal(r.textMatched,1);assert.deepEqual(r.findings[0].fields.map(f=>f.field),['fontSize','fontWeight','color'])
})
test('thickness and paint are exact independently of geometry tolerance',()=>{
 assert.deepEqual(lineFields(line,{...line,box:{...box,height:2},color:'rgb(0, 0, 0)'}).map(f=>f.field),['line.thickness','line.color'])
})
test('requires distinct matches and rejects extra lines',()=>{
 const r=compareRenderAudit({texts:[],lines:[line,line]},{texts:[],lines:[line]})
 assert.equal(r.lineMatched,1);assert.equal(r.findings.length,1)
 assert.equal(compareRenderAudit({texts:[],lines:[line]},{texts:[],lines:[line,line]}).findings[0].fields[0].actual,'extra')
})
