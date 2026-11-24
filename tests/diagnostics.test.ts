import type {DesignNode,Snapshot} from '../src/types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnosticsReport, diagnosticsMarkdown } from '../src/diagnostics.ts'
import { readLayer } from '../src/exporter.ts'
import { generateBundle } from '../src/generator.ts'
const ctx = (id:string, name:string, kind = 'ComponentInstanceNode', componentIdentifier = 'button-1') =>
  ({id,kind,attributes:{name,componentIdentifier,componentName:'Button',controls:{variant:'primary'}},children:[]})
const wrap = (roots:DesignNode[], extras:Partial<Snapshot> = {}):Snapshot => ({pagePath:'/cmp-ui',roots,...extras})
const library = (components:{id:string;name:string}[] = []) => ({files:{'library/components.json':JSON.stringify(components),'library/code-files.json':'[]'},warnings:[],limitations:[]})

test('1,050 repeated component instances are inventory, never 1,050 errors or fake warnings',() => {
  const children = Array.from({length:1050}, (_,i) => ctx('inst-'+i, 'Button '+i))
  const snapshot = wrap([{id:'page',kind:'WebPageNode',attributes:{name:'Dashboard'},children}])
  const result = buildDiagnosticsReport({snapshots:[snapshot],library:library([{id:'button-1',name:'Button'}])})
  assert.equal(result.summary.componentInstances,1050)
  assert.equal(result.summary.errors,0)
  assert.equal(result.summary.warnings,0)
  assert.equal(result.summary.reviews,0)
  assert.equal(result.components[0].count,1050)
  const bundle = generateBundle(snapshot)
  assert.equal(bundle.warnings.filter(x => /review component semantics/.test(x)).length,0)
})

test('unmatched component definitions produce one review finding with all affected layer locations',() => {
  const snapshot = wrap([{id:'page',kind:'WebPageNode',attributes:{name:'Dashboard'},children:Array.from({length:1050},(_,i)=>ctx('id-'+i,'Button'))}])
  const report=buildDiagnosticsReport({snapshots:[snapshot],library:library()})
  assert.equal(report.summary.errors,0)
  assert.equal(report.summary.warnings,0)
  assert.equal(report.summary.reviews,1)
  assert.equal(report.summary.reviewOccurrences,1050)
  const group=report.groups.find(x=>x.code==='COMPONENT_DEFINITION_NOT_EXPORTED')
  assert.ok(group)
  assert.equal(group.locations.length,1050)
  assert.equal(group.examples.length,12)
  assert.ok(group.locations[1049].nodeId==='id-1049')
  assert.match(diagnosticsMarkdown(report),/Plus 1038 more/)
})

test('real failures include severity, page, layer path, node id and suggested action', async () => {
  const node={id:'bad-text',name:'Confirm email',type:'TextNode',getText:async()=>{throw new Error('permission denied')},getChildren:async()=>[]}
  const state={count:0,maxNodes:10,warnings:new Set<string>()}
  const root=await readLayer(node,state)
  assert.ok(root)
  const report=buildDiagnosticsReport({snapshots:[wrap([root],{warnings:[...state.warnings]})],library:library()})
  assert.equal(report.summary.warnings,1)
  const group=report.groups.find(x=>x.code==='NODE_READ_FAILED')
  assert.ok(group)
  assert.match(group.message,/Confirm email.*bad-text.*plain text unavailable.*permission denied/)
  assert.equal(group.examples[0].page,'/cmp-ui')
  assert.match(group.fix!,/Inspect this layer/)
})

test('true incomplete exports are errors, not silently filed as reviews', () => {
  const report=buildDiagnosticsReport({snapshots:[wrap([{id:'p',kind:'WebPageNode',attributes:{name:'Page'},children:[]}],{truncated:true,nodeCount:6000})],library:library()})
  assert.equal(report.summary.errors,1)
  assert.equal(report.groups[0].code,'EXPORT_TRUNCATED')
})

test('asset bundle failure and page failure remain actionable', () => {
  const report=buildDiagnosticsReport({snapshots:[wrap([])],library:library(),assets:{manifest:[{url:'https://framerusercontent.com/x.webp',bundled:false,reason:'CORS blocked',usedBy:['page/image']}]},manifest:{failures:['/settings: getChildren failed']}})
  assert.equal(report.summary.errors,1)
  assert.equal(report.summary.warnings,1)
  assert.equal(report.groups[0].code,'PAGE_EXPORT_FAILED')
  assert.ok(report.groups.some(x=>x.code==='ASSET_BUNDLE_FAILED'))
})

test('legacy per-instance review messages are ignored, even if present in older exports',() => {
  const warnings=Array.from({length:1050},(_,i)=>`node-${i}: Framer component behavior/variants need agent review`)
  const report=buildDiagnosticsReport({snapshots:[wrap([], {warnings})],library:library()})
  assert.equal(report.groups.length,0)
})
