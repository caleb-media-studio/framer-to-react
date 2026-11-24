import type {ArchiveFiles,DesignNode} from './types.ts'
type Token={id:string;name:string;token:string;light:string;dark:string}
export type ColorResolver=(value:unknown,node?:DesignNode,field?:string)=>string|null
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unnamed'
const hash=(s:string)=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h.toString(36)}
export function literalColor(v:unknown):string|null{
 if(typeof v!=='string')return null
 const s=v.trim()
 return /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([a-z0-9.,%+\-\s/]+\)|transparent|currentcolor|inherit|black|white)$/i.test(s)?s:null
}
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
const csv=(v:string)=>'"'+(/^[=+\-@\t\r]/.test(v)?"'"+v:v).replaceAll('"','""')+'"'
export function createDesignTokens(source:Readonly<ArchiveFiles>){
 const rows:Token[]=[],byId=new Map<string,Token>(),used=new Set<string>()
 const references:{id:string;nodeId:string;field:string}[]=[],unknown=new Set<string>()
 const raw=source['library/styles.json']
 const parsed=typeof raw==='string'?record(JSON.parse(raw)):null
 for(const item of Array.isArray(parsed?.colors)?parsed.colors:[]){
  const row=record(item);if(!row||typeof row.id!=='string'||byId.has(row.id))continue
  const light=literalColor(row.light),dark=literalColor(row.dark)
  if(!light&&!dark)continue
  const name=typeof row.name==='string'?row.name:row.id,base=slug(name)
  let token=base
  if(used.has(token))token=base+'-'+hash(row.id)
  let i=2;while(used.has(token))token=base+'-'+hash(row.id)+'-'+i++
  used.add(token)
  const out={id:row.id,name,token,light:light??dark!,dark:dark??light!}
  rows.push(out);byId.set(out.id,out)
 }
 const resolve:ColorResolver=(value,node,field)=>{
  const v=record(value)
  const match=typeof value==='string'?/^var\(--token-([A-Za-z0-9_-]+)(?:,\s*(.+))?\)$/.exec(value):null
  if(match){const id=match[1],t=byId.get(id);if(t){if(node&&field)references.push({id,nodeId:node.id,field});return 'var(--framer-'+t.token+')'}unknown.add(id);return literalColor(match[2])}
  if(v&&typeof v.id==='string'){
   const t=byId.get(v.id)
   if(t){if(node&&field)references.push({id:v.id,nodeId:node.id,field});return 'var(--framer-'+t.token+')'}
   if('light' in v||'dark' in v)unknown.add(v.id)
  }
  return literalColor(value)??literalColor(v?.light)??literalColor(v?.color)??literalColor(v?.value)??literalColor(v?.dark)
 }
 const css=['/* Generated from captured Framer color assets. */',':root {',...rows.map(t=>'  --framer-'+t.token+': '+t.light+';'),'}','[data-theme="dark"] {',...rows.map(t=>'  --framer-'+t.token+': '+t.dark+';'),'}','@theme inline {',...rows.map(t=>'  --color-'+t.token+': var(--framer-'+t.token+');'),'}',''].join('\n')
 const inventory=['id,name,tailwind_token,css_variable,light,dark',...rows.map(t=>[t.id,t.name,t.token,'--framer-'+t.token,t.light,t.dark].map(csv).join(','))].join('\n')+'\n'
 return {resolve,css,inventory,report:()=>({colors:rows,references,unknownIds:[...unknown]})}
}

