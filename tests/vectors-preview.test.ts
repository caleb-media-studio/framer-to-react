import type {DesignNode, Attributes, Snapshot, ArchiveFiles} from '../src/types.ts'
import {requireText} from './fixture-utils.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {svgMarkup, svgPath, safeSvg, inheritsIconColor} from '../src/vectors.ts'
import {generateBundle} from '../src/generator.ts'
import {collectAssetReferences,bundleAssets} from '../src/library.ts'
import {generatePreviewFiles} from '../src/preview.ts'
import {buildDiagnosticsReport} from '../src/diagnostics.ts'

const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 12h20" stroke="currentColor" /></svg>'
const snapshot:Snapshot & {roots:[DesignNode & {children:DesignNode[]}]} = {pagePath:'/cmp-ui/login', roots:[{kind:'FrameNode', id:'page',attributes:{name:'Login'},children:[{kind:'SVGNode',id:'icon-1',attributes:{name:'Arrow icon',svg:icon,width:24,height:24},children:[]}]}],warnings:[]}

test('reads SVG payload from Framer SVGNode and produces an actual SVG file', async()=>{
  assert.equal(svgMarkup(snapshot.roots[0].children[0]),icon)
  const rel=svgPath(icon)
  const tsx=generateBundle(snapshot).tsx
  assert.match(tsx, new RegExp(rel.replaceAll('/','\\/').replaceAll('.','\\.')))
  assert.match(tsx, /<svg /)
  assert.match(tsx, /stroke=\{"currentColor"\}/)
  assert.doesNotMatch(tsx, /maskImage/)
  const refs=collectAssetReferences([snapshot])
  assert.equal(refs.inlineSvg.length,1)
  const assets=await bundleAssets(refs)
  assert.equal(assets.manifest.length,1)
  assert.equal(assets.files[rel],icon)
  assert.deepEqual(assets.warnings,[])
})

test('deduplicates shared SVG markup across repeated icon instances and breakpoints', async()=>{
  const copy = structuredClone(snapshot)
  copy.roots[0].children.push({kind:'SVGNode',id:'icon-2',attributes:{svg:icon,name:'Arrow'},children:[]})
  const refs=collectAssetReferences([snapshot,copy])
  assert.equal(refs.inlineSvg.length,1)
  const result=await bundleAssets(refs)
  assert.equal(Object.keys(result.files).filter(f=>f.endsWith('.svg')).length,1)
})

test('rejects unsafe SVG markup rather than adding executable markup to preview',()=>{
  assert.throws(()=>safeSvg('<svg><script>alert(1)</script></svg>'))
  assert.throws(()=>safeSvg('<svg><image href="https://evil.test/a" /></svg>'))
  assert.equal(safeSvg(icon),icon)
})

test('missing Framer vector shape geometry is a specific warning, ordinary SVG is not',()=>{
  const report=buildDiagnosticsReport({snapshots:[{pagePath:'/',roots:[{kind:'FrameNode',id:'page',attributes:{},children:[{kind:'PathNode',id:'missing',attributes:{name:'Drawn vector'},children:[]}, {kind:'SVGNode',id:'valid',attributes:{name:'Arrow',svg:icon},children:[]}]}]}]})
  assert.equal(report.summary.warnings,1)
  assert.ok(report.groups.some(x=>x.code==='VECTOR_PATH_UNAVAILABLE' && x.examples[0].nodeId==='missing'))
  assert.ok(!report.groups.some(x=>x.code==='SVG_DATA_MISSING'))
})

test('creates a standalone runnable React/Vite preview for nested routes and breakpoint variants',()=>{
  const generated=generateBundle(snapshot)
  const source={
    'pages/cmp-ui/login/Component.tsx':generated.tsx,
    'pages/cmp-ui/login/component.css':generated.css,
    'pages/cmp-ui/login/breakpoints/1-mobile/Component.tsx':generated.tsx,
    'pages/cmp-ui/login/breakpoints/1-mobile/component.css':generated.css,
    'pages/cmp-ui/login/breakpoints/2-desktop/Component.tsx':generated.tsx,
    'pages/cmp-ui/login/breakpoints/2-desktop/component.css':generated.css,
    'library/tokens.css':':root{--brand:#123456}',
    ['assets/vectors/'+svgPath(icon).split('/').at(-1)]:icon,
    'assets/manifest.json':'{"assets":[]}',
  }
  const files=generatePreviewFiles([{path:'/cmp-ui/login',directory:'pages/cmp-ui/login',breakpoints:[{id:'mobile',name:'Mobile',directory:'pages/cmp-ui/login/breakpoints/1-mobile',width:390},{id:'desktop',name:'Desktop',directory:'pages/cmp-ui/login/breakpoints/2-desktop',width:1440}]}],source,{diagnostics:{summary:{errors:0,warnings:0}}})
  assert.match(requireText(files['preview/package.json']),/"react"/)
  assert.match(requireText(files['preview/package.json']),/"tailwindcss"/)
  assert.match(requireText(files['preview/src/App.tsx']),/import \{ routes \} from '\.\/routes'/)
  assert.match(requireText(files['preview/src/pages/cmp-ui/login/Page.tsx']),/Variant_1/)
  assert.match(requireText(files['preview/src/routes.ts']),/pages\/cmp-ui\/login\/Page/)
  assert.match(requireText(files['preview/src/App.tsx']),/Auto \(viewport\)/)
  assert.match(requireText(files['preview/src/App.tsx']),/get\('fidelity'\) === '1'/)
  assert.match(requireText(files['preview/src/App.tsx']),/!showChrome && !cleanView/)
  assert.match(requireText(files['preview/src/pages/cmp-ui/login/Page.tsx']),/width:390/)
  assert.match(requireText(files['preview/src/pages/cmp-ui/login/Page.tsx']),/width:1440/)
  assert.match(requireText(files['preview/src/App.tsx']),/cmp-ui\/login/)
  assert.match(requireText(files['preview/src/styles.css']),/@import "tailwindcss"/)
  assert.ok(files['preview/src/pages/cmp-ui/login/breakpoints/390-0/Component.tsx'])
  assert.ok(files['preview/src/pages/cmp-ui/login/breakpoints/1440-1/Component.tsx'])
  assert.equal(files['preview/public/'+svgPath(icon)],icon)
  assert.match(requireText(files['preview/README.md']),/npm run dev/)
})

test('monochrome SVG icons inherit CSS currentColor, multicolor SVG logos keep image mode',()=>{
  assert.equal(inheritsIconColor(icon),true)
  const multi='<svg><path fill="currentColor" /><path fill="#ff0000" /></svg>'
  assert.equal(inheritsIconColor(multi),false)
  const b=generateBundle({roots:[{kind:'SVGNode',id:'logo',attributes:{name:'Multi-color',svg:multi,width:60},children:[]}]})
  assert.match(b.tsx, /<img/)
})

test('hidden monochrome SVGs do not override hidden display or occupy stack space', () => {
  const hidden = structuredClone(snapshot)
  hidden.roots[0].children[0].attributes!.visible = false
  const hiddenBundle = generateBundle(hidden)
  assert.match(hiddenBundle.tsx,/display: "none"/)
  assert.doesNotMatch(hiddenBundle.tsx,/display: "inline-block"/)
  assert.match(generateBundle(snapshot).tsx,/display: "inline-block"/)
})
