import type {DesignNode,Snapshot,Manifest,TextEvidence,Rect} from '../src/types.ts'
interface ArchiveVector {id:string;name:string;ancestors:string[];width:number;height:number}
interface VectorShape {tag:string;attrs:Record<string,string>;children:VectorShape[]}
interface LiveVector {name:string;ancestors:string[];width:number;height:number;bbox:Rect;domPath:string;vector:{viewBox:string;shapes:VectorShape[]}}
// Published SVG evidence is opt-in; capture only local, simple vector artwork.
import {chromium} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {serializeReferenceVector} from '../src/reference-vector.ts'

export function matchVectors(archive:ArchiveVector[], live:LiveVector[]):TextEvidence[] {
  const matches:TextEvidence[]=[]
  const eligible=(a:ArchiveVector,l:LiveVector)=>a.name===l.name && a.ancestors.length>=1 && JSON.stringify(a.ancestors)===JSON.stringify(l.ancestors.slice(-a.ancestors.length)) &&
    Math.abs(a.width-l.width)<=1 && Math.abs(a.height-l.height)<=1
  for(const a of archive){
    const ls=live.filter(l=>eligible(a,l))
    if(ls.length!==1||archive.filter(x=>eligible(x,ls[0])).length!==1)continue
    if(!serializeReferenceVector(ls[0].vector))continue
    matches.push({nodeId:a.id,confidence:'high',method:'name+exact-ancestry+captured-dimensions',vector:ls[0].vector,framerName:a.name,domPath:ls[0].domPath,bbox:ls[0].bbox})
  }
  return matches
}
export function archiveVectors(frame:DesignNode):ArchiveVector[] {
  const out:ArchiveVector[]=[]
  function visit(n:DesignNode,ancestors:string[]):void{
    const a=n.attributes||{}
    if(a.visible===false)return
    if(['SVGNode','ComponentInstanceNode','IconNode'].includes(n.kind)&&!n.children?.length&&!a.svg&&!a.svgContent&&a.name&&n.rect&&n.rect.width>0&&n.rect.height>0){
      out.push({id:n.id,name:a.name,ancestors,width:n.rect.width,height:n.rect.height})
    }
    for(const c of n.children||[])visit(c,n===frame?ancestors:[...ancestors,...(a.name?[a.name]:[])])
  }
  visit(frame,[]);return out
}
export function collectVectors():LiveVector[]{
  const tags=new Set(['path','rect','circle','ellipse','line','polyline','polygon','g'])
  const allowed=new Set(['d','points','x','y','x1','x2','y1','y2','width','height','rx','ry','r','cx','cy','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-miterlimit','opacity','fill-opacity','stroke-opacity','fill-rule','clip-rule','transform','vector-effect'])
  const meta=new Set(['id','class','role','display','xmlns','data-framer-name','aria-hidden'])
  const out:LiveVector[]=[]
  for(const e of document.querySelectorAll<SVGSVGElement>('svg[data-framer-name]')){
    if(!e.checkVisibility())continue
    const r=e.getBoundingClientRect();if(!r.width||!r.height)continue
    const uses=e.querySelectorAll('use')
    let source:Element|null=e,context:Element=e
    if(uses.length){
      if(uses.length!==1||e.children.length!==1)continue
      const u=uses[0],href=u.getAttribute('href')||u.getAttribute('xlink:href')||''
      if(!/^#[\w-]+$/.test(href)||[...u.attributes].some(a=>!['href','xlink:href'].includes(a.name)))continue
      source=document.getElementById(href.slice(1));context=u
      if(!source||!['svg','symbol'].includes(source.localName))continue
    }
    const vb=e.getAttribute('viewBox')||source.getAttribute('viewBox')
    if(!vb)continue
    const cs=getComputedStyle(context)
    function resolve(value:string,depth=0):string{
      if(depth>8)throw Error('recursive variable')
      const m=value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/)
      if(m){const v=cs.getPropertyValue(m[1]).trim()||m[2];if(!v)throw Error('missing paint');return resolve(v,depth+1)}
      return value.trim()==='currentColor'?cs.color:value.trim()
    }
    function shape(n:Element):VectorShape{
      if(!tags.has(n.localName))throw Error('unsupported geometry')
      const attrs:Record<string,string>={}
      for(const a of n.attributes){
        if(meta.has(a.name))continue
        if(!allowed.has(a.name))throw Error('unsupported attribute')
        if(a.name==='stroke-dasharray'&&!a.value.trim())continue
        attrs[a.name]=resolve(a.value)
      }
      return {tag:n.localName,attrs,children:[...n.children].map(shape)}
    }
    try{
      // Preserve root-level inherited paint without importing page styles or arbitrary markup.
      const shapes=[...source.children].map(shape)
      if(!shapes.length)continue
      const rootAttrs:Record<string,string>={}
      for(const k of ['fill','stroke','stroke-width','fill-opacity','stroke-opacity','stroke-linecap','stroke-linejoin']){
        const v=source.getAttribute(k)||e.getAttribute(k)
        if(v)rootAttrs[k]=resolve(v)
      }
      // Root attributes not explicitly represented cannot be reconstructed reliably.
      if(e.hasAttribute('style')&&e.style.transform)continue
      const vector={viewBox:vb,shapes:Object.keys(rootAttrs).length?[{tag:'g',attrs:rootAttrs,children:shapes}]:shapes}
      const ancestors:string[]=[],parts:string[]=[]
      for(let p:Element|null=e;p&&p!==document.body;p=p.parentElement){
        const name=p.getAttribute('data-framer-name')
        if(p!==e&&name)ancestors.unshift(name)
        parts.unshift(p.localName+':nth-child('+([...(p.parentElement?.children??[])].indexOf(p)+1)+')')
      }
      out.push({name:e.getAttribute('data-framer-name')??'',ancestors,width:r.width,height:r.height,bbox:{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height},domPath:parts.join('>'),vector})
    }catch{}
  }
  return out
}
async function main(){
 const [exp,base,out,...routes]=process.argv.slice(2)
 if(!exp||!base||!out||!routes.length)throw Error('Usage: node schema/vector-evidence.ts <export> <publishedURL> <evidenceDir> <routes or all>')
 const pages=(JSON.parse(fs.readFileSync(path.join(exp,'manifest.json'),'utf8')) as Manifest).pages??[]
 fs.mkdirSync(out,{recursive:true})
 const browser=await chromium.launch()
 const selected=pages.filter(p=>routes.includes('all')||routes.includes(p.path))
 let cursor=0
 async function worker(){
 while(cursor<selected.length){
 const pg=selected[cursor++]

 const design=JSON.parse(fs.readFileSync(path.join(exp,pg.directory,'design.json'),'utf8')) as Snapshot
 for(const frame of (design.roots[0].children??[]).filter(n=>n.attributes?.isBreakpoint)){
 const width=parseFloat(String(frame.attributes?.width??""))
 if(!Number.isFinite(width)||width<100||width>10000)continue
 const arch=archiveVectors(frame)
 if(!arch.length)continue
 const p=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'})
 try{
 const url=new URL(pg.path,base).href,res=await p.goto(url,{waitUntil:'networkidle',timeout:30000})
 if(!res?.ok()){console.log(JSON.stringify({route:pg.path,width,error:res?.status()}));continue}
 await p.evaluate(()=>document.fonts.ready)
 const body=await res.body(), live=await p.evaluate(collectVectors)
 const vectors=matchVectors(arch,live)
 const stem=pg.path==='/'?'_index':pg.path.slice(1).replaceAll('/','_')
 const file=path.join(out,stem+'.'+width+'.json')
 if(!fs.existsSync(file)){console.log(JSON.stringify({route:pg.path,width,skipped:'no text evidence'}));continue}
 const doc=JSON.parse(fs.readFileSync(file,"utf8"))
 // Do not mix two revisions of the source; if HTML differs, recapture text evidence first.
 const hash=createHash('sha256').update(body).digest('hex')
 if(doc.breakpointId!==frame.id||doc.provenance?.url!==url||doc.provenance?.responseSha256!==hash){console.log(JSON.stringify({route:pg.path,width,skipped:'source revision differs'}));continue}
 doc.vectors=vectors
 doc.vectorProvenance={source:'published-site',url,viewport:{width,height:900},responseSha256:hash,capturedAt:new Date().toISOString()}
 fs.writeFileSync(file,JSON.stringify(doc,null,2))
 console.log(JSON.stringify({route:pg.path,width,missing:arch.length,observed:live.length,matched:vectors.length}))
 }catch(error){console.log(JSON.stringify({route:pg.path,width,error:String(error)}))}finally{await p.close().catch(()=>{})}
 }
 }
 }
 try{await Promise.all(Array.from({length:4},worker))}finally{await browser.close()}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+path.resolve(process.argv[1])).href)await main()
