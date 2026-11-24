import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle,nativeField} from '../src/generator.mjs'
const label={id:'label',kind:'TextNode',text:'Email address',attributes:{name:'Label'}}
const placeholder={id:'value',kind:'TextNode',text:'name@example.test',attributes:{name:'Placeholder',font:{family:'Inter',weight:400},width:'fit-content'},reference:{textStyle:{fontSize:'14px',color:'rgb(100, 100, 100)',lineHeight:'20px'}}}
const icon={id:'i',kind:'ComponentInstanceNode',attributes:{name:'Icon / Mail'}}
const field={id:'field',kind:'FrameNode',attributes:{name:'Input visual',layout:'stack',stackDirection:'horizontal',height:'42px',width:'100%',backgroundColor:'#101010'},children:[icon,placeholder]}
const root={id:'outer',kind:'FrameNode',attributes:{name:'Field group',layout:'stack'},children:[label,field]}
test('explicit named input frame becomes editable native email control and retains text style',()=>{
 const f=nativeField(field,root);assert.equal(f.type,'email');assert.equal(f.label,'Email address')
 const b=generateBundle({roots:[root]})
 assert.match(b.tsx,/<input [^\n]*type="email" aria-label="Email address" placeholder="name@example.test"/)
 assert.match(b.css,/font-size: 14px/);assert.match(b.css,/::placeholder/);assert.match(b.css,/:focus-visible/)
 assert.equal(placeholder.text,'name@example.test')
})
test('password field is a password control; ambiguous complex frames and linked labels stay unchanged',()=>{
 const pw={...field,attributes:{...field.attributes,name:'Input / Password'}}
 assert.equal(nativeField(pw,null).type,'password')
 for(const n of [{...field,attributes:{...field.attributes,name:'Example card'}},{...field,children:[placeholder,label]},{...field,attributes:{...field.attributes,link:'/other'}},{...field,children:[{...placeholder,attributes:{...placeholder.attributes,link:'/other'}}]}])assert.equal(nativeField(n,root),null)
})
