import type {InlineTextRun} from './types.ts'

// Deliberately narrow CSS allowlist, shared by evidence import and JSX generation.
// No raw markup, URL, custom CSS, or user-provided executable content is accepted.
export function validateInlineRuns(input:unknown, original:unknown):InlineTextRun[]|null {
  if(typeof original!=='string'||!Array.isArray(input)||!input.length||input.length>2000)return null
  const runs:InlineTextRun[]=[]
  for(const r of input){
    if(!r||typeof r.text!=='string'||!r.text||!r.style||typeof r.style!=='object'||Array.isArray(r.style))return null
    const style:Record<string,string>={}
    for(const [k,v] of Object.entries(r.style)){
      if(typeof v!=='string')return null
      const ok=k==='fontSize'||k==='lineHeight'?/^(?:[0-9]+(?:\.[0-9]+)?px|normal)$/.test(v):
        k==='letterSpacing'?/^(?:-?[0-9]+(?:\.[0-9]+)?px|normal)$/.test(v):
        k==='fontWeight'?/^(?:[1-9]00|normal|bold)$/.test(v):
        k==='fontStyle'?/^(normal|italic|oblique)$/.test(v):
        k==='color'?/^rgba?\([0-9.,\s%/]+\)$/.test(v):false
      if(!ok)return null
      style[k]=v
    }
    runs.push({text:r.text,style})
  }
  return runs.map(r=>r.text).join('')===original&&runs.some(r=>Object.keys(r.style).length)?runs:null
}
