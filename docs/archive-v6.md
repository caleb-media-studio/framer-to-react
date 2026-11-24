# Capture archive v6

Experimental open interchange format. The immutable archive is the **only compiler input**. No published measurements, manually patched source, generated React or external layout supplements are compiler inputs.

1. Capture original editor data using the public Framer Plugin API. Navigate through canvases and collect available typography, component definitions, code and assets. Record unavailable fields.
2. Serialize as plain JSON or the lossless JSON-value encoding [CJSON/1](cjson-v1.md).
3. Compile offline into reusable React modules, routes, CSS and assets. Normalize source in compiler memory only.
4. Verify the result against an authorized Framer reference. Missing source requires a new capture; incorrect transformation requires a compiler fix and recompilation of the same archive.

## Logical members

In a CJSON archive, capture-owned JSON documents are represented by the dictionary-coded pair design.cjson and design.cjsonref. Original code-owned JSON is not encoded.

| Logical member | Contents |
|---|---|
| manifest.json | Version, capture adapter, source scope, stable page/breakpoint IDs, requested count and failures |
| pages/route/design.json | Complete page hierarchy |
| pages/route/breakpoints/variant/design.json | Individual responsive tree; root identity matches manifest |
| design.json | Selection root snapshot |
| library/components.json and library/components/folder/design.json | Stable reusable definition IDs and source trees |
| library/code-files.json and library/code/** | Source module identities, export paths and original code |
| library/styles.json | Captured color and text styles |
| library/fonts.json | Used family, weight, style, selector, source URL or explicit unavailable status |
| library/vector-sets.json, library/vector-sets/folder/design.json, library/svg-index.json | Captured vector definitions and inventory |
| library/cms-schema.json | Collection field schemas |
| library/capture-capabilities.json | Source adapter limitations |
| library/layouts.json | Optional captured template library with exact page bindings |
| assets/manifest.json and assets/** | Asset availability, source URLs and bundled bytes |
| diagnostics.json | Capture errors, warnings and review findings |

All source document paths are portable and unique; original code and binary assets retain their contents. The compiler ignores stale generated drafts.

## Version and node semantics

The manifest format is framer-to-agent/folder-export-v6 or framer-to-agent/selection-export-v6. The historical namespace is retained for compatibility. New plugin exports set captureOnly to true. Node fields retain source ID, kind, exposed attributes, text, rich-text HTML if available, source rectangle and children. Unknown editor fields are allowed. Missing source properties must not be invented. Source-node reference fields from the old enrichment system are not part of v6.

Captured template libraries use framer-to-agent/layout-source-v1 with template IDs, responsive source roots, explicit content slots and exact page ID/route/layout bindings. Include only when obtained during capture from an authoritative source. Assets reside in assets/. A missing library is not proof that the project has no inherited templates.

The installed public Plugin API does not expose every internal layout template, overlay trigger, path geometry or typography property. A richer authorized capture adapter may produce a new complete archive; it must not modify a previous export. The compiler cannot guarantee the reconstruction of source data the exporter never obtained.

## Compatibility

Legacy plain v5 archives remain readable with their capture limitations. The former external evidence/layout-source options and enrichment command are removed. Packing v5 changes the transport only, not the capture version or fidelity.

See [manifest schema](../schemas/manifest-v6.schema.json), [node schema](../schemas/design-v6.schema.json) and [CJSON/1](cjson-v1.md). This specification supersedes the old evidence-injection workflow in v5.
