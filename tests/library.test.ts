import {requireText} from './fixture-utils.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {exportProjectLibrary, collectAssetReferences, bundleAssets, appendLibraryInstructions} from '../src/library.ts'

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
const mockFramer = {
  getColorStyles: async () => [{id:'a',name:'Brand/Primary',light:'#112233',dark:'#ddeeff'}],
  getTextStyles: async () => [{id:'b',name:'Heading/H1',fontSize:'32px',lineHeight:'1.3em',breakpoints:[{minWidth:320,fontSize:'24px'}]}],
  getCodeFiles: async () => [{id:'code',path:'components/Button.tsx',name:'Button.tsx',content:'export const Button = () => null',exports:['Button']}],
  getNodesWithType: async (type:string) => type === 'ComponentNode' ? [{id:'root',name:'Button',componentIdentifier:'button-1',type:'ComponentNode',getChildren:async()=>[{id:'child',name:'Inner',type:'TextNode',getText:async()=> 'Click'}]}] : [],
  getCollections: async () => [{id:'cms',name:'Blog',getFields:async()=>[{id:'title',name:'Title'}]}]
}

test('includes style variables, component definitions, code files, and CMS schema', async () => {
  const result=await exportProjectLibrary(mockFramer)
  assert.deepEqual(result.summary,{colorStyles:1,textStyles:1,components:1,vectorSets:0,svgNodes:0,codeFiles:1,cmsCollections:1})
  assert.match(requireText(result.files['library/tokens.css']),/--framer-brand-primary: #112233/)
  assert.match(requireText(result.files['library/tokens.css']),/--framer-brand-primary: #ddeeff/)
  assert.equal(result.files['library/code/components/Button.tsx'], 'export const Button = () => null')
  assert.ok(requireText(result.files['library/components.json']).includes('button-1'))
  assert.ok(Object.keys(result.files).some(x=>x.endsWith('/design.json')))
  assert.ok(requireText(result.files['library/cms-schema.json']).includes('Title'))
  assert.match(appendLibraryInstructions(result,{manifest:[],warnings:[],files:{},totalBytes:0}),/Shared project library/)
})

test('degrades gracefully if optional SDK methods are unavailable',async()=>{
  const result=await exportProjectLibrary({})
  assert.equal(result.summary.components,0)
  assert.ok(result.warnings.length >= 4)
  assert.ok(result.files['library/styles.json'])
})

test('discovers image URLs and inline SVG, deduplicates references',()=>{
  const refs=collectAssetReferences([{roots:[{id:"asset",kind:"FrameNode",attributes:{backgroundImage:{url:'https://framerusercontent.com/image.webp'},svg,controls:{logo:{src:'https://framerusercontent.com/image.webp'}}}}]}])
  assert.equal(refs.urls.length,1)
  assert.equal(refs.inlineSvg.length,1)
  assert.equal(refs.urls[0].usedBy.length,2)
})

test('includes image bytes and a mapping in the zip manifest',async()=>{
  const refs={urls:[{url:'https://framerusercontent.com/image.webp',usedBy:['root/backgroundImage']}],inlineSvg:[{source:svg,usedBy:'root/svg'}]}
  const result=await bundleAssets(refs,async()=>({ok:true,status:200,headers:{get:()=> 'image/webp'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}))
  assert.equal(result.manifest.length,2)
  assert.deepEqual([...result.files['assets/file-0001.webp']],[1,2,3])
  assert.ok(Object.keys(result.files).some(x => x.startsWith('assets/vectors/') && x.endsWith('.svg')))
  assert.equal(JSON.parse(requireText(result.files['assets/manifest.json'])).bytes,3)
})

test('does not request third-party URLs and records blocked CORS assets',async()=>{
  const refs={urls:[{url:'https://example.com/secret.png',usedBy:[]},{url:'https://framerusercontent.com/photo.png',usedBy:[]}],inlineSvg:[]}
  let requests=0
  const result=await bundleAssets(refs,async()=>{requests++;throw new Error('CORS blocked')})
  assert.equal(requests,1)
  assert.equal(result.manifest.filter(x=>x.bundled).length,0)
  assert.equal(result.manifest[0].reason,'External or unsupported host; URL preserved without network request')
  assert.ok(result.warnings.some(x=>x.includes('CORS blocked')))
})
