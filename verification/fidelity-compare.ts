// Pure comparison rules for the fidelity gate. Tolerances are fixed in schema/FIDELITY_GATE.md; keep them in sync.
export const TOL = { lineHeightPx: 0.5, letterSpacingPx: 0.05, bboxPx: 2, docHeightPx: 2, pixelChannel: 32, pixelRatio: 0.001 } as const;

export type Style = Record<string, string>;
export interface Box { x: number; y: number; width: number; height: number }
export interface FieldMismatch { field: string; expected: string | number; actual: string | number }

const firstFamily = (v: string): string => v.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
const px = (v: string): number | null => (/^-?[\d.]+px$/.test(v.trim()) ? parseFloat(v) : null);

function within(expected: string, actual: string, tol: number, normalIsZero: boolean): boolean {
  const norm = (v: string): string => (normalIsZero && v === 'normal' ? '0px' : v);
  const e = norm(expected), a = norm(actual);
  if (e === a) return true;
  const ep = px(e), ap = px(a);
  return ep !== null && ap !== null && Math.abs(ep - ap) <= tol;
}

export function compareStyle(expected: Style, actual: Style): FieldMismatch[] {
  const out: FieldMismatch[] = [];
  const check = (field: string, ok: boolean): void => { if (!ok) out.push({ field, expected: expected[field], actual: actual[field] }); };
  check('fontFamily', firstFamily(expected.fontFamily ?? '') === firstFamily(actual.fontFamily ?? ''));
  for (const f of ['fontSize', 'fontWeight', 'textAlign', 'textTransform', 'color']) check(f, expected[f] === actual[f]);
  check('lineHeight', within(expected.lineHeight, actual.lineHeight, TOL.lineHeightPx, false));
  check('letterSpacing', within(expected.letterSpacing, actual.letterSpacing, TOL.letterSpacingPx, true));
  return out;
}

export function compareBox(expected: Box, actual: Box): FieldMismatch[] {
  return (['x', 'y', 'width', 'height'] as const)
    .filter((k) => Math.abs(expected[k] - actual[k]) > TOL.bboxPx)
    .map((k) => ({ field: `bbox.${k}`, expected: Math.round(expected[k] * 10) / 10, actual: Math.round(actual[k] * 10) / 10 }));
}

export function pixelVerdict(differing: number, total: number, heights: [number, number]): { pass: boolean; ratio: number } {
  const ratio = total ? differing / total : 1;
  return { pass: ratio <= TOL.pixelRatio && Math.abs(heights[0] - heights[1]) <= TOL.docHeightPx, ratio };
}

/** Fail closed: an empty run, incomplete coverage, or any residual finding is not a pass. */
export function gatePassed(totals: { cases: number; passing: number; mismatchLayers: number; unverified: number }, expectedCases: number): boolean {
  return Number.isInteger(expectedCases) && expectedCases > 0 &&
    totals.cases === expectedCases && totals.passing === expectedCases &&
    totals.mismatchLayers === 0 && totals.unverified === 0;
}
