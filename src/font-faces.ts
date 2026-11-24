interface FontAsset {bundled?:boolean;path?:string;url?:string}
interface FontDescriptor {family?:string;url?:string;weight?:string|number;style?:string}
/** Emit exact local font faces for bundled Framer font URLs. */
export function buildFontCss(rows:FontAsset[] = [], descriptors:(FontDescriptor|string)[] = []) {
  const norm = (x:unknown) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const options = descriptors.map(x => typeof x === 'string' ? {family:x} : x).filter(Boolean)
  const rules = []
  for (const row of rows) {
    if (!row.bundled || !row.path || !/\.(woff2?|ttf|otf)$/i.test(row.path || '')) continue
    const font = options.find(x => x.url && x.url === row.url) || options.find(x => x.family && norm(x.family).length > 2 && norm(row.url).includes(norm(x.family)))
    if (!font?.family) continue
    const w = Number(font.weight)
    const weight = w >= 100 && w <= 900 ? String(w) : '400'
    const style = /^(normal|italic|oblique)$/.test(font.style ?? '') ? font.style : 'normal'
    const format = row.path.endsWith('.woff2') ? 'woff2' : row.path.endsWith('.woff') ? 'woff' : row.path.endsWith('.otf') ? 'opentype' : 'truetype'
    rules.push('@font-face{font-family:' + JSON.stringify(font.family) + ';src:url(' + JSON.stringify('/' + row.path) + ') format("' + format + '");font-weight:' + weight + ';font-style:' + style + ';font-display:swap;}')
  }
  return rules.join('\n') + (rules.length ? '\n' : '')
}
