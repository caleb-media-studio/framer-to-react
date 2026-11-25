# Fidelity gate: thresholds (fixed before any comparison run)

Written 2026-11-23, before the first run of `verification/fidelity-gate.ts`. Do not loosen these after seeing
results; a change needs its own dated entry below with the reason and must not be made to turn a failure into a pass.

Reference = the published Framer site, captured by `verification/evidence-sidecar.ts` (per-layer computed style + page bbox, with
provenance) plus full-page screenshots taken by the gate itself. Candidate = the generated preview built from the
immutable source archive. Both are rendered by the same Playwright Chromium at viewport {width, 900}, deviceScaleFactor 1,
reducedMotion reduce.

## Per text layer (paired by Framer node id: evidence `nodeId` ↔ preview `[data-f2a-node]`)

| Field | Tolerance |
|---|---|
| fontFamily (first family, quotes/case ignored) | exact |
| fontSize, fontWeight, textAlign, textTransform | exact |
| color | exact after normalising to `rgb()/rgba()` |
| lineHeight | ±0.5px (`normal` must equal `normal`) |
| letterSpacing | ±0.05px (`normal` ≡ 0px) |
| bbox x, y, width, height (page coordinates) | ±2px |

## Independent rendered-surface pass

The second pass collects fresh computed styles and page-coordinate boxes directly from both screenshot
pages, without using archive-to-DOM identity matches or cached source properties. It compares each
normalized visible text-content group as a multiset (every occurrence requires a distinct matching
occurrence), including font style and text decoration in addition to the original text checks. Residual
pairings are diagnostic only; no automatic source identity or style overrides are inferred from proximity.

Thin painted horizontal/vertical elements (up to 3px thick, at least 8px long, and at least 4:1 aspect
ratio) are checked independently of text. Matching requires color equality, effective opacity within
0.001, thickness within 0.1px, and the existing 2px box tolerance. Missing and extra lines fail even when
all text matches. Thin border-only frames and HR elements are included. Larger frames, gradients,
arbitrary pseudo-element layouts and SVG strokes are not fully covered by this audit.

The report retains the original source-ID check and screenshot verdict plus a separate renderAudit
object with counts and findings; overlapping findings from the two passes are intentionally retained
and are not a count of unique physical layers.

## Per route × width

| Check | Tolerance |
|---|---|
| document scrollHeight | ±2px |
| full-page screenshot | a pixel differs if any RGB channel differs by >32; pass if differing pixels ≤0.1% of the larger image, and heights within ±2px |

## Coverage (anything not verified is a failure of the gate, never a pass)

- Every visible live `RichTextContainer` must have a **high**-confidence evidence match. Medium/low matches and
  `unmatchedLive` / `unmatchedArchive` entries are reported as **unverified**.
- A route × width without an evidence file, or whose evidence `breakpointId` is null, is **unverified**.
- Matched node with no `[data-f2a-node]` element (or an invisible one) in the preview is a **mismatch** (missing layer).
- Not yet covered by any automated check, therefore **unverified** until a check exists: non-text layer geometry
  (frames, images, SVG) other than via screenshots; hover/pressed/open states; intermediate widths; code-component behaviour.

Gate passes only with 0 mismatches and 0 unverified across every manifest route and required viewport.

## Changes

2026-11-24: fail closed via process exit status and explicit passed field, including empty/incomplete runs. No tolerance changes.

2026-11-24: candidate URL adds fidelity=1 to disable only the generated preview's own tools launcher. Exported page content, layout, and pixel tolerances remain unchanged.

2026-11-24: added an independent live-render text and thin-divider pass, with distinct-occurrence matching and stricter thickness verification. Existing tolerances unchanged.

2026-11-24: source evidence matching includes captured layout templates and skips actual closed overlay node types. No thresholds changed. Reports additionally record exact unequal RGBA pixel counts and unrounded ratios; --strict-pixels requires zero unequal pixels across all cases, in addition to the existing gate. Platform branding is included in full-page metrics; no screenshot masking is performed.

2026-11-24: user explicitly excludes the Framer-injected platform branding badge from design fidelity. Only the known fixed body-level badge container and its direct Framer branding anchor are eligible. Hide the anchor in the isolated source browser before the comparison, exposing the underlying real design (no rectangular masks or discarded pixels). Save the untouched source screenshot as *.live.original.png and report unfiltered pixel counts separately. Published site, archive, generated app, and tolerances remain unchanged. Strict mode still requires zero unequal RGBA pixels in the badge-free design comparison.

2026-11-24: require source screenshot stability. Compare the original and badge-free screenshots independently; changes outside the exact measured badge bounds or any image-dimension change are unverified. Both full images and all unfiltered and filtered candidate pixel counts are preserved. No candidate comparison masks, threshold changes, or additional exclusions. Exact pixel pass additionally requires equal image dimensions.

2026-11-24: source-stability attribution includes computed outer box-shadow paint of the exact authorized badge subtree, not only the anchor box. Unsupported paint fails closed. A second full badge-free source screenshot must also match the first exactly, with equal image dimensions. This is an additional stability diagnostic only; every candidate pixel remains compared, including the entire formerly occupied badge area. No candidate masks or tolerance changes.
