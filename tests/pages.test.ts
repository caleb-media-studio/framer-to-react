import type {SDKNode,Attributes} from '../src/types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePath, safeFilePath, discoverPages, withinFolder, buildPageTree, findBreakpoints, packagePage, capturePage } from '../src/pages.ts'

function node(id:string,name:string,more:Attributes={},children:SDKNode[]=[]):SDKNode {
  return {id,name,...more,async getChildren(){return children}}
}

test('discovers web pages and design pages with fallback namespace', async () => {
  const f = {async getNodesWithType(kind:string) {
    return kind === 'WebPageNode' ? [node('home','Home',{path:'/'}),node('one','Test',{path:'/cmp-ui/settings/users'})] : [node('canvas','Exploration')]
  }}
  const {pages} = await discoverPages(f)
  assert.deepEqual(pages.map(p=>p.path), ['/','/_design-pages/Exploration-canvas','/cmp-ui/settings/users'])
})

test('selecting folder includes all nested descendants, not sibling prefixes', () => {
  assert.equal(withinFolder('/cmp-ui/a/b','/cmp-ui'),true)
  assert.equal(withinFolder('/cmp-ui-other/a','/cmp-ui'),false)
  assert.equal(withinFolder('/cmp-ui','/cmp-ui'),true)
  assert.equal(withinFolder('/cmp-ui/x','/'),true)
  assert.equal(normalizePath('/cmp-ui//a/'),'/cmp-ui/a')
})

test('builds nested folder tree and preserves leaf pages', () => {
  const pages=[{path:'/cmp-ui/page'},{path:'/cmp-ui/settings/general'},{path:'/cmp-ui/settings/security'}]
  const root=buildPageTree(pages)
  assert.equal(root.children[0].name,'cmp-ui')
  assert.equal(root.children[0].pages.length,1)
  assert.equal(root.children[0].children[0].pages.length,2)
})

test('captures all page layers and responsive variants, primary draft separated', async () => {
  const desktop=node('desktop','Desktop',{isBreakpoint:true,isPrimaryBreakpoint:true, width:1200},[node('text','Heading',{type:'TextNode',async getText(){return 'Desktop headline'}})])
  const mobile=node('mobile','Mobile',{isBreakpoint:true,width:390},[node('mobileText','Mobile Heading',{type:'TextNode',async getText(){return 'Mobile headline'}})])
  const page={id:'test',path:'/cmp-ui/sample',type:'web',node:node('p','Page',{path:'/cmp-ui/sample'},[desktop,mobile])}
  const snapshot=await capturePage(page)
  assert.equal(snapshot.nodeCount,5)
  assert.equal(findBreakpoints(snapshot.roots[0]).length,2)
  const {files,record}=packagePage(page,snapshot)
  assert.equal(record.breakpoints.length,2)
  assert.match(files['pages/cmp-ui/sample/Component.tsx'],/Desktop headline/)
  assert.doesNotMatch(files['pages/cmp-ui/sample/Component.tsx'],/Mobile headline/)
  assert.match(files['pages/cmp-ui/sample/breakpoints/2-Mobile/Component.tsx'],/Mobile headline/)
  assert.match(files['pages/cmp-ui/sample/design.json'],/Mobile headline/)
})

test('safely normalizes unsafe archive paths and detects truncation', async () => {
  assert.equal(safeFilePath('/../bad/../../one'), 'untitled/bad/untitled/untitled/one')
  const page={id:'a',path:'/p',type:'web',node:node('p','Top',{},[node('b','Nested')])}
  const snapshot=await capturePage(page,1)
  assert.equal(snapshot.truncated,true)
  assert.equal(snapshot.nodeCount,1)
})

test('gracefully reports SDKs without design-page enumeration', async () => {
  const f={async getNodesWithType(type:string){if(type==='DesignPageNode')throw new Error('unknown type');return [node('id','X',{path:'/cmp-ui'})]}}
  const r=await discoverPages(f)
  assert.equal(r.pages.length,1)
  assert.equal(r.warnings.length,1)
})
