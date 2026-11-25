import type {OfficialNode} from './official-layouts.ts'
export interface EditorTextRun {text?:string;lineBreak?:true;style?:Record<string,unknown>}
export interface EditorTextBlock {tag:string;style:Record<string,unknown>;runs:EditorTextRun[]}
export interface EditorRichText {blocks:EditorTextBlock[];base:Record<string,unknown>}
const fields=['fontName','fontSize','fontWeight','fontStyle','textColor','lineHeight','letterSpacing','textAlignment','textAlign','textDecoration','textTransform','textWrap','openTypeFontFeatures'] as const
const pick=(n:OfficialNode)=>Object.fromEntries(fields.filter(k=>n[k]!==undefined&&n[k]!==null).map(k=>[k,n[k]]))
/** Resolve original RichTextNode → TextBlock → TextRun data without flattening
 * mixed formatting. Uniform source values may be inherited; differing values
 * remain occurrence-local. No published DOM evidence is accepted. */
export function deriveEditorRichText(n:OfficialNode):EditorRichText|null{
 const blocks:EditorTextBlock[]=[]
 if(!Array.isArray(n.children)||!n.children.length)return null
 for(const block of n.children){
  if(block.type!=='TextBlock'||!Array.isArray(block.children))return null
  const style={...pick(n),...pick(block)}
  const runs:EditorTextRun[]=[]
  for(const run of block.children){
   if(run.type==='TextLineBreak'){runs.push({lineBreak:true});continue}
   if(run.type!=='TextRun'||typeof run.text!=='string')return null
   runs.push({text:run.text,style:{...style,...pick(run)}})
  }
  if(!runs.length)return null
  blocks.push({tag:/^(h[1-6]|p|li)$/.test(block.tag)?block.tag:'p',style,runs})
 }
 const joined=blocks.map(b=>b.runs.map(r=>r.lineBreak?'\n':r.text??'').join('')).join('\n')
 if(joined!==n.text)return null
 const base=pick(n)
 const runs=blocks.flatMap(b=>b.runs.filter(r=>!r.lineBreak))
 for(const key of fields){
  if(base[key]!==undefined)continue
  const values=runs.map(r=>r.style?.[key])
  if(values.length&&values.every(v=>v!==undefined&&JSON.stringify(v)===JSON.stringify(values[0])))base[key]=values[0]
 }
 // A mixed-size block lacks a uniform fontSize. Keep the exact per-run sizes;
 // use the smallest explicitly captured pixel size for its baseline strut so
 // an unrelated default font cannot add height to each line.
 if(base.fontSize===undefined){
  const sizes=runs.map(r=>r.style?.fontSize)
  if(sizes.length&&sizes.every(v=>typeof v==='string'&&/^\d+(?:\.\d+)?px$/.test(v)))base.fontSize=Math.min(...sizes.map(v=>parseFloat(String(v))))+'px'
 }
 return {blocks,base}
}
export function hasExplicitRunProperty(rich:EditorRichText|null,key:string){
 const runs=rich?.blocks.flatMap(b=>b.runs.filter(r=>!r.lineBreak))??[]
 return runs.length>0&&runs.every(r=>r.style?.[key]!==undefined)
}
