export function serializeReferenceVector(input:unknown):string|null {
  const vector = input as {viewBox?:unknown;shapes?:unknown[]} | null
  if (!vector || typeof vector !== 'object' || !Array.isArray(vector.shapes) || vector.shapes.length < 1 || vector.shapes.length > 128) return null
  const nums = /^[-+\d.eE,\s]+$/
  const numberList = (v:unknown):v is string => typeof v === 'string' && v.length < 512 && nums.test(v) && v.trim().split(/[\s,]+/).every(x=>Number.isFinite(Number(x)))
  const viewBox = vector.viewBox
  if (!numberList(viewBox) || viewBox.trim().split(/[\s,]+/).length !== 4 || viewBox.trim().split(/[\s,]+/).slice(2).some(v=>Number(v)<=0)) return null
  const tags = new Set(['path','rect','circle','ellipse','line','polyline','polygon','g'])
  const paint = (v:string) => /^(?:none|transparent|currentColor|#[0-9a-f]{3,8}|rgba?\([\d.,\s%/]+\))$/i.test(v)
  const numeric = (v:string) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:px|%)?$/i.test(v)
  const numericAttrs = new Set(['x','y','x1','x2','y1','y2','width','height','rx','ry','r','cx','cy','stroke-width','stroke-miterlimit','opacity','fill-opacity','stroke-opacity','stroke-dashoffset'])
  const escape = (v:string) => v.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
  let count=0
  function shape(input:unknown,depth=0):string {
    const n=input as {tag:string;attrs:Record<string,unknown>;children?:unknown[]} | null
    if (!n || !tags.has(n.tag) || depth>12 || ++count>256 || !n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs)) throw new Error('unsupported vector shape')
    const attrs=[]
    for(const [key,v] of Object.entries(n.attrs)){
      if(typeof v!=='string'||v.length>40000)throw new Error('invalid vector attribute')
      let valid=false
      if(numericAttrs.has(key))valid=numeric(v)
      else if(key==='d')valid=/^[MmLlHhVvCcSsQqTtAaZzEe\d+.,\s-]+$/.test(v)
      else if(key==='points'||key==='stroke-dasharray')valid=numberList(v)||key==='stroke-dasharray'&&v==='none'
      else if(key==='fill'||key==='stroke')valid=paint(v)
      else if(key==='transform')valid=/^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([-+\d.eE,\s]+\)\s*)+$/.test(v)
      else if(key==='fill-rule'||key==='clip-rule')valid=/^(nonzero|evenodd)$/.test(v)
      else if(key==='stroke-linecap')valid=/^(butt|round|square)$/.test(v)
      else if(key==='stroke-linejoin')valid=/^(miter|round|bevel)$/.test(v)
      else if(key==='vector-effect')valid=v==='non-scaling-stroke'
      if(!valid)throw new Error('unsupported vector attribute')
      attrs.push(key+'="'+escape(v)+'"')
    }
    const children=n.children??[]
    if(!Array.isArray(children)||children.length>128||n.tag!=='g'&&children.length)throw new Error('unsupported nested vector')
    return '<'+n.tag+(attrs.length?' '+attrs.join(' '):'')+'>'+children.map(c=>shape(c,depth+1)).join('')+'</'+n.tag+'>'
  }
  try { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+escape(viewBox)+'">'+vector.shapes.map(n=>shape(n)).join('')+'</svg>' } catch { return null }
}
