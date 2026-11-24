import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareBox, compareStyle, pixelVerdict, gatePassed } from './fidelity-compare.ts';

const base = { fontFamily: '"Geist", sans-serif', fontSize: '62px', fontWeight: '600', lineHeight: '67.58px', letterSpacing: '-2.7px', textAlign: 'center', textTransform: 'none', color: 'rgb(0, 0, 0)' };

describe('compareStyle', () => {
  it('passes identical styles and ignores family quoting/fallbacks', () => {
    assert.deepEqual(compareStyle(base, { ...base, fontFamily: 'Geist, "Geist Placeholder", sans-serif' }), []);
  });
  it('flags any font-size or alignment difference', () => {
    assert.deepEqual(compareStyle(base, { ...base, fontSize: '61px', textAlign: 'start' }).map((m) => m.field), ['fontSize', 'textAlign']);
  });
  it('allows half a pixel of line-height and treats normal letter-spacing as 0px', () => {
    assert.deepEqual(compareStyle({ ...base, letterSpacing: 'normal' }, { ...base, lineHeight: '68px', letterSpacing: '0px' }), []);
    assert.deepEqual(compareStyle(base, { ...base, lineHeight: '68.2px' }).map((m) => m.field), ['lineHeight']);
  });
  it('does not equate normal line-height with a pixel value', () => {
    assert.deepEqual(compareStyle({ ...base, lineHeight: 'normal' }, base).map((m) => m.field), ['lineHeight']);
  });
});

describe('compareBox', () => {
  it('reports only edges beyond 2px', () => {
    assert.deepEqual(compareBox({ x: 0, y: 0, width: 100, height: 20 }, { x: 2, y: 3, width: 100, height: 20 }).map((m) => m.field), ['bbox.y']);
  });
});

describe('pixelVerdict', () => {
  it('fails on height drift even when pixels agree', () => {
    assert.equal(pixelVerdict(0, 1000, [900, 903]).pass, false);
    assert.equal(pixelVerdict(1, 1000, [900, 901]).pass, true);
    assert.equal(pixelVerdict(2, 1000, [900, 900]).pass, false);
  });
});

describe('gatePassed', () => {
  const good = { cases: 4, passing: 4, mismatchLayers: 0, unverified: 0 };
  it('requires complete expected coverage and zero unresolved findings', () => {
    assert.equal(gatePassed(good, 4), true);
    assert.equal(gatePassed(good, 5), false);
    assert.equal(gatePassed({ ...good, passing: 3, mismatchLayers: 1 }, 4), false);
    assert.equal(gatePassed({ ...good, unverified: 1 }, 4), false);
    assert.equal(gatePassed({ cases: 0, passing: 0, mismatchLayers: 0, unverified: 0 }, 0), false);
  });
});
