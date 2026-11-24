import type {PageRecord,ArchiveFiles} from './types.ts'
import {generateBundle} from './generator.ts'
import {collectCodeFiles, findCodeComponent} from './code-components.ts'

/** Hydrate standalone exported page files after shared Framer code files are read. */
export function hydrateArchiveCodeComponents(pages:PageRecord[], files:ArchiveFiles) {
  const sources = collectCodeFiles(files)
  if (!sources.length) return 0
  let changed = 0
  for (const page of pages || []) {
    const directories = new Set([page.directory, ...(page.breakpoints || []).map(bp => bp.directory)])
    for (const directory of directories) {
      if (typeof directory !== 'string') continue
      const dir = directory.replace(/\/$/, '')
      const prefix = dir ? dir + '/' : ''
      const json = files[prefix + 'design.json']
      if (typeof json !== 'string') continue
      const snapshot = JSON.parse(json)
      const rootDepth = prefix.split('/').filter(Boolean).length
      const relativeRoot = rootDepth ? '../'.repeat(rootDepth) : './'
      let instances = 0
      const bundle = generateBundle(snapshot, {
        resolveCodeComponent(identifier) {
          const file = findCodeComponent(identifier, sources)
          if (!file) return null
          instances++
          return {
            exportName: file.exportName,
            importPath: relativeRoot + 'library/code/' + file.path.replace(/\.[cm]?[jt]sx?$/, ''),
          }
        },
      })
      if (!instances) continue
      files[prefix + 'Component.tsx'] = bundle.tsx
      files[prefix + 'component.css'] = bundle.css
      changed++
    }
  }
  return changed
}
