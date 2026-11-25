import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeVector} from '../src/native-vector.ts'
import {generateBundle} from '../src/generator.ts'

test('native shape SVG preserves nested geometry and presentation attributes as typed JSX',()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><g transform="translate(1 2)"><path d="M2 12h20" stroke-linecap="round" /><circle cx="10" cy="10" r="3"/></g></svg>'
 const v=nativeVector(svg)
 assert.ok(v)
 assert.match(v.attributes,/viewBox=\{"0 0 24 24"\}/)
 assert.match(v.attributes,/fill=\{"none"\}/)
 assert.match(v.attributes,/strokeWidth=\{"1.5"\}/)
 assert.match(v.children,/<g transform=\{"translate\(1 2\)"\}>/)
 assert.match(v.children,/<path d=\{"M2 12h20"\} strokeLinecap=\{"round"\} \/>/)
 assert.match(v.children,/<circle cx=\{"10"\} cy=\{"10"\} r=\{"3"\} \/>/)
})
test('native shape validation rejects executable and unsupported markup instead of injecting it',()=>{
 const svg=(body:string)=>'<svg viewBox="0 0 24 24" fill="currentColor">'+body+'</svg>'
 for(const body of ['<script>alert(1)</script>','<path onload="alert(1)" d="M0 0"/>','<path style="fill:red" d="M0 0"/>','<use href="#x"/>','<path d="M0 0" fill="url(#x)"/>','<path d="M0 0" d="M1 1"/>','<g><path d="M0 0"></g></path>','<path d="M0 0"/><text>hi</text>','<path d="M0 0"/><foreignObject/>','<path d="M0 0" fill="&lt;"/>'])assert.equal(nativeVector(svg(body)),null,body)
 assert.equal(nativeVector('<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0"/></svg>'),null)
 assert.equal(nativeVector('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg><svg/>'),null)
 const b=generateBundle({roots:[{id:'test',kind:'SVGNode',attributes:{width:'20px',height:'20px',svg:svg('<path style="fill:currentColor" d="M0 0"/>')}}]})
 assert.match(b.tsx,/maskImage:/)
 assert.doesNotMatch(b.tsx,/<path/)
})
