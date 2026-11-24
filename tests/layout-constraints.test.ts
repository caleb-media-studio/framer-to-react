import type {DesignNode,Attributes} from '../src/types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle} from '../src/generator.ts'
const frame=(id:string,attributes:Attributes={},children:DesignNode[]=[])=>({id,kind:'FrameNode',attributes:{name:id,...attributes},children})
const css=(root:DesignNode)=>generateBundle({roots:[root]}).css
const rule=(s:string,n:number)=>s.match(new RegExp('\\.f2a-[a-z0-9]+-'+n+' \\{[^}]*\\}'))?.[0]||''
test('grid minmax, fixed, auto-fill and fit row tracks derive from captured traits',()=>{
 const a=rule(css(frame('grid',{layout:'grid',gridColumnCount:3,gridColumnWidthType:'minmax',gridColumnMinWidth:80,gridRowCount:2,gridRowHeightType:'fit',gridAlignment:'center'})),1)
 assert.match(a,/grid-template-columns: repeat\(3, minmax\(80px, 1fr\)\)/)
 assert.match(a,/grid-auto-rows: min-content/)
 assert.match(a,/grid-template-rows: repeat\(2, min-content\)/)
 assert.match(a,/justify-items: center/)
 const b=rule(css(frame('grid',{layout:'grid',gridColumnCount:'auto-fill',gridColumnWidthType:'fixed',gridColumnWidth:140,gridRowHeightType:'fixed',gridRowHeight:90})),1)
 assert.match(b,/grid-template-columns: repeat\(auto-fill, 140px\)/)
 assert.match(b,/grid-auto-rows: 90px/)
})
test('grid children stretch within their cell, not flex-grow, and may span all columns',()=>{
 const root=frame('grid',{layout:'grid',gridColumnCount:4,gridRowHeightType:'auto'},[
 frame('child',{width:'1fr',height:'1fr',gridItemFillCellWidth:true,gridItemFillCellHeight:true,gridItemColumnSpan:'all'}),
 frame('other',{width:'50px',height:'30px',gridItemHorizontalAlignment:'end',gridItemVerticalAlignment:'center'})
 ])
 const b=css(root), a=rule(b,2), c=rule(b,3)
 assert.match(a,/justify-self: stretch/);assert.match(a,/align-self: stretch/);assert.match(a,/grid-column: 1 \/ -1/)
 assert.doesNotMatch(a,/flex-grow|flex-basis/)
 assert.match(c,/justify-self: end/);assert.match(c,/align-self: center/)
 assert.match(rule(b,1),/grid-auto-rows: minmax\(0px, 1fr\)/)
})
test('non-fill stack items do not shrink but fill items still share free space',()=>{
 const root=frame('row',{layout:'stack',stackDirection:'horizontal'},[frame('fixed',{width:'20px',height:'20px'}),frame('fill',{width:'1fr',height:'20px'})])
 const b=css(root)
 assert.match(rule(b,2),/flex-shrink: 0/)
 assert.match(rule(b,3),/flex-grow: 1/)
 assert.doesNotMatch(rule(b,3),/flex-shrink: 0/)
})
test('center anchors compose with rotation and never override edge pins',()=>{
 const root=frame('canvas',{},[frame('center',{position:'absolute',width:'30px',height:'20px',centerX:'50%',centerY:'35%',rotation:12}),frame('pinned',{position:'absolute',left:'8px',centerX:'20%',centerY:'50%'})])
 const b=css(root)
 assert.match(rule(b,2),/left: 50%/);assert.match(rule(b,2),/top: 35%/)
 assert.match(rule(b,2),/transform: translateX\(-50%\) translateY\(-50%\) rotate\(12deg\)/)
 assert.match(rule(b,3),/left: 8px/);assert.doesNotMatch(rule(b,3),/translateX/)
})
