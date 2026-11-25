import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { archiveTexts, breakpointForWidth, matchTexts, normalizeText, type ArchiveText, type LiveText } from './evidence-match.ts';

// synthetic: minimal shapes mirroring an exported design.json (kind/attributes/text/children).
function live(index: number, name: string, text: string, ancestors: string[] = []): LiveText {
  return { index, name, text, ancestors, style: {}, bbox: { x: 0, y: 0, width: 1, height: 1 }, domPath: `#${index}` };
}
function arch(nodeId: string, name: string, text: string, ancestors: string[] = []): ArchiveText {
  return { nodeId, name, text, ancestors };
}

describe('normalizeText', () => {
  it('collapses whitespace and newlines', () => {
    assert.equal(normalizeText('  Build\n  faster \t'), 'Build faster');
  });
});

describe('breakpointForWidth', () => {
  const root = {
    id: 'p', kind: 'WebPageNode', children: [
      { id: 'd', kind: 'FrameNode', attributes: { isBreakpoint: true, width: '1200px' } },
      { id: 'm', kind: 'FrameNode', attributes: { isBreakpoint: true, width: '390px' } },
    ],
  };
  it('returns the frame with the exact declared width', () => {
    assert.equal(breakpointForWidth(root, 390)?.id, 'm');
  });
  it('returns null instead of guessing a nearest breakpoint', () => {
    assert.equal(breakpointForWidth(root, 400), null);
  });
});

describe('archiveTexts', () => {
  it('collects visible text with named ancestors and skips hidden and empty nodes', () => {
    const frame = {
      id: 'f', kind: 'FrameNode', attributes: { name: 'Desktop' }, children: [
        { id: 's', kind: 'FrameNode', attributes: { name: 'Hero' }, children: [
          { id: 't1', kind: 'TextNode', attributes: { name: 'Title' }, text: 'Hi\nthere' },
          { id: 't2', kind: 'TextNode', attributes: { name: 'Empty' }, text: null },
          { id: 't3', kind: 'TextNode', attributes: { name: 'Hidden', visible: false }, text: 'x' },
        ] },
      ],
    };
    assert.deepEqual(archiveTexts(frame), [{ nodeId: 't1', name: 'Title', text: 'Hi there', ancestors: ['Hero'] }]);
  });
});

describe('matchTexts', () => {
  it('matches a unique name+text pair with high confidence', () => {
    const r = matchTexts([arch('a', 'Title', 'Hello')], [live(0, 'Title', 'Hello')]);
    assert.deepEqual(r.matches, [{ nodeId: 'a', liveIndex: 0, confidence: 'high', method: 'name+text' }]);
  });

  it('disambiguates duplicates by nearest ancestor names', () => {
    const r = matchTexts(
      [arch('a', 'Label', 'Go', ['Card A']), arch('b', 'Label', 'Go', ['Card B'])],
      [live(0, 'Label', 'Go', ['Card B']), live(1, 'Label', 'Go', ['Card A'])],
    );
    assert.deepEqual(r.matches.map((m) => [m.nodeId, m.liveIndex, m.confidence]), [['a', 1, 'medium'], ['b', 0, 'medium']]);
  });

  it('falls back to document order only when duplicate counts agree', () => {
    const same = matchTexts([arch('a', 'L', 'x'), arch('b', 'L', 'x')], [live(0, 'L', 'x'), live(1, 'L', 'x')]);
    assert.deepEqual(same.matches.map((m) => m.confidence), ['low', 'low']);
    const uneven = matchTexts([arch('a', 'L', 'x'), arch('b', 'L', 'x')], [live(0, 'L', 'x'), live(1, 'L', 'x'), live(2, 'L', 'x')]);
    assert.deepEqual(uneven.matches, []);
    assert.deepEqual(uneven.unmatchedArchive, ['a', 'b']);
  });

  it('uses text-only matching only when text is unique on both sides', () => {
    const r = matchTexts([arch('a', 'Old name', 'Pricing'), arch('b', 'X', 'Dup')], [live(0, 'New name', 'Pricing'), live(1, 'Y', 'Dup'), live(2, 'Z', 'Dup')]);
    assert.deepEqual(r.matches, [{ nodeId: 'a', liveIndex: 0, confidence: 'low', method: 'text-only' }]);
    assert.deepEqual(r.unmatchedArchive, ['b']);
  });

  it('never matches when text differs even if names agree', () => {
    const r = matchTexts([arch('a', 'Title', 'Hello')], [live(0, 'Title', 'Goodbye')]);
    assert.deepEqual(r.matches, []);
    assert.deepEqual(r.unmatchedLive, [0]);
  });
});

describe('exact duplicate ancestry', () => {
  it('only promotes unique complete named paths with at least two ancestors', () => {
    const r = matchTexts(
      [arch('a','Action','Open',['Section','Card A']), arch('b','Action','Open',['Section','Card B'])],
      [live(0,'Action','Open',['Section','Card B']),live(1,'Action','Open',['Section','Card A'])]
    );
    assert.deepEqual(r.matches.map(m => [m.nodeId,m.liveIndex,m.confidence,m.method]), [
      ['a',1,'high','name+text+exact-ancestry'],['b',0,'high','name+text+exact-ancestry']
    ]);
  });
  it('does not promote ambiguous, incomplete, or merely similar paths', () => {
    const r = matchTexts(
      [arch('a','Action','Open',['Section','Card']),arch('b','Action','Open',['Section','Card'])],
      [live(0,'Action','Open',['Section','Card']),live(1,'Action','Open',['Other','Card'])]
    );
    assert.ok(r.matches.every(m=>m.confidence!=='high'));
    const other = matchTexts(
      [arch('a','Action','Open',['Section','Card A']),arch('b','Action','Open',['Section','Card B'])],
      [live(0,'Action','Open',['Different','Card A']),live(1,'Action','Open',['Different','Card B'])]
    );
    assert.ok(other.matches.every(m=>m.confidence!=='high'));
  });
});

describe('exact sibling context',()=>{
 it('distinguishes repeated cell labels with identical ancestry and unique adjacent content',()=>{
  const a=(id:string,content:string)=>({...arch(id,'Label','Item',['Table','Row','Cell']),siblingText:[JSON.stringify(['Value',content])]});
  const l=(id:number,content:string)=>({...live(id,'Label','Item',['Table','Row','Cell']),siblingText:[JSON.stringify(['Value',content])]});
  const r=matchTexts([a('a','Alpha'),a('b','Beta')],[l(0,'Beta'),l(1,'Alpha')]);
  assert.deepEqual(r.matches.map(m=>[m.nodeId,m.liveIndex,m.confidence,m.method]),[['a',1,'high','name+text+siblings'],['b',0,'high','name+text+siblings']]);
  assert.ok(matchTexts([a('a','Alpha'),a('b','Alpha')],[l(0,'Alpha'),l(1,'Alpha')]).matches.every(m=>m.confidence!=='high'));
  assert.ok(matchTexts([a('a','Alpha'),a('b','Beta')],[l(0,'Gamma'),l(1,'Delta')]).matches.every(m=>m.confidence!=='high'));
 })
})

describe('exact ancestor content context',()=>{
 it('matches repeated cells only with a unique captured ancestor text signature',()=>{
  const path=['Table','Row','Cell'];
  const context=(s:string)=>JSON.stringify(['Row',[JSON.stringify(['Label','Same']),JSON.stringify(['Other',s])].sort()]);
  const a=(id:string,s:string)=>({...arch(id,'Label','Same',path),ancestorContexts:[context(s)]});
  const l=(id:number,s:string)=>({...live(id,'Label','Same',path),ancestorContexts:[context(s)]});
  const r=matchTexts([a('a','A'),a('b','B')],[l(0,'B'),l(1,'A')]);
  assert.deepEqual(r.matches.map(m=>[m.nodeId,m.liveIndex,m.confidence,m.method]),[['a',1,'high','name+text+ancestor-content'],['b',0,'high','name+text+ancestor-content']]);
  assert.ok(matchTexts([a('a','A'),a('b','A')],[l(0,'A'),l(1,'A')]).matches.every(m=>m.confidence!=='high'));
  assert.ok(matchTexts([a('a','A'),a('b','B')],[{...l(0,'A'),ancestorContexts:[context('A'),context('B')]},l(1,'C')]).matches.every(m=>m.confidence!=='high'));
  assert.ok(matchTexts([a('a','A'),a('b','B')],[{...l(0,'A'),ancestors:['Other','Row','Cell']},l(1,'C')]).matches.every(m=>m.confidence!=='high'));
 });
 it('retains original component variant ancestry rather than substituting the instance name',()=>{
  const root={id:'root',kind:'FrameNode',children:[{id:'instance',kind:'FrameNode',attributes:{name:'Instance',editorVariantName:'Variant'},children:[{id:'label',kind:'TextNode',text:'Open',attributes:{name:'Label'}}]}]};
  assert.deepEqual(archiveTexts(root)[0].ancestors,['Instance','Variant']);
 });
});
