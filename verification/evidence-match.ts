// Matches archive TextNodes to text containers observed on the published site, so published computed styles can be
// attached as opt-in *evidence* for fields the Plugin API did not capture. Never produces a value for an unmatched node.

export type Confidence = 'high' | 'medium' | 'low';

export interface ArchiveText {
  nodeId: string;
  name: string;
  text: string;
  /** Named ancestors from the breakpoint frame down (excluding the node itself). */
  ancestors: string[];
  siblingText?: string[];
}

export interface LiveText {
  /** Index in document order among visible RichTextContainers. */
  index: number;
  name: string;
  text: string;
  ancestors: string[];
  style: Record<string, string>;
  bbox: { x: number; y: number; width: number; height: number };
  domPath: string;
  hardBreakText?: string;
  siblingText?: string[];
}

export interface TextMatch {
  nodeId: string;
  liveIndex: number;
  confidence: Confidence;
  method: 'name+text' | 'name+text+ancestors' | 'name+text+exact-ancestry' | 'name+text+siblings' | 'name+text+order' | 'text-only';
}

export interface MatchResult {
  matches: TextMatch[];
  unmatchedArchive: string[];
  unmatchedLive: number[];
}

interface ArchiveNode {
  id: string;
  kind: string;
  attributes?: { name?: string; width?: string; isBreakpoint?: boolean; visible?: boolean };
  text?: string | null;
  children?: ArchiveNode[];
}

export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Breakpoint frame whose declared width equals the viewport; null when none does (no nearest-width guessing). */
export function breakpointForWidth(root: ArchiveNode, width: number): ArchiveNode | null {
  const frames = (root.children ?? []).filter((c) => c.attributes?.isBreakpoint);
  return frames.find((f) => f.attributes?.width === `${width}px`) ?? null;
}

export function archiveTexts(frame: ArchiveNode): ArchiveText[] {
  const out: ArchiveText[] = [];
  function walk(node: ArchiveNode, ancestors: string[], siblings: ArchiveNode[] = []): void {
    if (node.attributes?.visible === false) return;
    const name = node.attributes?.name ?? '';
    if (node.kind === 'TextNode' && node.text) {
      const siblingText = siblings.filter(s => s !== node && s.attributes?.visible !== false && s.kind === 'TextNode' && s.text?.trim())
        .map(s => JSON.stringify([s.attributes?.name ?? '', normalizeText(s.text!)]));
      out.push({ nodeId: node.id, name, text: normalizeText(node.text), ancestors, ...(siblingText.length ? {siblingText} : {}) });
    }
    const next = node === frame ? ancestors : [...ancestors, name];
    for (const child of node.children ?? []) walk(child, next, node.children);
  }
  walk(frame, []);
  return out;
}

function key(t: { name: string; text: string }): string {
  return `${t.name}\u0000${t.text}`;
}

/** Number of trailing ancestor names shared (nearest ancestors weigh most). */
function sharedSuffix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function groupBy<T>(items: T[], k: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) m.set(k(item), [...(m.get(k(item)) ?? []), item]);
  return m;
}

export function matchTexts(archive: ArchiveText[], live: LiveText[]): MatchResult {
  const matches: TextMatch[] = [];
  const usedA = new Set<string>();
  const usedL = new Set<number>();
  const take = (a: ArchiveText, l: LiveText, confidence: Confidence, method: TextMatch['method']): void => {
    matches.push({ nodeId: a.nodeId, liveIndex: l.index, confidence, method });
    usedA.add(a.nodeId);
    usedL.add(l.index);
  };

  const liveByKey = groupBy(live, key);
  for (const [k, as] of groupBy(archive, key)) {
    const ls = liveByKey.get(k) ?? [];
    if (ls.length === 0) continue;
    if (as.length === 1 && ls.length === 1) {
      take(as[0], ls[0], 'high', 'name+text');
      continue;
    }
    // Exact, nonempty named ancestry uniquely identifies a repeated label on both sides.
    // Require two or more named ancestors and a unique full path on each side.
    // A shared immediate parent alone, or uniqueness obtained by removing another match, is not sufficient.
    const pathKey = (t: { ancestors: string[] }): string => JSON.stringify(t.ancestors.filter(n => n.trim()));
    const byArchivePath = groupBy(as, pathKey);
    const byLivePath = groupBy(ls, pathKey);
    for (const [path, candidates] of byArchivePath) {
      const reference = byLivePath.get(path) ?? [];
      if (candidates.length !== 1 || reference.length !== 1) continue;
      if (candidates[0].ancestors.filter(n => n.trim()).length < 2) continue;
      take(candidates[0], reference[0], 'high', 'name+text+exact-ancestry');
    }
    // Repeated labels may have identical named paths but distinct adjacent cell contents.
    // Match exact, nonempty named paths plus exact direct sibling-text signatures on both sides.
    // Require uniqueness across the original groups, never just remaining candidates.
    const siblingKey = (t: ArchiveText | LiveText): string | null =>
      t.ancestors.filter(n=>n.trim()).length >= 2 && t.siblingText?.length
        ? JSON.stringify([pathKey(t),t.siblingText]) : null;
    for (const a of as) {
      if (usedA.has(a.nodeId)) continue;
      const key = siblingKey(a);
      if (!key || as.filter(x=>siblingKey(x)===key).length!==1) continue;
      const exact = ls.filter(x=>siblingKey(x)===key);
      if(exact.length===1 && !usedL.has(exact[0].index)) take(a,exact[0],'high','name+text+siblings');
    }
    // Partial ancestor overlap and document order remain diagnostic only.
    for (const a of as) {
      if (usedA.has(a.nodeId)) continue;
      const scored = ls.filter((l) => !usedL.has(l.index)).map((l) => ({ l, s: sharedSuffix(a.ancestors, l.ancestors) }));
      const best = Math.max(0, ...scored.map((x) => x.s));
      const top = scored.filter((x) => x.s === best);
      if (best > 0 && top.length === 1) take(a, top[0].l, 'medium', 'name+text+ancestors');
    }
    const restA = as.filter((a) => !usedA.has(a.nodeId));
    const restL = ls.filter((l) => !usedL.has(l.index));
    if (restA.length > 0 && restA.length === restL.length) restA.forEach((a, i) => take(a, restL[i], 'low', 'name+text+order'));
  }

  // Text alone, only when the text is unique on both sides among the leftovers (layer renamed or name not emitted).
  const leftA = groupBy(archive.filter((a) => !usedA.has(a.nodeId)), (a) => a.text);
  const leftL = groupBy(live.filter((l) => !usedL.has(l.index)), (l) => l.text);
  for (const [text, as] of leftA) {
    const ls = leftL.get(text) ?? [];
    if (as.length === 1 && ls.length === 1) take(as[0], ls[0], 'low', 'text-only');
  }

  return {
    matches,
    unmatchedArchive: archive.filter((a) => !usedA.has(a.nodeId)).map((a) => a.nodeId),
    unmatchedLive: live.filter((l) => !usedL.has(l.index)).map((l) => l.index),
  };
}
