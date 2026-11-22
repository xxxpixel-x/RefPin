import { describe, expect, it } from 'vitest';
import { detectCitations } from '../citationDetector';
import { annotationDoc, textLine } from './fixtures';

describe('detectCitations', () => {
  it.each([
    ['Fig. 2', 'figure', ['fig-2']],
    ['Figure 1a', 'figure', ['fig-1a']],
    ['Table 1', 'table', ['tab-1']],
    ['Eq. (3)', 'equation', ['eq-3']],
    ['[14]', 'reference', ['ref-14']],
    ['[1, 3-5]', 'reference', ['ref-1', 'ref-3', 'ref-4', 'ref-5']],
    ['图 2', 'figure', ['fig-2']],
    ['表 1', 'table', ['tab-1']],
    ['公式 (2)', 'equation', ['eq-2']],
  ])('locates %s on the text layer', async (rawText, kind, targetKeys) => {
    const line = textLine(`See ${rawText}.`);
    const { 1: hits } = await detectCitations(annotationDoc(), { 1: [line] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: 'cite-1-0', pageNumber: 1, rawText, kind, targetKeys, rect: { y: line.rect.y },
    });
    expect(hits[0].rect.x).toBeCloseTo(line.chars[4].rect.x);
    expect(hits[0].rect.width).toBeCloseTo(String(rawText).length * 0.008);
  });

  it('retains sentence-initial body mentions and skips caption labels and bibliography entries', async () => {
    const { 1: hits } = await detectCitations(annotationDoc(), { 1: [
      textLine('Figure 1a shows the model.'),
      textLine('Figure 2: Results.', { y: 0.3 }),
      textLine('[14] A reference entry.', { y: 0.5 }),
    ] }, { refRange: { startPage: 1, startY: 0.48, endPage: 1, endY: 0.65 } });
    expect(hits.map((hit) => hit.rawText)).toEqual(['Figure 1a']);
  });

  it('deduplicates overprinted text and overlapping reference ranges while retaining separate mentions', async () => {
    const line = textLine('See [1, 1-3] and [1].');
    const { 1: hits } = await detectCitations(annotationDoc(), { 1: [line, { ...line }] });
    expect(hits.map((hit) => hit.targetKeys)).toEqual([['ref-1', 'ref-2', 'ref-3'], ['ref-1']]);
    expect(hits[0].rect.x + hits[0].rect.width).toBeLessThan(hits[1].rect.x);
  });

  it('merges repeated native links with the exact text hit while keeping adjacent destinations separate', async () => {
    const line = textLine('[1][2]', { width: 0.018 });
    const annotation = (start: number, destPageIndex: number) => {
      const { x, y, height } = line.chars[start + 1].rect;
      return { subtype: 'Link', dest: [destPageIndex, { name: 'Fit' }], rect: [x, y, x + 0.002, y + height] };
    };
    const a = annotation(0, 2);
    const doc = annotationDoc([a, a, annotation(3, 3)]);
    const { 1: hits } = await detectCitations(doc, { 1: [line] });
    expect(hits.map((hit) => [hit.rawText, hit.nativeDest?.pageNumber])).toEqual([['[1]', 3], ['[2]', 4]]);
  });
});
