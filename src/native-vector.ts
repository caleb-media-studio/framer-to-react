import {serializeReferenceVector} from './reference-vector.ts'

interface Shape {tag:string;attrs:Record<string,string>;children:Shape[]}
const tags=new Set(['path','rect','circle','ellipse','line','polyline','polygon','g'])
const reactNames:Record<string,string>={
 'stroke-width':'strokeWidth','stroke-miterlimit':'strokeMiterlimit','fill-opacity':'fillOpacity',
 'stroke-opacity':'strokeOpacity','stroke-dashoffset':'strokeDashoffset','stroke-dasharray':'strokeDasharray',
 'fill-rule':'fillRule','clip-rule':'clipRule','stroke-linecap':'strokeLinecap','stroke-linejoin':'strokeLinejoin',
 'vector-effect':'vectorEffect',
}
const attrsJsx=(attrs:Record<string,string>)=>Object.entries(attrs).map(([key,value])=>
 ' '+(reactNames[key]??key)+'={'+JSON.stringify(value)+'}').join('')

/** Convert only a closed, static SVG shape subset to typed React elements.
 * No arbitrary SVG HTML, event handlers, CSS, URLs, defs, IDs, entities or scripts
 * enter JSX. Unsupported syntax stays on the existing external asset path. */
export function nativeVector(svg:string):{attributes:string;children:string}|null{
 if(svg.length>200_000||/[&]/.test(svg))return null
 const stack:Shape[]=[]
 let root:Shape|undefined, end=0,count=0
 for(const match of svg.matchAll(/<[^<>]*>/g)){
  if(svg.slice(end,match.index).trim())return null
  end=match.index!+match[0].length
  const token=/^<(\/?)([A-Za-z][A-Za-z0-9]*)([\s\S]*?)(\/?)>$/.exec(match[0])
  if(!token)return null
  const [,close,tag,body,selfClose]=token
  if(close){
   if(body.trim()||selfClose||stack.pop()?.tag!==tag)return null
   continue
  }
  if(++count>256||stack.length>12)return null
  if(!root?tag!=='svg':!stack.length||!tags.has(tag))return null
  const attrs:Record<string,string>=Object.create(null)
  let rest=body
  while(rest.trim()){
   const attr=/^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest)
   if(!attr||Object.hasOwn(attrs,attr[1]))return null
   attrs[attr[1]]=attr[2]??attr[3]
   rest=rest.slice(attr[0].length)
  }
  const shape:Shape={tag,attrs,children:[]}
  if(!root)root=shape
  else stack.at(-1)!.children.push(shape)
  if(!selfClose)stack.push(shape)
 }
 if(!root||stack.length||svg.slice(end).trim())return null
 const {xmlns,viewBox,width,height,preserveAspectRatio,...paint}=root.attrs
 if(xmlns!==undefined&&xmlns!=='http://www.w3.org/2000/svg')return null
 if(preserveAspectRatio!==undefined&&preserveAspectRatio!=='xMidYMid meet')return null
 if(!viewBox||!root.children.length)return null
 if(!serializeReferenceVector({viewBox,shapes:[{tag:'g',attrs:paint,children:root.children}]}))return null
 const emit=(node:Shape):string=>'<'+node.tag+attrsJsx(node.attrs)+(node.children.length?'>'+node.children.map(emit).join('')+'</'+node.tag+'>':' />')
 return {attributes:attrsJsx({viewBox,...(preserveAspectRatio?{preserveAspectRatio}:{}),fill:'currentColor',...paint}),children:root.children.map(emit).join('')}
}
