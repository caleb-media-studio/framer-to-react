// Fidelity gate: compares the generated preview against the published Framer site, per text layer and per full-page
// screenshot, using the fixed tolerances in schema/FIDELITY_GATE.md. Anything not verified is reported as unverified.
// Usage: node schema/fidelity-gate.ts <evidenceDir> <liveBaseUrl> <previewBaseUrl> <outDir> [--routes /,/blog|all] [--workers 3]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';

import { chromium, type Browser } from '@playwright/test';

import {collectRenderAudit,compareRenderAudit,type RenderAudit} from './render-audit.ts';
import { compareBox, compareStyle, pixelVerdict, gatePassed, TOL, type Box, type FieldMismatch, type Style } from './fidelity-compare.ts';

const WIDTHS = [390, 810, 1200, 1920] as const;
const VIEWPORT_HEIGHT = 900;
const NAV_TIMEOUT_MS = 60_000;
const SETTLE_MS = 800;
const STYLE_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'color'];

interface Evidence { nodeId: string; confidence: string; framerName: string; style: Style; bbox: Box }
interface EvidenceDoc { provenance?: {url?:string;responseSha256?:string;viewport?:{width:number;height:number}}; breakpointId: string | null; evidence: Evidence[]; unmatchedArchive: unknown[]; unmatchedLive: { name: string; text: string }[] }

const fileStem = (route: string): string => (route === '/' ? '_index' : route.replace(/^\//, '').replace(/\//g, '_'));

// Runs in the preview page.
export function collectPreview(args: { ids: string[]; props: string[] }): Record<string, { style: Record<string, string>; bbox: Box; visible: boolean } | null> {
  const out: Record<string, { style: Record<string, string>; bbox: Box; visible: boolean } | null> = {};
  for (const id of args.ids) {
    const el = [...document.querySelectorAll(`[data-f2a-node="${CSS.escape(id)}"]`)].find((e) => e.checkVisibility()) ?? document.querySelector(`[data-f2a-node="${CSS.escape(id)}"]`);
    if (!el) { out[id] = null; continue; }
    let block = el.matches('h1,h2,h3,h4,h5,h6,p,li') ? el : el.querySelector('h1,h2,h3,h4,h5,h6,p,li') ?? el;
    while(block.children.length===1&&block.firstElementChild?.tagName==='SPAN'&&block.firstElementChild.textContent===block.textContent&&/^(inline|block|inline-block)$/.test(getComputedStyle(block.firstElementChild).display))block=block.firstElementChild;
    const cs = getComputedStyle(block) as unknown as Record<string, string>;
    const r = el.getBoundingClientRect();
    const style: Record<string, string> = {};
    for (const p of args.props) style[p] = cs[p];
    out[id] = { style, bbox: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }, visible: el.checkVisibility() };
  }
  return out;
}

// Runs in a blank page: decodes both PNGs and counts pixels whose max channel delta exceeds the threshold.
export async function diffPngs(args: { a: string; b: string; channel: number; badgeBounds?: Box[] }): Promise<{ differing: number; total: number; heights: [number, number]; exactDiffering:number; sameDimensions:boolean; outsideBadgeDiffering:number }> {
  const load = async (b64: string): Promise<ImageBitmap> => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
  const [ia, ib] = await Promise.all([load(args.a), load(args.b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const pixels = (img: ImageBitmap): Uint8ClampedArray => {
    const c = new OffscreenCanvas(w, h); const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const pa = pixels(ia), pb = pixels(ib);
  let differing = 0, exactDiffering = 0, outsideBadgeDiffering = 0;
  const badgeBounds=args.badgeBounds??[];
  for (let i = 0; i < pa.length; i += 4) {
    if(pa[i]!==pb[i]||pa[i+1]!==pb[i+1]||pa[i+2]!==pb[i+2]||pa[i+3]!==pb[i+3]){
      exactDiffering++;
      // Diagnostic only: never subtract these pixels from the candidate comparison.
      const x=(i/4)%w,y=Math.floor(i/4/w);
      if(!badgeBounds.some(b=>x>=Math.floor(b.x)&&x<Math.ceil(b.x+b.width)&&y>=Math.floor(b.y)&&y<Math.ceil(b.y+b.height)))outsideBadgeDiffering++;
    }
    if (Math.abs(pa[i] - pb[i]) > args.channel || Math.abs(pa[i + 1] - pb[i + 1]) > args.channel || Math.abs(pa[i + 2] - pb[i + 2]) > args.channel) differing++;
  }
  return { differing, exactDiffering, total: w * h, heights: [ia.height, ib.height], sameDimensions:ia.width===ib.width&&ia.height===ib.height, outsideBadgeDiffering };
}

/**
 * Exclude only Framer's injected, out-of-flow platform branding from design fidelity.
 * Run in the isolated source test page, never modify the editor or published site.
 * Do not hide author-created links, other fixed elements, or arbitrary pixel regions.
 */
export function excludePlatformBadge(): {removed:number;bounds:{x:number;y:number;width:number;height:number}[]} {
  const container=document.getElementById('__framer-badge-container');
  if(!container||container.parentElement!==document.body||getComputedStyle(container).position!=='fixed'||getComputedStyle(container).pointerEvents!=='none')return {removed:0,bounds:[]};
  const bounds:{x:number;y:number;width:number;height:number}[]=[];
  for(const badge of Array.from(container.children)){
    if(!(badge instanceof HTMLAnchorElement)||!badge.classList.contains('__framer-badge')||badge.getAttribute('data-nosnippet')!=='true')continue;
    const target=new URL(badge.href,location.href);
    if(target.protocol!=='https:'||!['framer.com','www.framer.com'].includes(target.hostname)||target.pathname!=='/')continue;
    const r=badge.getBoundingClientRect();
    bounds.push({x:r.x,y:r.y,width:r.width,height:r.height});
    badge.style.setProperty('display','none','important');
  }
  return {removed:bounds.length,bounds};
}

async function shoot(browser: Browser, url: string, width: number, file: string, side:'source'|'candidate'): Promise<{ audit:RenderAudit;buf: Buffer; docH: number; responseSha256?:string; finalUrl:string; rawBuf?:Buffer; platformBadge?:ReturnType<typeof excludePlatformBadge>; error?: string }> {
  const page = await browser.newPage({ viewport: { width, height: VIEWPORT_HEIGHT }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(SETTLE_MS);
    const responseSha256=res?.ok()?createHash('sha256').update(await res.body()).digest('hex'):undefined;
    const rawBuf=side==='source'?await page.screenshot({path:file.replace(/\.png$/,'.original.png'),fullPage:true}):undefined;
    const platformBadge=side==='source'?await page.evaluate(excludePlatformBadge):undefined;
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const audit = await page.evaluate(collectRenderAudit,side);
    const buf = await page.screenshot({ path: file, fullPage: true });
    return { audit,buf,rawBuf,platformBadge,docH, responseSha256, finalUrl:page.url(), error: res && res.ok() ? undefined : `HTTP ${res?.status() ?? 'none'}` };
  } finally { await page.close(); }
}

async function runCase(browser: Browser, route: string, width: number, evidenceDir: string, live: string, prev: string, outDir: string): Promise<Record<string, unknown>> {
  const stem = `${fileStem(route)}.${width}`;
  const evFile = join(evidenceDir, `${stem}.json`);
  const result: Record<string, unknown> = { route, width };
  const unverified: string[] = [];
  const mismatches: { nodeId: string; name: string; fields: FieldMismatch[] }[] = [];
  const doc: EvidenceDoc | null = existsSync(evFile) ? JSON.parse(readFileSync(evFile, 'utf8')) : null;
  if (!doc) unverified.push('no evidence file');
  else if (!doc.breakpointId) unverified.push('evidence breakpointId null');

  mkdirSync(join(outDir, 'shots'), { recursive: true });
  const liveShotFile = join(outDir, 'shots', `${stem}.live.png`);
  const previewUrl = new URL(route, prev);
  previewUrl.searchParams.set('fidelity', '1');
  const [l, p] = await Promise.all([shoot(browser, new URL(route, live).href, width, liveShotFile,'source'), shoot(browser, previewUrl.href, width, join(outDir, 'shots', `${stem}.prev.png`),'candidate')]);
  if (l.error) unverified.push(`live ${l.error}`);
  if (p.error) mismatches.push({ nodeId: '(page)', name: 'preview load', fields: [{ field: 'http', expected: 200, actual: p.error }] });

  const fresh = Boolean(doc?.breakpointId && !l.error && doc.provenance?.url===new URL(route,live).href &&
    doc.provenance?.viewport?.width===width && doc.provenance?.viewport?.height===VIEWPORT_HEIGHT &&
    doc.provenance?.responseSha256 && doc.provenance.responseSha256===l.responseSha256 &&
    new URL(l.finalUrl).pathname===new URL(route,live).pathname);
  if(doc&&!fresh)unverified.push('source evidence revision, route or viewport not verified');
  if (doc && fresh && !p.error) {
    const high = doc.evidence.filter((e) => e.confidence === 'high');
    for (const e of doc.evidence.filter((e) => e.confidence !== 'high')) unverified.push(`${e.confidence} match ${e.nodeId} "${e.framerName}"`);
    for (const u of doc.unmatchedLive) unverified.push(`live text without archive match "${u.name}" "${u.text}"`);
    if (doc.unmatchedArchive.length) unverified.push(`${doc.unmatchedArchive.length} archive text layers not visible/matched live`);
    const page = await browser.newPage({ viewport: { width, height: VIEWPORT_HEIGHT }, reducedMotion: 'reduce' });
    await page.goto(previewUrl.href, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    const got = await page.evaluate(collectPreview, { ids: high.map((e) => e.nodeId), props: STYLE_PROPS });
    await page.close();
    for (const e of high) {
      const a = got[e.nodeId];
      const fields = !a ? [{ field: 'layer', expected: 'present', actual: 'missing' }] : !a.visible ? [{ field: 'layer', expected: 'visible', actual: 'hidden' }] : [...compareStyle(e.style, a.style), ...compareBox(e.bbox, a.bbox)];
      if (fields.length) mismatches.push({ nodeId: e.nodeId, name: e.framerName, fields });
    }
    result.layersChecked = high.length;
  }

  if(l.error||p.error||new URL(l.finalUrl).pathname!==new URL(route,live).pathname||new URL(p.finalUrl).pathname!==previewUrl.pathname){
    unverified.push('screenshot comparison unavailable: source or preview load/route failure');
    return {...result,docH:[l.docH,p.docH],mismatchLayers:mismatches.length,unverifiedCount:unverified.length,mismatches,unverified};
  }
  // Pass 2 independently checks rendered text/paint against a fresh source render.
  result.sourceLayerMismatchCount=mismatches.length;
  const audit=compareRenderAudit(l.audit,p.audit);
  result.renderAudit=audit;
  result.renderAuditMismatchCount=audit.findings.length;
  mismatches.push(...audit.findings);
  const blank = await browser.newPage();
  const d = await blank.evaluate(diffPngs, { a: l.buf.toString('base64'), b: p.buf.toString('base64'), channel: TOL.pixelChannel });
  const raw=l.rawBuf?await blank.evaluate(diffPngs,{a:l.rawBuf.toString('base64'),b:p.buf.toString('base64'),channel:TOL.pixelChannel}):null;
  // Removing the exact platform anchor must not change any other rendered pixel.
  // Keep the full original and filtered images and their full candidate metrics
  // even when the source changes between captures; instability never counts as a pass.
  const sourceStability=l.rawBuf?await blank.evaluate(diffPngs,{a:l.rawBuf.toString('base64'),b:l.buf.toString('base64'),channel:TOL.pixelChannel,badgeBounds:l.platformBadge?.bounds??[]}):null;
  await blank.close();
  result.sourceStability=sourceStability;
  if(!sourceStability||!sourceStability.sameDimensions||sourceStability.outsideBadgeDiffering!==0)unverified.push('source screenshot changed outside authorized platform badge bounds');
  result.platformBadge=l.platformBadge;
  if(raw)result.unfilteredPixels={differing:raw.differing,exactDiffering:raw.exactDiffering,total:raw.total,ratio:raw.differing/raw.total,exactRatio:raw.exactDiffering/raw.total};
  const v = pixelVerdict(d.differing, d.total, [l.docH, p.docH]);
  result.docH = [l.docH, p.docH];
  result.pixelRatio = Math.round(v.ratio * 1e5) / 1e5;
  result.pixelDiffering=d.differing;
  result.pixelExactDiffering=d.exactDiffering;
  result.pixelDimensionsEqual=d.sameDimensions;
  result.pixelTotal=d.total;
  result.pixelExactRatio=d.exactDiffering/d.total;
  if (!v.pass) mismatches.push({ nodeId: '(page)', name: 'full-page screenshot', fields: [{ field: 'pixels', expected: `≤${TOL.pixelRatio}`, actual: result.pixelRatio as number }, { field: 'docH', expected: l.docH, actual: p.docH }] });
  return { ...result, mismatchLayers: mismatches.length, unverifiedCount: unverified.length, mismatches, unverified };
}

async function main(): Promise<void> {
  const flag = (n: string): string | undefined => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const [evidenceDir, live, prev, outDir] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (!evidenceDir || !live || !prev || !outDir) {
    console.error('Usage: node schema/fidelity-gate.ts <evidenceDir> <liveBaseUrl> <previewBaseUrl> <outDir> [--routes /,/blog] [--workers 3]');
    process.exit(2);
  }
  const summaryFile = join(evidenceDir, 'summary.json');
  const manifestPath=flag('--manifest');
  const manifest=manifestPath ? JSON.parse(readFileSync(manifestPath,'utf8')) as {pages:{path:string;breakpoints?:{width:string}[]}[];requestedPages?:number;failures?:unknown[]} : null;
  const allRoutes = manifest ? manifest.pages.map(p=>p.path) : [...new Set((JSON.parse(readFileSync(summaryFile, 'utf8')) as { route: string }[]).map((s) => s.route))];
  if(new Set(allRoutes).size!==allRoutes.length || new Set(allRoutes.map(fileStem)).size!==allRoutes.length)throw Error('Duplicate or ambiguous route evidence filenames');

  const routeFlag = flag('--routes');
  const routes = !routeFlag || routeFlag === 'all' ? allRoutes : routeFlag.split(',');
  mkdirSync(outDir, { recursive: true });
  const fullScope=!routeFlag||routeFlag==='all';
  if(fullScope&&!manifest)throw Error('Full-project gate requires --manifest <original export manifest.json>; evidence summary cannot define expected coverage');
  if(manifest&&routes.some(r=>!allRoutes.includes(r)))throw Error('Requested route missing from original manifest');
  const cases=routes.flatMap(r=>{
    const page=manifest?.pages.find(p=>p.path===r);
    const widths=page?.breakpoints?.map(b=>parseFloat(b.width)).filter(w=>Number.isFinite(w)&&w>0)||[];
    return [...new Set([...WIDTHS,...widths])].map(w=>[r,w] as const);
  });
  const browser = await chromium.launch();
  const results: Record<string, unknown>[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const [route, width] = cases[next++];
      try { results.push(await runCase(browser, route, width, evidenceDir, live, prev, outDir)); }
      catch (err) { results.push({ route, width, error: `gate crashed: ${(err as Error).message}`, mismatchLayers: 1, unverifiedCount: 1, mismatches: [], unverified: ['gate error'] }); }
      const r = results[results.length - 1];
      console.log(JSON.stringify({ route: r.route, width: r.width, layers: r.layersChecked, mismatch: r.mismatchLayers, unverified: r.unverifiedCount, pixelRatio: r.pixelRatio, docH: r.docH, error: r.error }));
    }
  };
  try { await Promise.all(Array.from({ length: Number(flag('--workers') ?? 3) }, worker)); } finally { await browser.close(); }
  results.sort((a, b) => String(a.route).localeCompare(String(b.route)) || Number(a.width) - Number(b.width));
  const strictPixels=process.argv.includes('--strict-pixels');
  const exactPixelCases=results.filter(r=>r.pixelExactDiffering===0&&r.pixelDimensionsEqual===true).length;
  const totals = { cases: results.length, passing: results.filter((r) => r.mismatchLayers === 0 && r.unverifiedCount === 0).length, mismatchLayers: results.reduce((s, r) => s + Number(r.mismatchLayers), 0), unverified: results.reduce((s, r) => s + Number(r.unverifiedCount), 0) };
  const captureComplete=!!manifest && !manifest.failures?.length && (manifest.requestedPages??manifest.pages.length)===manifest.pages.length;
  const passed = gatePassed(totals, cases.length) && (!fullScope||captureComplete) && (!strictPixels||exactPixelCases===cases.length);
  writeFileSync(join(outDir, 'gate.json'), JSON.stringify({ passed, strictPixels, exactPixelCases, scope:fullScope?'full-project':'selected-routes', captureComplete, expectedCases: cases.length, tolerances: TOL, totals, results }, null, 2));
  console.log(JSON.stringify({ passed, totals }));
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
