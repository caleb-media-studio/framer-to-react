import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle} from '../src/generator.mjs'
import {generatePreviewFiles} from '../src/preview.mjs'
import {relativeModule,routeDirectory} from '../src/reuse.mjs'

const sourceId = 'local-module:canvasComponent/example-definition:default'
const definition = {id:'example-definition',kind:'ComponentNode',attributes:{name:'Action'},children:[
  {id:'variant-default',kind:'FrameNode',attributes:{name:'Default',width:'fit-content',layout:'stack'},children:[
    {id:'default-label',kind:'TextNode',text:'Default label',attributes:{name:'Label'},children:[]}
  ]}
]}
function fixture() {
  const files = {
    'library/components.json':JSON.stringify([{id:sourceId,folder:'library/components/action'}]),
    'library/components/action/design.json':JSON.stringify({roots:[definition]})
  }
  const pages = ['/store','/store/details'].map((route,i)=>{
    const id='route-'+i
    const instance={id:id+'-action',kind:'ComponentInstanceNode',attributes:{name:'Action',componentIdentifier:sourceId,controls:{variant:'variant-default'},width:i?'120px':'200px',position:'relative'},children:[
      {id:id+'-label',kind:'TextNode',text:i?'Learn more':'Buy now',attributes:{name:'Label'},children:[]}
    ]}
    const header={id:id+'-header',kind:'FrameNode',attributes:{name:'Header',layout:'stack',stackDirection:'horizontal'},children:[
      {id:id+'-nav',kind:'TextNode',text:'Browse',attributes:{name:'Nav',link:'/store'},children:[]},instance
    ]}
    const snapshot={pagePath:route,roots:[{id:id+'-root',kind:'FrameNode',attributes:{name:'Desktop'},children:[header,{id:id+'-section',kind:'FrameNode',attributes:{name:'Unique section'},children:[{id:id+'-content',kind:'TextNode',text:'Only '+id,attributes:{name:'Content'},children:[]}]}]}]}
    const dir='pages'+route
    const b=generateBundle(snapshot)
    Object.assign(files,{[dir+'/design.json']:JSON.stringify(snapshot),[dir+'/Component.tsx']:b.tsx,[dir+'/component.css']:b.css})
    return {path:route,directory:dir,breakpoints:[]}
  })
  return generatePreviewFiles(pages,files)
}
test('reuses original canvas components and identical cross-route layouts without mixing instance props',()=>{
  const f=fixture(), report=JSON.parse(f['preview/reuse-report.json']).modules
  const components=report.filter(x=>x.kind==='component'), layouts=report.filter(x=>x.kind==='layout')
  assert.equal(components.length,1)
  assert.equal(components[0].instances,2)
  assert.equal(layouts.length,1)
  assert.equal(layouts[0].routes,2)
  const shared=f['preview/'+components[0].file]
  assert.match(shared,/textValues\[0\]/)
  assert.match(shared,/slots\[0\]\.className/)
  assert.doesNotMatch(shared,/Buy now|Learn more|route-0-action/)
  const layout=f['preview/'+layouts[0].file]
  assert.match(layout,/parts\[0\]/)
  const a=f['preview/src/pages/store/breakpoints/primary-0/Component.tsx']
  const b=f['preview/src/pages/store/details/breakpoints/primary-0/Component.tsx']
  for(const [jsx,id,txt] of [[a,'route-0','Buy now'],[b,'route-1','Learn more']]) {
    assert.match(jsx,/import SharedAction_/)
    assert.match(jsx,/import SharedHeader_/)
    assert.ok(jsx.includes(txt))
    assert.ok(jsx.includes(id+'-action'))
    assert.ok(jsx.includes(id+'-label'))
    assert.ok(jsx.includes('Only '+id))
    assert.doesNotMatch(jsx,/__FTA_REUSE_/)
  }
  assert.match(f['preview/src/pages/store/breakpoints/primary-0/component.css'],/width: 200px/)
  assert.match(f['preview/src/pages/store/details/breakpoints/primary-0/component.css'],/width: 120px/)
  assert.ok(f['preview/src/pages/store/Page.tsx'])
  assert.ok(f['preview/src/pages/store/details/Page.tsx'])
  assert.ok(!Object.keys(f).some(k=>k.includes('/generated/page-')))
})
test('route paths are nested, encoded safely and resolve relative imports',()=>{
  assert.equal(routeDirectory('/'),'preview/src/pages/_index')
  assert.equal(routeDirectory('/store/details'),'preview/src/pages/store/details')
  assert.notEqual(routeDirectory('/_index'),routeDirectory('/'))
  assert.notEqual(routeDirectory('/a.b'),routeDirectory('/a_2e_b'))
  assert.ok(!routeDirectory('/../x').includes('/../'))
  assert.equal(relativeModule('preview/src/pages/store/details/Page.tsx','preview/src/components/canvas/Action.tsx'),'../../../components/canvas/Action')
})
