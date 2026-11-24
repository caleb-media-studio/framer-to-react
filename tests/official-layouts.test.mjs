import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareOfficialLayouts,selectLayoutVariant,layoutModules} from '../src/official-layouts.mjs'
import {generatePreviewFiles} from '../src/preview.mjs'
const bp=(id,width)=>({id,type:'FrameNode',name:'Screen',width:width+'px',height:'1400px',fill:'#111111',layout:'stack',stackDirection:'vertical',children:[{id:id+'header',type:'FrameNode',name:'Shared header',height:'64px',width:'100%',children:[{id:id+'label',type:'RichTextNode',text:'Shared title',fontName:'Inter',fontSize:'16px'}]},{id:id+'slot',type:'PlaceholderNode',name:'Page slot'}]})
const doc={format:'framer-to-agent/official-layout-tree-v1',templates:[{id:'shared',name:'Shared shell',children:[bp('desktop',1200),bp('mobile',390)]}],pages:[{id:'p1',path:'/one',layout:'shared'},{id:'p2',path:'/two',layout:'shared'},{id:'p3',path:'/other',layout:null}]}
test('uses authoritative bindings and generates one reusable shell per actual template variant',async()=>{
 const source=await prepareOfficialLayouts(doc),pages=doc.pages.map(p=>({...p,directory:'pages'+p.path,breakpoints:[]}))
 const files={}
 for(const p of pages)files[p.directory+'/design.json']=JSON.stringify({roots:[{id:p.id+'-body',kind:'FrameNode',attributes:{name:'Body',width:'1200px',height:'1080px',isBreakpoint:true},children:[{id:p.id+'-text',kind:'TextNode',text:p.path,attributes:{name:'Content'}}]}]})
 const generated=generatePreviewFiles(pages,files,{layoutSource:source})
 const modules=Object.keys(generated).filter(k=>k.startsWith('preview/src/layouts/templates/')&&k.endsWith('Component.tsx'))
 assert.equal(modules.length,2)
 assert.match(generated[modules[0]],/\{children\}/)
 assert.match(generated['preview/src/pages/one/Page.tsx'],/Wrapped_0/)
 assert.match(generated['preview/src/pages/two/Page.tsx'],/layouts\/templates\/shared/)
 assert.doesNotMatch(generated['preview/src/pages/other/Page.tsx'],/Wrapped_0/)
 assert.equal(JSON.parse(generated['preview/layout-report.json']).assignedRoutes,2)
 assert.equal(selectLayoutVariant(source.templates[0],1920).id,'desktop')
 assert.equal(selectLayoutVariant(source.templates[0],810).id,'mobile')
 assert.equal(layoutModules(source,[{id:'wrong',path:'/one'}]).assignments.size,0)
})
test('rejects truncated templates and ambiguous content slots',async()=>{
 const bad=structuredClone(doc);bad.templates[0].children[0].children.push({id:'second',type:'PlaceholderNode'})
 await assert.rejects(prepareOfficialLayouts(bad),/exactly one/)
 const incomplete=structuredClone(doc);incomplete.templates[0].children[0].$truncated=true
 await assert.rejects(prepareOfficialLayouts(incomplete),/Incomplete/)
})
