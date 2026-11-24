import type {ArchiveFiles,CodeFile,JsonObject} from './types.ts'
import {textFile} from './types.ts'
/** Resolve code component references from Framer's exported file manifest. */
export function collectCodeFiles(files:ArchiveFiles):CodeFile[] {
  let items:JsonObject[]=[]
  try { items=JSON.parse(textFile(files,'library/code-files.json','[]')) } catch {}
  if(!Array.isArray(items)) return []
  return items.filter(f=>f && typeof f.id==='string' && typeof f.exportPath==='string' && f.exportPath.startsWith('library/code/') && f.exportPath.split('/').every((part:string)=>part!=='.'&&part!=='..') && /\.[cm]?[jt]sx?$/.test(f.exportPath) && typeof files[f.exportPath]==='string').map(f=>({id:f.id.replace(/^codeFile\//,''),path:f.exportPath.slice(13),source:files[f.exportPath] as string,exports:f.exports||[]}))
}
export function findCodeComponent(identifier:unknown, items:CodeFile[]):(CodeFile & {exportName:string})|null {
  const m=String(identifier||'').match(/(?:^|:)codeFile\/([A-Za-z0-9_-]+):([A-Za-z_$][\w$]*)$/)
  if(!m) return null
  const file=items.find(f=>f.id===m[1])
  return file?{...file,exportName:m[2]}:null
}
