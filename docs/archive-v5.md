> Superseded by [archive v6](archive-v6.md). The former external evidence and enrichment workflow is no longer supported by the current compiler.

# Portable design archive specification · v5

Status: experimental, backward-compatible with the original v5 capture namespace. This is a documented interchange format, not Framer's private document format.

## Container

A ZIP or extracted directory. All member paths use forward slashes, are relative to the root and must not contain empty, dot or parent segments. Symlinks are not supported. JSON documents are UTF-8. Binary resources are preserved as bytes. The source archive must not be mutated by a compiler.

| Member | Purpose |
|---|---|
| `manifest.json` | Format, page records, counts, capture failures, provenance when available |
| `pages/<route>/design.json` | Complete page tree |
| `pages/<route>/breakpoints/<variant>/design.json` | Individual responsive tree |
| `design.json` | Root snapshot for a selection archive |
| `library/components.json` | Stable component identifiers and definition folders |
| `library/components/<folder>/design.json` | Captured reusable definitions |
| `library/code-files.json` | Original code file IDs and export paths |
| `library/code/**` | Original code modules |
| `library/styles.json`, `library/tokens.css` | Captured styles and portable CSS tokens when available |
| `assets/manifest.json` | Asset URL/path mapping, bundled status and capture limitations |
| `assets/**` | Actual asset bytes and exported vector files |
| `diagnostics.json` | Capture errors, warnings and review findings |

Generated `preview/`, page `Component.tsx` and `component.css` are legacy optional outputs, never authoritative source inputs. The compiler ignores stale drafts. Original code modules are not generated drafts.

## Manifest

```json
{
  "format": "framer-to-agent/folder-export-v5",
  "captureOnly": true,
  "requestedPages": 1,
  "pages": [
    {
      "id": "page-example",
      "path": "/",
      "directory": "pages/_index",
      "breakpoints": [
        {
          "id": "desktop-example",
          "name": "Desktop",
          "width": "1200px",
          "primary": true,
          "directory": "pages/_index/breakpoints/1-Desktop"
        }
      ]
    }
  ],
  "failures": []
}
```

The selection format is `framer-to-agent/selection-export-v5`. Legacy selection manifests can omit the pages array; the compiler interprets the root `design.json` as a single route. A folder record must identify its page directory; responsive snapshots must have their recorded breakpoint root ID. Route names and page/breakpoint directories must be unique.

## Design tree

```json
{
  "roots": [
    {
      "id": "desktop-example",
      "kind": "FrameNode",
      "attributes": {
        "name": "Desktop",
        "isBreakpoint": true,
        "width": "1200px",
        "height": "fit-content",
        "layout": "stack",
        "stackDirection": "vertical",
        "gap": "16px"
      },
      "children": [
        {
          "id": "heading-example",
          "kind": "TextNode",
          "attributes": {
            "name": "Heading",
            "font": { "family": "Inter", "weight": 600 },
            "width": "fit-content"
          },
          "text": "Hello, design archive",
          "rect": { "x": 0, "y": 0, "width": 200, "height": 24 }
        }
      ]
    }
  ]
}
```

Nodes have stable source IDs, a source kind, exposed attributes and optional text, rich text, children and geometry. Attributes may contain editor-defined properties not recognized by the current compiler. Missing properties must remain missing; inferred defaults must be distinguished from editor data. Rectangles are capture measurements, not necessarily CSS absolute positions.

A component instance can expose `attributes.componentIdentifier` and `attributes.controls`. Code component identifiers may reference an original code-file ID plus its export name. The compiler preserves that module as code and uses the instance's controls as props. Runtime compatibility and dependencies require verification.

## Assets and provenance

Each asset record identifies its source URL or vector, local path when available and whether it was bundled. Omitted or unavailable assets must be reported, not silently represented as successful. The compiler rewrites known bundled URLs to local assets in generated page styles and markup. It does not rewrite original code source. External dependencies are not installed automatically.

Reference evidence is optional and separate from the archive. It associates the source route, breakpoint ID, viewport, source revision hash, matched node IDs and measured properties. Only high-confidence matched evidence fills absent editor values. Conflicts preserve the editor property and are recorded. Inferred icon data is not an original editor SVG.

An optional official layout-tree supplement has format `framer-to-agent/official-layout-tree-v1`, a `templates` array of serialized official layout trees, and a `pages` array with page IDs, routes and layout IDs. The compiler matches exact page identities and emits shared template modules with explicit content slots. The supplement is not silently fabricated from a published page or assumed to be in every plugin archive.

## Versioning and validation

See [manifest schema](../schemas/manifest-v5.schema.json) and [design schema](../schemas/design-v5.schema.json). These describe the interoperable subset; additional editor fields are allowed. Structural checks do not establish completeness or visual fidelity. A compiler must report missing data and unsupported capabilities. Incompatible structural changes require a new archive version.

The current CLI does not execute source code during archive transformation; the generated application's build and execution are separate steps. Only compile and run archives from trusted projects, and review captured code and dependencies before installation.

