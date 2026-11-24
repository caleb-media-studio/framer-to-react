import {compareStyle, compareBox, type Box, type Style, type FieldMismatch} from './fidelity-compare.ts'

export interface RenderText {text:string;name:string;style:Style;box:Box}
export interface PaintedLine {name:string;box:Box;axis:'horizontal'|'vertical';color:string;opacity:number}
export interface RenderAudit {texts:RenderText[];lines:PaintedLine[]}
export interface AuditFinding {nodeId:string;name:string;fields:FieldMismatch[]}
export interface AuditResult {textExpected:number;textActual:number;lineExpected:number;lineActual:number;textMatched:number;lineMatched:number;findings:AuditFinding[]}

/** Executed in the browser on both source and candidate. No archive mappings or cached styles. */
export function collectRenderAudit(side:'source'|'candidate'):RenderAudit {
  const texts:RenderText[]=[],lines:PaintedLine[]=[]
  const visible=(e:Element)=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})
  const box=(e:Element):Box=>{const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}}
  const name=(e:Element)=>e.getAttribute('data-framer-name')||e.getAttribute('data-f2a-node')||e.tagName.toLowerCase()
  const normalize=(s:string)=>s.normalize('NFC').replace(/\s+/g,' ').trim()
  const textSelector=side==='source'?'[data-framer-component-type="RichTextContainer"]':'[data-f2a-node]'
  for(const el of document.querySelectorAll(textSelector)){
    if(!visible(el))continue
    if(side==='candidate'&&el.querySelector('[data-f2a-node]'))continue
    if(side==='candidate'&&el.matches('input,textarea,select,svg,img'))continue
    const text=normalize(el.textContent||'')
    if(!text)continue
    let block=el.matches('p,h1,h2,h3,h4,h5,h6,li')?el:el.querySelector('p,h1,h2,h3,h4,h5,h6,li')||el
    while(block.children.length===1&&block.firstElementChild?.tagName==='SPAN'&&block.firstElementChild.textContent===block.textContent&&/^(inline|block|inline-block)$/.test(getComputedStyle(block.firstElementChild).display))block=block.firstElementChild
    const css=getComputedStyle(block)
    const style:Style={}
    for(const k of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','textTransform','color','fontStyle','textDecorationLine'] as const)style[k]=css[k]
    texts.push({text,name:name(el),style,box:box(el)})
  }
  const nodes=document.querySelectorAll(side==='source'?'[data-framer-name],hr':'[data-f2a-node],hr')
  for(const el of nodes){
    if(!visible(el)||normalize(el.textContent||''))continue
    const b=box(el),s=getComputedStyle(el)
    if(b.width<=0||b.height<=0)continue
    // Physical geometry, not layer-name heuristics: detect thin painted rectangles.
    const axis=b.height<=3&&b.width>=8&&b.width>=4*b.height?'horizontal':b.width<=3&&b.height>=8&&b.height>=4*b.width?'vertical':null
    if(!axis)continue
    const thickness=axis==='horizontal'?b.height:b.width
    const color=s.backgroundColor
    const opaque=color!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color)
    const effectiveOpacity=(()=>{let o=1;for(let e:Element|null=el;e;e=e.parentElement)o*=Number(getComputedStyle(e).opacity);return o})()
    if(opaque&&effectiveOpacity>0){
      lines.push({name:name(el),box:b,axis,color,opacity:effectiveOpacity});continue
    }
    // Thin HR/border-only divider. Check actual border paint and the overlay generated
    // by the compiler. Thick container borders are outside this initial audit scope.
    const edge=axis==='horizontal'?'Top':'Left'
    const pseudo=getComputedStyle(el,'::after')
    for(const style of [s,...(pseudo.content!=='none'&&pseudo.content!=='normal'?[pseudo]:[])]){
      const width=parseFloat(style.getPropertyValue('border-'+edge.toLowerCase()+'-width'))
      const paint=style.getPropertyValue('border-'+edge.toLowerCase()+'-color')
      const kind=style.getPropertyValue('border-'+edge.toLowerCase()+'-style')
      if(width>0&&width<=thickness&&kind!=='none'&&kind!=='hidden'&&paint!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(paint)&&effectiveOpacity>0){
        lines.push({name:name(el),box:{...b,...(axis==='horizontal'?{height:width}:{width})},axis,color:paint,opacity:effectiveOpacity});break
      }
    }
  }
  return {texts,lines}
}

/** A group is verified only if every expected member has a distinct matching actual member.
 * This does not assert individual source IDs for repeated/ambiguous content.
 */
function matchAll<T>(expected:T[],actual:T[],fields:(a:T,b:T)=>FieldMismatch[]):{matched:number;missing:T[];extra:T[]} {
  const edges=expected.map(a=>actual.map((b,i)=>({i,ok:fields(a,b).length===0})).filter(x=>x.ok).map(x=>x.i))
  const owner=new Map<number,number>()
  function assign(i:number,seen:Set<number>):boolean {
    for(const j of edges[i]){
      if(seen.has(j))continue;seen.add(j)
      const prev=owner.get(j)
      if(prev===undefined||assign(prev,seen)){owner.set(j,i);return true}
    }
    return false
  }
  for(let i=0;i<expected.length;i++)assign(i,new Set())
  const used=new Set(owner.values())
  return {matched:owner.size,missing:expected.filter((_,i)=>!used.has(i)),extra:actual.filter((_,i)=>!owner.has(i))}
}
function textFields(a:RenderText,b:RenderText):FieldMismatch[]{
  const extra=['fontStyle','textDecorationLine'].filter(k=>a.style[k]!==b.style[k]).map(k=>({field:k,expected:a.style[k],actual:b.style[k]}))
  return [...compareStyle(a.style,b.style),...compareBox(a.box,b.box),...extra]
}
export function lineFields(a:PaintedLine,b:PaintedLine):FieldMismatch[]{
  const fields=compareBox(a.box,b.box)
  // A 1px line becoming a 2px line must not pass the existing 2px geometry tolerance.
  const thickness=a.axis==='horizontal'?'height':'width'
  if(Math.abs(a.box[thickness]-b.box[thickness])>0.1&&!fields.some(f=>f.field==='bbox.'+thickness))
    fields.push({field:'line.thickness',expected:a.box[thickness],actual:b.box[thickness]})
  if(a.color!==b.color)fields.push({field:'line.color',expected:a.color,actual:b.color})
  if(Math.abs(a.opacity-b.opacity)>0.001)fields.push({field:'line.opacity',expected:a.opacity,actual:b.opacity})
  return fields
}
const distance=(a:Box,b:Box)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.width-b.width)+Math.abs(a.height-b.height)
export function compareRenderAudit(source:RenderAudit,candidate:RenderAudit):AuditResult {
  const findings:AuditFinding[]=[]
  let textMatched=0,lineMatched=0
  function compareGroup<T extends {name:string;box:Box}>(kind:string,label:string,a:T[],b:T[],compare:(a:T,b:T)=>FieldMismatch[]):number{
    const {matched,missing,extra}=matchAll(a,b,compare)
    // Pair only the residual observations for human diagnostics. No correction or identity inference.
    const remain=[...extra]
    for(const x of missing){
      const nearest=remain.sort((u,v)=>distance(x.box,u.box)-distance(x.box,v.box))[0]
      const fields:FieldMismatch[]=nearest?compare(x,nearest):[{field:kind+'.presence',expected:'present',actual:'missing'}]
      if(nearest)remain.shift()
      findings.push({nodeId:'(render-audit)',name:kind+' '+label+' / '+x.name,fields:fields.length?fields:[{field:kind+'.match',expected:'distinct match',actual:'unresolved'}]})
    }
    for(const x of remain)findings.push({nodeId:'(render-audit)',name:kind+' '+label+' / '+x.name,fields:[{field:kind+'.presence',expected:'absent',actual:'extra'}]})
    return matched
  }
  const groups=(items:RenderText[])=>{const map=new Map<string,RenderText[]>();for(const t of items){const a=map.get(t.text)||[];a.push(t);map.set(t.text,a)}return map}
  const a=groups(source.texts),b=groups(candidate.texts)
  for(const text of new Set([...a.keys(),...b.keys()]))textMatched+=compareGroup('text',text.slice(0,100),a.get(text)||[],b.get(text)||[],textFields)
  for(const axis of ['horizontal','vertical'] as const)lineMatched+=compareGroup('divider',axis,source.lines.filter(l=>l.axis===axis),candidate.lines.filter(l=>l.axis===axis),lineFields)
  return {textExpected:source.texts.length,textActual:candidate.texts.length,lineExpected:source.lines.length,lineActual:candidate.lines.length,textMatched,lineMatched,findings}
}
