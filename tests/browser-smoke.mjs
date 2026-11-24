import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {createServer} from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(process.argv[2]||'.local/demo-app/dist')
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname
  let file=path.resolve(root,'.'+decodeURIComponent(pathname))
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(400).end();return}
  let content
  try{content=await fs.readFile(file)}catch{if(pathname.startsWith('/assets/')){res.writeHead(404).end();return}file=path.join(root,'index.html');content=await fs.readFile(file)}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(content)
 }catch{res.writeHead(500).end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}})
 const errors=[],requests=new Set()
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
 console.log('Browser smoke passed: lazy routes, original named TSX component and controls, editable field, history, responsive variant, direct URL.')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}

