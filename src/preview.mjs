import {layoutModules,selectLayoutVariant,layoutModulePath,contentWithinLayout} from './official-layouts.mjs'
import {generateBundle} from './generator.mjs'
import {collectCodeFiles,findCodeComponent} from './code-components.mjs'
import {applyOverlay,parseOverlay} from './enrichment.mjs'
import {generateReusableModules,relativeModule,routeDirectory} from './reuse.mjs'
/** Build an independent Vite / React / Tailwind preview in every export. */
const json = value => JSON.stringify(value)

function pageVariantFiles(page, files, pageIndex, codeFiles = [], canvasComponents = new Map(), overlay = null, template = null) {
  // Page-level snapshots contain every breakpoint canvas: never render these together.
  const bps = (page.breakpoints || []).filter(bp => bp.directory)
  const targets = bps.length ? [...bps].sort((a,b)=>Number(Boolean(b.primary))-Number(Boolean(a.primary)))
    .map(bp=>({label:bp.name || 'Breakpoint',directory:bp.directory,primary:Boolean(bp.primary),width:bp.width || null}))
    : [{label:'Primary',directory:page.directory,primary:true,width:null}]
  const variants = []
  const copies = {}
  const reusable = []
  const routeDir = routeDirectory(page.path)
  for (const [j, item] of targets.entries()) {
    const source = item.directory ? item.directory + '/' : ''
    let tsx = files[source + 'Component.tsx']
    let css = files[source + 'component.css']
    if (typeof files[source + 'design.json'] !== 'string' && (typeof tsx !== 'string' || typeof css !== 'string')) continue
    const target = routeDir + '/breakpoints/' + (parseFloat(item.width) || 'primary') + '-' + j
    const componentPath = target + '/Component.tsx'
    let blocks = []
    if (typeof files[source + 'design.json'] === 'string') {
      const captured = applyOverlay(JSON.parse(files[source + 'design.json']), overlay)
      const original = template ? contentWithinLayout(captured) : captured
      const updated = generateBundle(original, { collectReusable:true, resolveCanvasComponent: identifier => canvasComponents.get(identifier) || null, resolveCodeComponent(identifier) {
        const match = findCodeComponent(identifier, codeFiles)
        return match ? { exportName: match.exportName, importPath: relativeModule(componentPath, 'preview/src/components/code/' + match.path) } : null
      } })
      tsx = updated.tsx
      css = updated.css
      blocks = updated.reusableBlocks
    }
    // Isolate CSS per exported page and breakpoint.
    const prefix = 'fta-p' + pageIndex + '-v' + j + '-'
    const scopeClasses = input => input.replace(/\bf2a-(?:[a-z0-9]+-)?(\d+)\b/g, (_, n) => prefix + n)
    reusable.push({path:componentPath,route:page.path,tsx:scopeClasses(tsx),blocks:blocks.map(b=>({...b,markup:scopeClasses(b.markup)}))})
    copies[target + '/component.css'] = scopeClasses(css)
    const layoutVariant=template?selectLayoutVariant(template,parseFloat(item.width)||0):null
    variants.push({label:item.label, primary:item.primary, width:item.width, componentPath, layoutPath:layoutVariant?layoutModulePath(template,layoutVariant):null})
  }
  return {variants,copies,reusable,routeDir}
}

/** Saved canvas-component definitions (library/components/<folder>/design.json), keyed by componentIdentifier. */
export function collectCanvasComponents(files) {
  const map = new Map()
  let defs = []
  try { defs = JSON.parse(files['library/components.json'] || '[]') } catch {}
  for (const def of Array.isArray(defs) ? defs : []) {
    if (typeof def?.id !== 'string' || typeof def.folder !== 'string') continue
    try {
      const root = JSON.parse(files[def.folder + '/design.json'] || 'null')?.roots?.[0]
      if (root?.kind === 'ComponentNode') map.set(def.id, root)
    } catch {}
  }
  return map
}

export function generatePreviewFiles(pages, sourceFiles, {title='Framer export', diagnostics=null, layoutSource=null}={}) {
  const files = {}
  const layouts=layoutModules(layoutSource,pages)
  Object.assign(files,layouts.files)
  if(layoutSource)files['preview/layout-report.json']=JSON.stringify({assignedRoutes:layouts.assignments.size,issues:layouts.issues},null,2)
  const codeFiles = collectCodeFiles(sourceFiles)
  const canvasComponents = collectCanvasComponents(sourceFiles)
  // Present only after the opt-in enrichment step (scripts/enrich-export.mjs); normal exports have no reference/.
  const overlay = typeof sourceFiles['reference/overlay.json'] === 'string' ? parseOverlay(sourceFiles['reference/overlay.json']) : null
  for (const file of codeFiles) files[`preview/src/components/code/${file.path}`] = file.source
  const routeEntries = []
  const imports = []
  const reusable = []
  for (const [i,page] of pages.entries()) {
    const variantsResult = pageVariantFiles(page, sourceFiles, i, codeFiles, canvasComponents, overlay, layouts.assignments.get(page.path))
    Object.assign(files, variantsResult.copies)
    reusable.push(...variantsResult.reusable)
    if (!variantsResult.variants.length) continue
    const pageFile = variantsResult.routeDir + '/Page.tsx'
    const pageImports = []
    const wrappers=[]
    const pageVariants = variantsResult.variants.map((variant,j)=>{
      const alias = `Variant_${j}`
      pageImports.push(`import ${alias} from ${json(relativeModule(pageFile,variant.componentPath))}`)
      let component=alias
      if(variant.layoutPath){const layoutAlias='Layout_'+j;pageImports.push(`import ${layoutAlias} from ${json(relativeModule(pageFile,variant.layoutPath))}`);component='Wrapped_'+j;wrappers.push(`function ${component}(){return <${layoutAlias}><${alias}/></${layoutAlias}>}`)}
      return `{label:${json(variant.label)}, Component:${component}, primary:${Boolean(variant.primary)}, width:${parseFloat(variant.width)||0}}`
    })
    files[pageFile] = pageImports.join('\n') + '\n'+wrappers.join('\n')+'\n\nexport const variants = [' + pageVariants.join(',\n  ') + ']\nexport default variants[0].Component\n'
    const alias = `Route_${i}`
    imports.push(`import { variants as ${alias} } from ${json(relativeModule('preview/src/routes.ts', pageFile))}`)
    const path = (page.path || '/').startsWith('/') ? page.path || '/' : '/' + page.path
    routeEntries.push({path, alias})
  }
  const shared = generateReusableModules(reusable)
  Object.assign(files, shared.files)
  files['preview/reuse-report.json'] = JSON.stringify({modules:shared.report},null,2)
  if (!routeEntries.length) throw new Error('Cannot make runnable preview: no generated TSX files were found')
  const initialRoute = routeEntries[0].path
  const routesSource = routeEntries.map(r=>`  {path:${json(r.path)}, variants:${r.alias}}`).join(',\n')
  files['preview/src/routes.ts'] = imports.join('\n') + '\n\nexport const routes = [\n' + routesSource + '\n]\n'


  files['preview/package.json'] = JSON.stringify({name:'framer-to-agent-preview',version:'1.0.0',private:true,type:'module',scripts:{dev:'vite --host 127.0.0.1',build:'tsc --noEmit && vite build',preview:'vite preview --host 127.0.0.1'},dependencies:{react:'^19.0.0','react-dom':'^19.0.0'},devDependencies:{'@tailwindcss/vite':'^4.1.0','@types/react':'^19.0.0','@types/react-dom':'^19.0.0',tailwindcss:'^4.1.0',typescript:'^5.7.0',vite:'^7.0.0'}},null,2)
  files['preview/index.html'] = '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Framer Export Preview</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n'
  files['preview/vite.config.ts'] = `import { defineConfig } from 'vite'\nimport tailwindcss from '@tailwindcss/vite'\nexport default defineConfig({ plugins: [tailwindcss()], server: { host: '127.0.0.1' } })\n`
  files['preview/tsconfig.json'] = JSON.stringify({compilerOptions:{target:'ES2022',lib:['DOM','DOM.Iterable','ES2022'],module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,skipLibCheck:true,allowImportingTsExtensions:true,noEmit:true,isolatedModules:true,esModuleInterop:true,types:['vite/client']},include:['src','vite.config.ts']},null,2)
  files['preview/src/main.tsx'] = `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './styles.css'\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n`
  files['preview/src/App.tsx'] = `import { routes } from './routes'\nimport { useState, useEffect } from 'react'\nconst defaultRoute = ${json(initialRoute)}\nconst widths: Record<string, string> = { Desktop: '1440px', Tablet: '768px', Mobile: '390px', Fluid: '100%' }\nfunction currentPath(): string {\n  try { return decodeURIComponent(window.location.pathname) } catch { return defaultRoute }\n}\nexport default function App() {\n  const [path, setPath] = useState(currentPath)\n  const [variantIndex, setVariantIndex] = useState(-1)\n  const [viewport, setViewport] = useState('Fluid')\n  const cleanView = new URLSearchParams(window.location.search).get('fidelity') === '1'
  const [showChrome, setShowChrome] = useState(false)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])\n  const route = routes.find(r=>r.path===path) || routes[0]\n  const availableWidth = viewport === 'Fluid' ? windowWidth : parseInt(widths[viewport], 10) || windowWidth
  const candidates = route.variants.filter(v => v.width > 0).sort((a,b) => b.width - a.width)
  const automatic = candidates.find(v => v.width <= availableWidth) || candidates[candidates.length - 1] || route.variants[0]
  const chosen = variantIndex >= 0 ? (route.variants[variantIndex] || automatic) : automatic\n  const Page = chosen.Component\n  const go = (next: string) => { history.pushState({}, '', next); setPath(next); setVariantIndex(-1) }\n  window.onpopstate = () => { setPath(currentPath()); setVariantIndex(-1) }\n  const summary: Record<string, number> = ${json(diagnostics?.summary || {})}\n  return (\n    <div className={showChrome ? 'preview-shell' : 'preview-full'}>\n      {showChrome && <aside className="preview-sidebar">\n        <div className="preview-brand">Framer to Agent <small>Local React preview</small></div>\n        <div className="preview-label">ROUTES · {routes.length}</div>\n        <nav className="preview-routes" aria-label="Exported pages">\n          {routes.map(r=><button type="button" key={r.path} className={r.path===route.path?'selected':''} onClick={()=>go(r.path)}>{r.path}</button>)}\n        </nav>\n        <div className="preview-sidebar-foot">\n          <strong>Export checks</strong>\n          <p>{summary.errors ?? 0} errors · {summary.warnings ?? 0} warnings</p>\n          <p>This is an editable first-pass export, not a pixel-perfect Framer clone.</p>\n        </div>\n      </aside>}\n      <div className="preview-content">\n        {showChrome && <header className="preview-toolbar">\n          <strong>{route.path}</strong>\n          <label>Breakpoint <select aria-label="Exported breakpoint" value={variantIndex} onChange={e=>setVariantIndex(Number(e.target.value))}><option value={-1}>Auto (viewport)</option>{route.variants.map((v,i)=><option key={i} value={i}>{v.label}</option>)}</select></label>\n          <label>Viewport <select aria-label="Viewport width" value={viewport} onChange={e=>setViewport(e.target.value)}>{Object.keys(widths).map(w=><option key={w}>{w}</option>)}</select></label>\n          <button type="button" onClick={()=>setShowChrome(false)}>Hide tools</button>\n        </header>}\n        {!showChrome && !cleanView && <button className="preview-reopen" type="button" onClick={()=>setShowChrome(true)}>Show preview tools</button>}\n        <main className="preview-stage" onClick={(event)=>{const el = event.target as HTMLElement; const anchor = el.closest('a[href]') as HTMLAnchorElement | null; if (!anchor) return; const url = new URL(anchor.href); if(url.origin === location.origin && routes.some(r=>r.path===url.pathname)){event.preventDefault();go(url.pathname)} }}>\n          <div className="exported-page" style={{width:showChrome?widths[viewport]:'100%',maxWidth:'none'}}><Page /></div>\n        </main>\n      </div>\n    </div>\n  )\n}\n`
  files['preview/src/styles.css'] = `@import "tailwindcss";\n@import "./tokens.css";\n@import "./font-assets.css";\n:root { color-scheme: light; }\n* { box-sizing: border-box; }\nbody { margin:0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }\n.preview-shell { min-height:100vh; display:grid; grid-template-columns:240px minmax(0,1fr); background:#eaeef3; }\n.preview-sidebar { color:#e1e7ed; background:#111b29; padding:20px 12px; display:flex; flex-direction:column; gap:15px; min-height:100vh; }\n.preview-brand { font-size:17px; font-weight:700; padding:0 10px; }\n.preview-brand small { display:block; font-size:11px; font-weight:400; margin-top:4px; color:#91a2b6; }\n.preview-label { font-size:11px; color:#829ab1; letter-spacing:1.5px; padding:10px 10px 0; }\n.preview-routes { display:flex; flex-direction:column; gap:4px; max-height:68vh; overflow:auto; }\n.preview-routes button { font-size:12px; text-align:left; border:0; border-radius:7px; padding:10px; color:#c8d6e6; background:transparent; cursor:pointer; overflow-wrap:anywhere; }\n.preview-routes button:hover { background:#273648; }\n.preview-routes button.selected { background:#275bb1; color:white; }\n.preview-sidebar-foot { border-top:1px solid #344152; padding:18px 10px 0; margin-top:auto; font-size:12px; color:#adbccf; }\n.preview-sidebar-foot p { line-height:1.5; }\n.preview-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:12px; background:white; border-bottom:1px solid #cdd6df; padding:10px 14px; color:#243244; font-size:12px; }\n.preview-toolbar strong { margin-right:auto; overflow-wrap:anywhere; }\n.preview-toolbar label { display:flex; align-items:center; gap:5px; }\n.preview-toolbar select, .preview-toolbar button { font:inherit; background:#f5f8fc; color:#243244; border:1px solid #d1dce9; border-radius:6px; padding:6px; cursor:pointer; }\n.preview-content { min-width:0; }\n.preview-stage { padding:20px; display:flex; justify-content:center; align-items:flex-start; overflow:auto; min-height:calc(100vh - 54px); }\n.exported-page { background:transparent; min-height:0; overflow:visible; box-shadow:none; }\n.preview-full .preview-stage { padding:0; }\n.preview-reopen { position:fixed; z-index:10000; right:14px; bottom:14px; padding:9px 13px; border:0; border-radius:8px; color:white; background:#17263b; cursor:pointer; }\n@media(max-width:730px){.preview-shell{grid-template-columns:1fr}.preview-sidebar{min-height:auto;max-height:220px}.preview-routes{max-height:100px}.preview-stage{padding:8px}}\n`
  // Page breakpoint roots fill their responsive viewport, not the Framer editor's authoring width.
  files['preview/src/styles.css'] += '\n.exported-page > * { width: 100% !important; }\n'
  files['preview/src/tokens.css'] = sourceFiles['library/tokens.css'] || '/* No shared design tokens exported. */\n'
  files['preview/src/font-assets.css'] = sourceFiles['assets/fonts.css'] || ''
  for (const [path,content] of Object.entries(sourceFiles)) {
    if (path.startsWith('assets/') && !path.endsWith('/manifest.json')) files['preview/public/' + path] = content
  }
  files['preview/public/asset-report.json'] = sourceFiles['assets/manifest.json'] || '{"assets":[],"warnings":[]}\n'
  files['preview/README.md'] = `# Runnable Framer to Agent export\n\nRun this preview before handing the export to your coding agent:\n\n\`\`\`bash\ncd preview\nnpm install\nnpm run dev\n\`\`\`\n\nOpen the localhost URL shown by Vite. Select an exported page, breakpoint, and viewport.\n\nTo check compilation: \`npm run build\`. This preview is intentionally independent of Framer, paid services, and the main plugin.\n\nProject structure: \`src/pages/\` mirrors the exported URL hierarchy; each route has a Page.tsx entry and breakpoint modules. \`src/components/canvas/\` contains reusable captured canvas components, \`src/components/code/\` holds original code components, and \`src/layouts/\` contains repeated layout templates. Instance CSS and source IDs stay local to each page/breakpoint. See \`reuse-report.json\` for actual module reuse.\n\nThis is **first-pass code**. Framer-only interactivity, unpublished vector paths, custom components, animations, and rich responsive behavior can require further implementation. Any unbundled assets may still reference their original remote URLs. Check \`../diagnostics.md\` and \`public/asset-report.json\` for failures.\n`
  if (codeFiles.length) {
    files['preview/src/framer-compat.ts'] = `/** Editor-only property control compatibility; unsupported Framer runtime APIs remain build errors. */\nexport const ControlType = new Proxy({} as Record<string,string>, { get:(_target,key) => String(key) })\nexport function addPropertyControls(_component:unknown, _controls:unknown):void {}\n`
    const pkg = JSON.parse(files['preview/package.json'])
    pkg.devDependencies['@types/node'] = '^22.0.0'
    if (codeFiles.some(f => /from\s*["']framer-motion["']/.test(f.source))) pkg.dependencies['framer-motion'] = '^12.0.0'
    files['preview/package.json'] = JSON.stringify(pkg,null,2)
    const ts = JSON.parse(files['preview/tsconfig.json'])
    ts.compilerOptions.paths = { ...(ts.compilerOptions.paths || {}), framer:['./src/framer-compat.ts'] }
    files['preview/tsconfig.json'] = JSON.stringify(ts,null,2)
    files['preview/vite.config.ts'] = `import { defineConfig } from 'vite'\nimport tailwindcss from '@tailwindcss/vite'\nimport { fileURLToPath } from 'node:url'\nexport default defineConfig({plugins:[tailwindcss()],resolve:{alias:[{find:/^framer$/,replacement:fileURLToPath(new URL('./src/framer-compat.ts',import.meta.url))}]},server:{host:'127.0.0.1'}})\n`
  }
  return files
}
