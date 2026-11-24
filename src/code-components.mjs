/** Resolve code component references from Framer's exported file manifest. */
export function collectCodeFiles(files) {
  let items=[]
  try { items=JSON.parse(files['library/code-files.json']||'[]') } catch {}
  if(!Array.isArray(items)) return []
  return items.filter(f=>f && typeof f.id==='string' && typeof f.exportPath==='string' && f.exportPath.startsWith('library/code/') && f.exportPath.split('/').every(part=>part!=='.'&&part!=='..') && /\.[cm]?[jt]sx?$/.test(f.exportPath) && typeof files[f.exportPath]==='string').map(f=>({id:f.id.replace(/^codeFile\//,''),path:f.exportPath.slice(13),source:files[f.exportPath],exports:f.exports||[]}))
}
export function findCodeComponent(identifier, items) {
  const m=String(identifier||'').match(/(?:^|:)codeFile\/([A-Za-z0-9_-]+):([A-Za-z_$][\w$]*)$/)
  if(!m) return null
  const file=items.find(f=>f.id===m[1])
  return file?{...file,exportName:m[2]}:null
}
