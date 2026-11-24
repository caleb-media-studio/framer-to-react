# Fidelity gate: thresholds (fixed before any comparison run)

Written 2026-11-23, before the first run of `verification/fidelity-gate.ts`. Do not loosen these after seeing
results; a change needs its own dated entry below with the reason and must not be made to turn a failure into a pass.

Reference = the published Framer site, captured by `verification/evidence-sidecar.ts` (per-layer computed style + page bbox, with
provenance) plus full-page screenshots taken by the gate itself. Candidate = the generated preview built from the
enriched export. Both are rendered by the same Playwright Chromium at viewport {width, 900}, deviceScaleFactor 1,
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
