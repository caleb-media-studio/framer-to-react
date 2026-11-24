// Opt-in evidence sidecar: measures the *published* site (not the editor) at the four QA widths and attaches its computed
// text styles and bounding boxes to archive TextNodes that match reliably (schema/evidence-match.ts). Output is evidence
// with provenance and confidence, kept separate from the export; it never fills a field for an unmatched node.
// Usage: node schema/evidence-sidecar.ts <exportDir> <publishedBaseUrl> <outDir> [--routes /,/blog | all]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

import {expandCanvasTree} from '../src/generator.ts';
import {collectCanvasComponents} from '../src/preview.ts';
import type {ArchiveFiles,DesignNode} from '../src/types.ts';
import { archiveTexts, breakpointForWidth, matchTexts, type LiveText } from './evidence-match.ts';

const WIDTHS = [390, 810, 1200, 1920] as const;
const VIEWPORT_HEIGHT = 900;
const NAV_TIMEOUT_MS = 60_000;
const SETTLE_MS = 800;
const STYLE_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'color', 'whiteSpace'] as const;

interface DesignFile { pagePath: string; roots: Parameters<typeof breakpointForWidth>[0][] }

function readDesigns(exportDir: string): DesignFile[] {
  // manifest.json maps routes to page directories; nested routes (/auth/login) live in nested folders.
  const manifestFile = join(exportDir, 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`No manifest.json in ${exportDir}; pass the extracted export root.`);
  const pages = (JSON.parse(readFileSync(manifestFile, 'utf8')) as { pages: { directory: string }[] }).pages;
  return pages
    .map((p) => join(exportDir, p.directory, 'design.json'))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, 'utf8')) as DesignFile);
}

// Runs in the page. Only visible RichTextContainers count, so SSR copies of other breakpoints are excluded.
function collectLive(props: readonly string[]): Omit<LiveText, 'index'>[] {
  const named = (el: Element | null): string[] => {
    const out: string[] = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const n = e.getAttribute('data-framer-name');
      if (n) out.unshift(n);
    }
    return out;
  };
  const path = (el: Element): string => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const i = e.parentElement ? [...e.parentElement.children].indexOf(e) + 1 : 1;
      parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`);
    }
    return parts.join('>');
  };
  return [...document.querySelectorAll('[data-framer-component-type="RichTextContainer"]')]
    .filter((el) => el.checkVisibility())
    .map((el) => {
      let block = el.querySelector('h1,h2,h3,h4,h5,h6,p,li') ?? el;
      if(block===el){
        // Framer can emit a RichTextContainer whose whole text lives in nested spans.
        // Follow a single text-preserving inline chain rather than reading wrapper defaults.
        while(block.children.length===1&&block.firstElementChild?.tagName==='SPAN'&&block.firstElementChild.textContent===block.textContent&&/^(inline|block|inline-block)$/.test(getComputedStyle(block.firstElementChild).display))block=block.firstElementChild;
      }
      const cs = getComputedStyle(block) as unknown as Record<string, string>;
      const r = el.getBoundingClientRect();
      const style: Record<string, string> = { tag: block.tagName.toLowerCase(), blocks: String(el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').length) };
      for (const p of props) style[p] = cs[p];
      // Only explicit BRs within a single text block. Never infer a hard break from visual wrapping.
      const singleBlock = style.blocks === '1';
      const hardBreakText = singleBlock && block.querySelector('br') ? (() => {
        function read(n: Node): string {
          if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
          if (n instanceof HTMLBRElement) return '\n';
          return [...n.childNodes].map(read).join('');
        }
        return read(block);
      })() : undefined;
      // Capture actual inline typography, not HTML or guessed styles. Only a single block
      // made of plain text and inline formatting elements can be safely reconstructed.
      const inlineRuns = singleBlock && block.children.length && !block.querySelector('a,img,svg,button') &&
        [...block.querySelectorAll('*')].every(n => /^(SPAN|B|STRONG|I|EM|U|S|BR)$/.test(n.tagName) && getComputedStyle(n).display === 'inline')
        ? (() => {
          const fields = ['fontSize','lineHeight','fontWeight','letterSpacing','fontStyle','color'] as const;
          const runs: {text:string;style:Record<string,string>}[] = [];
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeType !== Node.TEXT_NODE && !(n instanceof HTMLBRElement)) continue;
            const text = n instanceof HTMLBRElement ? '\n' : n.textContent ?? '';
            if (!text || !n.parentElement) continue;
            const css = getComputedStyle(n.parentElement);
            const delta: Record<string,string> = {};
            for (const k of fields) if (css[k] !== cs[k]) delta[k] = css[k];
            const last = runs.at(-1);
            if (last && JSON.stringify(last.style) === JSON.stringify(delta)) last.text += text;
            else runs.push({text,style:delta});
          }
          return runs.some(r=>Object.keys(r.style).length) ? runs : undefined;
        })() : undefined;
      const siblingText = [...(el.parentElement?.children ?? [])].filter(s=>s!==el && s.getAttribute('data-framer-component-type')==='RichTextContainer' && s.checkVisibility() && s.textContent?.trim())
        .map(s=>JSON.stringify([s.getAttribute('data-framer-name')??'',(s.textContent??'').normalize('NFC').replace(/\s+/g,' ').trim()]));
      return {
        ...(siblingText.length ? {siblingText} : {}),
        name: el.getAttribute('data-framer-name') ?? '',
        text: (el.textContent ?? '').normalize('NFC').replace(/\s+/g, ' ').trim(),
        ancestors: named(el.parentElement),
        style,
        bbox: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
        domPath: path(el),
        ...(hardBreakText === undefined ? {} : {hardBreakText}),
        ...(inlineRuns === undefined ? {} : {inlineRuns}),
      };
    });
}

async function main(): Promise<void> {
  const [exportDir, baseUrl, outDir] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--routes');
  if (!exportDir || !baseUrl || !outDir) {
    console.error('Usage: node schema/evidence-sidecar.ts <exportDir> <publishedBaseUrl> <outDir> [--routes /,/blog | all]');
    process.exit(2);
  }
  const routesArg = process.argv[process.argv.indexOf('--routes') + 1];
  const designs = readDesigns(exportDir);
  const library:ArchiveFiles={}
  const defsPath=join(exportDir,'library/components.json')
  if(existsSync(defsPath)){
    library['library/components.json']=readFileSync(defsPath,'utf8')
    const defs=JSON.parse(library['library/components.json']) as {folder:string}[]
    for(const def of defs){
      if(typeof def.folder!=='string'||!def.folder.startsWith('library/components/')||def.folder.split('/').some(p=>p==='..'||p==='.'||!p)||def.folder.includes('\\'))continue
      const key=def.folder+'/design.json';const file=join(exportDir,key)
      if(existsSync(file))library[key]=readFileSync(file,'utf8')
    }
  }
  const canvas=collectCanvasComponents(library)
  const routes = !process.argv.includes('--routes') ? ['/'] : routesArg === 'all' ? designs.map((d) => d.pagePath) : routesArg.split(',');
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const summary: Record<string, unknown>[] = [];
  let next=0;
  const worker=async()=>{
    while(next<routes.length){
      const route=routes[next++];
      const design = designs.find((d) => d.pagePath === route);
      if (!design) { summary.push({ route, error: 'route not in export' }); continue; }
      for (const width of WIDTHS) {
        const frame = breakpointForWidth(design.roots[0], width);
        const url = new URL(route, baseUrl).href;
        const page = await browser.newPage({ viewport: { width, height: VIEWPORT_HEIGHT }, reducedMotion: 'reduce' });
        try {
        const res = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
        if (!res || !res.ok()) { summary.push({ route, width, error: `HTTP ${res?.status() ?? 'no response'} for ${url}` }); continue; }
        await page.waitForTimeout(SETTLE_MS);
        await page.evaluate(()=>document.fonts.ready);
        const body = await res.body();
        const live = (await page.evaluate(collectLive, STYLE_PROPS)).map((l, index) => ({ ...l, index }));
        const userAgent = await page.evaluate(() => navigator.userAgent);

        const archive = frame ? archiveTexts(expandCanvasTree(frame as DesignNode,id=>canvas.get(String(id))||null)) : [];
        const result = frame ? matchTexts(archive, live) : { matches: [], unmatchedArchive: [], unmatchedLive: live.map((l) => l.index) };
        const evidence = result.matches.map((m) => {
          const l = live[m.liveIndex];
          return { nodeId: m.nodeId, breakpointId: frame?.id, confidence: m.confidence, method: m.method, framerName: l.name, style: l.style, bbox: l.bbox, domPath: l.domPath, ...(l.hardBreakText === undefined ? {} : {hardBreakText: l.hardBreakText}), ...(l.inlineRuns === undefined ? {} : {inlineRuns:l.inlineRuns}) };
        });
        const provenance = {
          source: 'published-site', url, viewport: { width, height: VIEWPORT_HEIGHT }, capturedAt: new Date().toISOString(), userAgent,
          responseSha256: createHash('sha256').update(body).digest('hex'),
          note: 'Computed styles of the published render. Evidence only; not editor data. Unmatched nodes have no evidence.',
        };
        const file = join(outDir, `${route === '/' ? '_index' : route.replace(/^\//, '').replace(/\//g, '_')}.${width}.json`);
        writeFileSync(file, JSON.stringify({ provenance, breakpointId: frame?.id ?? null, evidence, unmatchedArchive: result.unmatchedArchive, unmatchedLive: result.unmatchedLive.map((i) => ({ name: live[i].name, text: live[i].text.slice(0, 80) })) }, null, 2));
        const by = (c: string): number => evidence.filter((e) => e.confidence === c).length;
        summary.push({ route, width, breakpoint: frame?.attributes?.name ?? null, archiveTexts: archive.length, liveTexts: live.length, high: by('high'), medium: by('medium'), low: by('low'), unmatchedArchive: result.unmatchedArchive.length, unmatchedLive: result.unmatchedLive.length });
        } catch(error) {
          summary.push({route,width,error:String(error)});
        } finally {
          await page.close().catch(()=>{});
          writeFileSync(join(outDir,'summary.json'),JSON.stringify(summary,null,2));
          console.log(JSON.stringify(summary.find(row=>row.route===route&&row.width===width)));
        }
      }
    }
  };
  try { await Promise.all(Array.from({length:4},worker)); } finally { await browser.close(); }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({completed:summary.length,expected:routes.length*WIDTHS.length,errors:summary.filter(s=>s.error).length}));
}

await main();
