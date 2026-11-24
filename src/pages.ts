import type {SDKNode,SDKClient,DesignNode,Snapshot,PageInput,PageDescriptor,PageRecord,Folder,Breakpoint,HydrationOptions} from './types.ts'
import {errorMessage} from './types.ts'
/**
 * Folder-aware page discovery for the documented Framer canvas APIs.
 * Web folders are inferred from slash-separated WebPageNode.path values:
 * the SDK does not expose folders as editable nodes.
 */
import { readLayer, hydrateCanvas } from './exporter.ts'
import { generateBundle } from './generator.ts'

export const NODE_LIMIT_PER_PAGE = 6000

export function normalizePath(value:unknown) {
  if (!value || value === '/') return '/'
  const parts = String(value).split('/').filter(Boolean)
  return '/' + parts.join('/')
}

export function safeSegment(value:unknown) {
  const v = String(value || 'untitled').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^\.+/, '').slice(0, 90)
  return v && v !== '..' && v !== '.' ? v : 'untitled'
}

export function safeFilePath(value:unknown) {
  return String(value).split('/').filter(Boolean).map(safeSegment).join('/') || 'home'
}

export function pageDescriptor(node:SDKNode, type:string):PageDescriptor {
  const isWeb = type === 'web'
  const rawPath = typeof node.path === 'string' ? node.path : null
  const title = String(node.name || node.title || (isWeb ? rawPath : null) || node.id || 'Untitled')
  const path = isWeb && rawPath != null
    ? normalizePath(rawPath)
    : isWeb ? `/_drafts/${safeSegment(title)}-${safeSegment(node.id)}`
    : `/_design-pages/${safeSegment(title)}-${safeSegment(node.id)}`
  return { id: String(node.id), path, title, type, node,
    pathIsInferred: !isWeb || rawPath == null,
  }
}

/** Returns available pages, including design pages where the SDK supports them. */
export async function discoverPages(framer:SDKClient) {
  if (typeof framer.getNodesWithType !== 'function') {
    throw new Error('This Framer editor does not expose page enumeration (getNodesWithType). Upgrade the plugin SDK/editor.')
  }
  const warnings:string[] = []
  const pages:PageDescriptor[] = []
  for (const [kind, type] of [['WebPageNode', 'web'], ['DesignPageNode', 'design']]) {
    try {
      const list = await framer.getNodesWithType(kind)
      for (const node of list || []) pages.push(pageDescriptor(node,type))
    } catch (error) {
      if (type === 'web') throw new Error('Framer could not list web pages: ' + errorMessage(error))
      warnings.push('Design pages could not be listed by this Framer SDK: ' + errorMessage(error))
    }
  }
  const byId = new Map<string,PageDescriptor>()
  for (const page of pages) byId.set(page.id, page)
  return {pages: [...byId.values()].sort((a,b) => a.path.localeCompare(b.path)), warnings}
}

/** Paths are segment bounded: /docs must not match /docs-old. */
export function withinFolder(path:unknown, prefix:unknown) {
  const p = normalizePath(path)
  const f = normalizePath(prefix)
  return f === '/' || p === f || p.startsWith(f + '/')
}

export function buildPageTree<T extends {path:string}>(pages:T[]):Folder<T> {
  const root:Folder<T> = {type:'folder', name:'All web pages', path:'/', children:[], pages:[]}
  const index = new Map<string,Folder<T>>([['/', root]])
  for (const page of pages) {
    const parts = normalizePath(page.path).split('/').filter(Boolean)
    let parent = root
    for (let i = 0; i < parts.length - 1; i++) {
      const path = '/' + parts.slice(0, i+1).join('/')
      let folder = index.get(path)
      if (!folder) {
        folder = {type:'folder', name:parts[i], path, children:[], pages:[]}
        parent.children.push(folder)
        index.set(path, folder)
      }
      parent = folder
    }
    parent.pages.push(page)
  }
  const sort = (folder:Folder<T>):void => {
    folder.children.sort((a,b) => a.name.localeCompare(b.name))
    folder.pages.sort((a,b) => a.path.localeCompare(b.path))
    folder.children.forEach(sort)
  }
  sort(root)
  return root
}

export function findBreakpoints(root:DesignNode) {
  const output:DesignNode[] = []
  function walk(node:DesignNode, depth:number):void {
    if (depth > 10 || !node) return
    const a = node.attributes || {}
    if (a.isBreakpoint === true || a.isPrimaryBreakpoint === true) {
      output.push(node)
      return
    }
    for (const child of node.children || []) walk(child, depth + 1)
  }
  walk(root, 0)
  return output
}

function snapshotFor(root:DesignNode, pagePath:string, warnings:string[] = []):Snapshot {
  return {
    format:'framer-to-agent/canvas-snapshot-v2',
    disclaimer:'Public Framer Plugin API node snapshot, NOT Framer internal project JSON.',
    pagePath,
    exportedAt:new Date().toISOString(),
    roots:[root],
    selectedCount:1,
    warnings,
  }
}

function toRelPath(path:string) {
  if (path === '/') return '_index'
  return safeFilePath(path)
}

export function packagePage(page:PageInput, snapshot:Snapshot, {rawOnly=false}={}) {
  const routePath = toRelPath(page.path)
  const prefix = `pages/${routePath}`
  const root = snapshot.roots[0]
  const breakpoints = findBreakpoints(root)
  // Only the primary breakpoint is used for the initial TSX draft.
  // Every breakpoint is kept in the complete JSON, and exported separately below.
  const primary = breakpoints.find(n => n.attributes?.isPrimaryBreakpoint === true) || breakpoints[0] || root
  const notes = [...(snapshot.warnings || [])]
  if (breakpoints.length > 1) notes.push(`${breakpoints.length} responsive breakpoints exist. Component.tsx is the primary draft; merge breakpoint drafts using the original design.json.`)
  if (page.pathIsInferred) notes.push('Page folder path is inferred; Framer did not expose a canonical path for this page.')
  const primaryBundle = rawOnly ? null : generateBundle(snapshotFor(primary, page.path, notes))
  const files:Record<string,string> = {
    ...(primaryBundle ? {[`${prefix}/Component.tsx`]: primaryBundle.tsx, [`${prefix}/component.css`]:primaryBundle.css} : {}),
    [`${prefix}/design.json`]: JSON.stringify(snapshot, null, 2),
    [`${prefix}/AGENT.md`]: (primaryBundle?.agent || "Raw Framer API snapshot. Compile with the independent React compiler.") + `\nPage route: ${page.path}\nPage type: ${page.type}\n`,
  }
  const variants:Breakpoint[] = []
  for (const [index, breakpoint] of breakpoints.entries()) {
    const label = safeSegment(breakpoint.attributes?.name || `breakpoint-${index+1}`)
    const dir = `${prefix}/breakpoints/${index+1}-${label}`
    const s = snapshotFor(breakpoint, page.path, notes)
    if (!rawOnly) {
      const bundle = generateBundle(s)
      files[`${dir}/Component.tsx`] = bundle.tsx
      files[`${dir}/component.css`] = bundle.css
    }
    files[`${dir}/design.json`] = JSON.stringify(s,null,2)
    variants.push({name: breakpoint.attributes?.name || label, id: breakpoint.id,
      width: breakpoint.attributes?.width ?? null,
      primary: breakpoint.attributes?.isPrimaryBreakpoint === true,
      directory: dir,
    })
  }
  return {files, record:{id:page.id, path:page.path, type:page.type, directory:prefix,
    nodeCount:snapshot.nodeCount, truncated:snapshot.truncated, warnings:notes, breakpoints:variants,
  }}
}

export async function capturePage(page:Pick<PageDescriptor,"id"|"path"|"type"|"node">, maxNodes = NODE_LIMIT_PER_PAGE, hydrate?:HydrationOptions):Promise<Snapshot> {
  const state = {count:0, maxNodes, warnings:new Set<string>()}
  await hydrateCanvas(page.node, state.warnings, hydrate)
  const root = await readLayer(page.node, state)
  if (!root) throw new Error('The page has no readable root node')
  // Older SDKs sometimes omit node kind, but the page type is known from discovery.
  if (root.kind === 'UnknownNode') root.kind = page.type === 'web' ? 'WebPageNode' : 'DesignPageNode'
  const truncated = state.count >= maxNodes
  if (truncated) state.warnings.add(`Page reached the ${maxNodes} node limit; export is incomplete.`)
  if (page.type === 'design') state.warnings.add('Design-page folder grouping is inferred from the page name/ID; the plugin API does not expose its native design-folder hierarchy.')
  return {
    ...snapshotFor(root, page.path, [...state.warnings]),
    pageId:page.id, pageType:page.type,
    nodeCount:state.count, truncated,
  }
}

export function projectHandoff(manifest:{pages:PageRecord[];folder:string}) {
  return `# Implement this Framer folder in React + Tailwind\n\n` +
`This archive is an export of ${manifest.pages.length} page(s) from Framer folder \`${manifest.folder}\`.\n` +
`All original page hierarchy snapshots are in individual \`design.json\` files; \`manifest.json\` maps their routes.\n\n` +
`## Instructions to the coding agent\n` +
`1. Run the included preview/ React project and visually inspect pages, SVG icons and responsive variants first.\n2. Inspect the existing React project, router, Tailwind configuration, component library, fonts and tokens.\n` +
`3. Implement all exported pages as real routes; preserve nesting and navigation links.\n` +
`4. Read each page's design.json first. Generated Component.tsx and component.css are STARTING POINTS, not production-ready exports.\n` +
`5. Integrate responsive breakpoints from each page's breakpoints/ directory into a single responsive page rather than showing every breakpoint at once.\n` +
`6. Preserve accessible semantics, text content, asset references, shared headers/navigation, and layout.\n` +
`7. Recreate interactivity only where documented. Verify code components and external assets manually.\n` +
`8. Run typecheck/build/tests and enumerate visual fidelity gaps. Do not claim unsupported Framer data is exact.\n\n` +
`## Routes included\n` + manifest.pages.map(p => `- \`${p.path}\` -> \`${p.directory}/Component.tsx\` (${(p.breakpoints?.length ?? 0)} breakpoint(s), ${p.nodeCount} node(s))${p.truncated ? ' [TRUNCATED]' : ''}`).join('\n') + '\n\n' +
`## Export limitations\n` +
`This is a read-only snapshot of the public Framer Plugin API, NOT private Framer document JSON. A project-level library and asset manifest may also be packaged by the exporter. Unused assets, Framer-only animations and some variables or data bindings may be inaccessible through the public SDK and need review.\n` +
'\nReview `diagnostics.md` for categorized problems and `diagnostics.json` for all affected source nodes. Reusable component instances are not treated as errors by default.\n'
}
