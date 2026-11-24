import type {ArchiveFiles,PageRecord,Attributes,DesignNode,Snapshot} from '../src/types.ts'
// Entirely synthetic example; contains no captured private project data.
import fs from 'node:fs'
import {zipSync,strToU8} from 'fflate'
import {packCaptureDocuments} from '../src/cjson.ts'
import {packagePage} from '../src/pages.ts'
const output=process.argv[2]||'example-design.zip'
const files:ArchiveFiles={}
const pages:PageRecord[]=[]
const text=(id:string,name:string,content:string,size=16,extra:Attributes={}):DesignNode=>({id,kind:'TextNode',text:content,attributes:{name,inlineTextStyle:{fontSize:size+'px',lineHeight:'1.4em',color:'#f1f5f9'},font:{family:'Arial',weight:400},...extra}})
function snapshot(path:string,index:number):Snapshot{
 const breakpoints=[1200,390].map(width=>{
  const p='page-'+index+'-'+width
  return {id:p,kind:'FrameNode',attributes:{name:width===1200?'Desktop':'Mobile',isBreakpoint:true,isPrimaryBreakpoint:width===1200,width:width+'px',height:'fit-content',layout:'stack',stackDirection:'vertical',stackAlignment:'start',stackDistribution:'start',gap:'16px',padding:'24px',backgroundColor:'#111827'},children:[
   {id:p+'-nav',kind:'FrameNode',attributes:{name:'Shared navigation',width:'100%',layout:'stack',stackDirection:'horizontal',gap:'16px'},children:[text(p+'-home','Home','Home',16,{link:'/'}),text(p+'-details','Details','Details',16,{link:'/details'})]},
   text(p+'-title','Heading',path==='/'?'Welcome to the demo':'Details page',width===390?24:32),
   {id:p+'-badge',kind:'ComponentInstanceNode',attributes:{name:'Status badge',componentIdentifier:'codeFile/demo-badge:Badge',controls:{label:path==='/'?'Ready':'Details ready'},width:'fit-content',height:'fit-content'}},
   {id:p+'-intrinsic-box',kind:'FrameNode',attributes:{name:'Intrinsic sizing example',width:'100px',layout:'stack',stackDirection:'vertical',stackAlignment:'start',overflow:'clip'},children:[
    text(p+'-intrinsic','Intrinsic','A label wider than its parent',16,{width:'fit-content',height:'fit-content'}),
    text(p+'-bounded','Bounded','A label wider than its parent',16,{width:'fit-content',maxWidth:'100px',height:'fit-content'})
   ]},
   {id:p+'-group',kind:'FrameNode',attributes:{name:'Field group',width:'100%',layout:'stack',stackDirection:'vertical',gap:'8px'},children:[text(p+'-label','Label','Email address'),{id:p+'-input',kind:'FrameNode',attributes:{name:'Input / Email',width:'100%',height:'40px',layout:'stack',stackDirection:'horizontal',stackAlignment:'center',padding:'8px',backgroundColor:'#263248',borderRadius:'6px'},children:[text(p+'-placeholder','Placeholder','name@example.test',14)]}]}
  ]}
 })
 return {roots:[{id:'page-'+index,kind:'WebPageNode',attributes:{name:path},children:breakpoints}],warnings:[],truncated:false,nodeCount:27}
}
for(const [i,path] of ['/','/details'].entries()){
 const item=packagePage({id:'page-'+i,path,type:'web'},snapshot(path,i),{rawOnly:true})
 Object.assign(files,item.files);pages.push(item.record)
}
files['manifest.json']=JSON.stringify({format:'framer-to-agent/folder-export-v6',captureOnly:true,requestedPages:pages.length,pages,failures:[]},null,2)
files['assets/manifest.json']=JSON.stringify({assets:[],warnings:[]})
files['library/code-files.json']=JSON.stringify([{id:'demo-badge',exportPath:'library/code/Badge.tsx',exports:['Badge']}])
files['library/code/Badge.tsx']='export function Badge({label}:{label:string}) { return <strong data-demo-badge="true" style={{color:"#93c5fd"}}>{label}</strong> }\n'
fs.writeFileSync(output,zipSync(Object.fromEntries(Object.entries(process.argv.includes('--plain')?files:await packCaptureDocuments(files)).map(([k,v])=>[k,typeof v==='string'?strToU8(v):v]))))
console.log('Created synthetic raw-only archive:',output)

