import { describe, expect, it } from 'vitest';
import type { InlineCitation, PaperAsset } from '../../types/paper';
import { buildBacklinksMap, currentPageAssets } from '../backlinks';

function mention(id: string, targetKeys: string[], pageNumber: number, y: number): InlineCitation {
  return {
    id, targetKeys, pageNumber, kind: 'figure', rawText: 'Fig. 2a',
    rect: { x: 0.2, y, width: 0.1, height: 0.02 }, lineY: y,
  };
}

describe('buildBacklinksMap', () => {
  it('indexes panel and base targets once per occurrence in page and vertical order', () => {
    const a = mention('a', ['fig-2a', 'fig-2', 'fig-2a'], 4, 0.2);
    const b = mention('b', ['fig-2b'], 4, 0.6);
    const c = mention('c', ['fig-2'], 1, 0.8);
    const result = buildBacklinksMap({ 4: [b, a, a], 1: [c] });
    expect(result['fig-2'].map((link) => link.citationId)).toEqual(['c', 'a', 'b']);
    expect(result['fig-2a']).toEqual([{ citationId: 'a', pageNumber: 4, rect: a.rect, rawText: 'Fig. 2a' }]);
    expect(result['fig-2b']).toEqual([result['fig-2'][2]]);
  });
  it('indexes each referenced work and skips destinations without a target key', () => {
    const citation = { ...mention('refs', ['ref-1', 'ref-3'], 2, 0.3), kind: 'reference' as const, rawText: '[1, 3]' };
    const result = buildBacklinksMap({ 2: [citation, mention('section', [], 2, 0.6)] });
    expect(Object.keys(result).sort()).toEqual(['ref-1', 'ref-3']);
    expect(result['ref-1']).toEqual(result['ref-3']);
    expect(buildBacklinksMap({})).toEqual({});
  });
});

it('auto-syncs each cross-page asset once, resolves panels, and keeps manual pins stable', () => {
  const fig: PaperAsset = { key: 'fig-1', kind: 'figure', label: 'Figure 1', caption: '', pageNumber: 5,
    cropRect: { x: 0, y: 0, width: 1, height: 1 } };
  const table: PaperAsset = { ...fig, key: 'tab-2', kind: 'table' };
  const local: PaperAsset = { ...fig, key: 'fig-3', pageNumber: 1 };
  const assets = { 'fig-1': fig, 'tab-2': table, 'fig-3': local };
  const citations = [mention('a', ['fig-1a', 'tab-2', 'fig-3'], 1, 0.2), mention('b', ['fig-1'], 1, 0.5)];
  expect(currentPageAssets(1, citations, assets, [])).toEqual([fig, table]);
  const pins = [{ id: table.key, kind: table.kind, title: 'Renamed', createdAt: 1, pageNumber: 5 }];
  expect(currentPageAssets(1, citations, assets, pins)).toEqual([fig]);
  expect(currentPageAssets(2, [], assets, pins)).toEqual([]);
  expect(pins.map(pin => pin.title)).toEqual(['Renamed']);
});
