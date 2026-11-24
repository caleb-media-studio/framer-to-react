import test from 'node:test'
import assert from 'node:assert/strict'
import {generateBundle} from '../src/generator.ts'
import {hydrateArchiveCodeComponents} from '../src/archive-hydration.ts'
test('hydrates original React code into standalone page and breakpoint archives', () => {
  const snapshot={roots:[{kind:'ComponentInstanceNode',id:'one',attributes:{name:'Editor demo',componentIdentifier:'codeFile/123demo:default',controls:{ready:true}},children:[]}],warnings:[]}
  const generated=generateBundle(snapshot)
  const files:Record<string,string>={
    'library/code-files.json':JSON.stringify([{id:'123demo',exportPath:'library/code/Widget.tsx'}]),
    'library/code/Widget.tsx':'export default function Widget(){return null}',
  }
  for(const dir of ['pages/demo','pages/demo/breakpoints/mobile']) {
    files[dir+'/design.json']=JSON.stringify(snapshot)
    files[dir+'/Component.tsx']=generated.tsx
    files[dir+'/component.css']=generated.css
  }
  const count=hydrateArchiveCodeComponents([{path:'/demo',directory:'pages/demo',breakpoints:[{id:'mobile',directory:'pages/demo/breakpoints/mobile'}]}],files)
  assert.equal(count,2)
  assert.match(files['pages/demo/Component.tsx'],/import FTA_Code_1 from "\.\.\/\.\.\/library\/code\/Widget"/)
  assert.match(files['pages/demo/breakpoints/mobile/Component.tsx'],/import FTA_Code_1 from "\.\.\/\.\.\/\.\.\/\.\.\/library\/code\/Widget"/)
  assert.match(files['pages/demo/Component.tsx'],/ready/)
})
