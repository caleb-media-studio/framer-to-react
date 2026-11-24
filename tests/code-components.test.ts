import {requireText} from './fixture-utils.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle} from '../src/generator.ts'
import {generatePreviewFiles} from '../src/preview.ts'
test('preserves and renders original code component by stable ID',()=>{
 const snapshot={roots:[{kind:'ComponentInstanceNode',id:'inst',attributes:{name:'Example',componentIdentifier:'codeFile/demo-id:default',controls:{enabled:true},width:'100%',height:'300px'},children:[]}],warnings:[]}
 const base=generateBundle(snapshot)
 const files={
  'pages/home/Component.tsx':base.tsx,
  'pages/home/component.css':base.css,
  'pages/home/design.json':JSON.stringify(snapshot),
  'library/code-files.json':JSON.stringify([{id:'demo-id',exportPath:'library/code/Example.tsx'}]),
  'library/code/Example.tsx':'export default function Example(){return <div>hello</div>}',
 }
 const output=generatePreviewFiles([{path:'/',directory:'pages/home',breakpoints:[]}],files)
 const jsx=requireText(output['preview/src/pages/_index/breakpoints/primary-0/Component.tsx'])
 assert.match(jsx,/FTA_Code_1/)
 assert.match(jsx,/enabled/)
 assert.match(jsx,/components\/code\/Example/)
 assert.match(requireText(output['preview/src/components/code/Example.tsx']),/hello/)
 assert.match(requireText(output['preview/src/framer-compat.ts']),/addPropertyControls/)
 assert.match(requireText(output['preview/vite.config.ts']),/framer-compat/)
})
