import { describe, expect, it } from 'vitest';
import { parseReferences } from '../referenceParser';
import { textLine } from './fixtures';

describe('parseReferences', () => {
  it('joins wrapped entries, preserves their starting page and stops at the appendix', () => {
    const result = parseReferences({
      2: [
        textLine('See [1] for details.', { pageNumber: 2, y: 0.2 }),
        textLine('References', { pageNumber: 2, y: 0.4 }),
        textLine('[1] Quoc V. Le. A study of', { pageNumber: 2, y: 0.6 }),
        textLine('2', { pageNumber: 2, y: 0.95 }),
      ],
      3: [
        textLine('citation links. Journal of Reading, 2023.', { pageNumber: 3, y: 0.12 }),
        textLine('[2] 李明。中文引文分析。学报，2024。', { pageNumber: 3, y: 0.18 }),
        textLine('Appendix A', { pageNumber: 3, y: 0.3 }),
        textLine('[3] Appendix content', { pageNumber: 3, y: 0.4 }),
      ],
    });
    expect(Object.keys(result.referencesMap)).toEqual(['ref-1', 'ref-2']);
    expect(result.referencesMap['ref-1']).toEqual({
      key: 'ref-1', index: 1, pageNumber: 2, authors: 'Quoc V. Le',
      title: 'A study of citation links', year: '2023',
      rawText: 'Quoc V. Le. A study of citation links. Journal of Reading, 2023.',
    });
    expect(result.referencesMap['ref-2']).toMatchObject({
      pageNumber: 3, authors: '李明', title: '中文引文分析', year: '2024',
    });
    expect(result.startPage).toBe(2);
    expect(result.refRange).toEqual({
      startPage: 2, startY: 0.4 + 0.012, endPage: 3, endY: 0.18 + 0.012,
    });
  });

  it('recognizes a Chinese heading and a quoted English title', () => {
    const result = parseReferences({ 1: [
      textLine('参 考 文 献'),
      textLine('[14] Zhang, “Reading on Paper”, 2019.', { y: 0.3 }),
    ] });
    expect(result.referencesMap['ref-14']).toMatchObject({
      authors: 'Zhang', title: 'Reading on Paper', year: '2019', index: 14,
    });
  });

  it('does not interpret bracketed body citations as a bibliography', () => {
    expect(parseReferences({ 1: [textLine('[1] is discussed here.')] })).toEqual({
      referencesMap: {},
    });
  });
});
