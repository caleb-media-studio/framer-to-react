import {collectRenderAudit,compareRenderAudit} from '../verification/render-audit.ts'
import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {createServer} from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(process.argv[2]||'.local/demo-app/dist')
const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url??"/",'http://localhost').pathname
  let file=path.resolve(root,'.'+decodeURIComponent(pathname))
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(400).end();return}
  let content
  try{content=await fs.readFile(file)}catch{if(pathname.startsWith('/assets/')){res.writeHead(404).end();return}file=path.join(root,'index.html');content=await fs.readFile(file)}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(content)
 }catch{res.writeHead(500).end()}
})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
const address=server.address()
assert(address && typeof address!=='string')
const url='http://127.0.0.1:'+address.port
const browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}})
 const errors:string[]=[],requests=new Set<string>()
 page.on('pageerror',e=>errors.push(String(e)))
 page.on('request',r=>{if(/\/assets\/Page-.*\.js$/.test(new URL(r.url()).pathname))requests.add(new URL(r.url()).pathname)})
 await page.goto(url+'/?fidelity=1')
 await page.getByText('Welcome to the demo',{exact:true}).waitFor()
 await page.locator('[data-demo-badge]').waitFor()
 assert.equal(await page.locator('[data-demo-badge]').textContent(),'Ready')
 assert.equal(requests.size,1,'only active page chunk loaded')
 const input=page.locator('.exported-page input[type=email]')
 await input.fill('person@example.test')
 assert.equal(await input.inputValue(),'person@example.test')
 await page.getByRole('link',{name:'Details',exact:true}).click()
 await page.getByText('Details page',{exact:true}).waitFor()
 assert.equal(await page.locator('[data-demo-badge]').textContent(),'Details ready')
 assert.equal(requests.size,2,'new route fetched on navigation')
 await page.goBack()
 await page.getByText('Welcome to the demo',{exact:true}).waitFor()
 await page.setViewportSize({width:390,height:900})
 await page.waitForFunction(()=>document.querySelector('.exported-page [data-f2a-node="page-0-390-title"]'))
 await page.goto(url+'/details?fidelity=1')
 await page.getByText('Details page',{exact:true}).waitFor()
 assert.equal(errors.length,0,errors.join('\n'))
 // Browser-level regression: a matching overall text layout does not excuse a missing
 // thin line, a wrong font weight/color, or a hidden/transparent separator.
 const auditPage=await browser.newPage({viewport:{width:390,height:900}})
 const surface='<style>body{margin:0;font:600 10px/12px Arial;color:rgb(145,152,161)}p{margin:0}.rule{width:300px;height:1px;background:rgb(51,51,51)}.hidden{visibility:hidden}</style>'
 await auditPage.setContent(surface+'<div data-framer-component-type="RichTextContainer" data-framer-name="Label"><p>Schedule decision</p></div><div class="rule" data-framer-name="Separator"></div><div class="rule hidden" data-framer-name="Hidden"></div>')
 const source=await auditPage.evaluate(collectRenderAudit,'source' as const)
 assert.equal(source.texts.length,1);assert.equal(source.lines.length,1)
 await auditPage.setContent(surface+'<p data-f2a-node="label">Schedule decision</p><div class="rule" data-f2a-node="rule"></div>')
 const matching=await auditPage.evaluate(collectRenderAudit,'candidate' as const)
 assert.deepEqual(compareRenderAudit(source,matching).findings,[])
 await auditPage.locator('[data-f2a-node="rule"]').evaluate(el=>el.remove())
 await auditPage.locator('[data-f2a-node="label"]').evaluate(el=>{(el as HTMLElement).style.fontWeight='400';(el as HTMLElement).style.color='white'})
 const broken=compareRenderAudit(source,await auditPage.evaluate(collectRenderAudit,'candidate' as const))
 assert.equal(broken.lineMatched,0);assert.equal(broken.textMatched,0)
 assert.ok(broken.findings.some(f=>f.fields.some(x=>x.field==='divider.presence')))
 assert.ok(broken.findings.some(f=>f.fields.some(x=>x.field==='fontWeight')))
 assert.ok(broken.findings.some(f=>f.fields.some(x=>x.field==='color')))
 // A Framer wrapper may have default link styles while its nested span paints the text.
 await auditPage.setContent('<div data-framer-component-type="RichTextContainer" style="color:blue;font:16px Arial"><span style="display:block"><span style="font:400 12px/14.4px Arial;color:rgb(145,152,161)">Nested label</span></span></div>')
 const nested=await auditPage.evaluate(collectRenderAudit,'source' as const)
 assert.equal(nested.texts[0].style.fontSize,'12px')
 assert.equal(nested.texts[0].style.color,'rgb(145, 152, 161)')
 assert.equal(nested.texts[0].style.fontWeight,'400')
 await auditPage.close()
 console.log('Browser smoke passed: lazy routes, original named TSX component and controls, editable field, history, responsive variant, direct URL.')
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}

