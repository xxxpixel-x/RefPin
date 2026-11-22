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
      key: 'ref-1', index: 1, pageNumber: 2, authors: 'Quoc V. Le', firstAuthorLastName: 'le', isEtAl: false,
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

  it('splits unnumbered ACL and APA entries at margin resets, keeping wrapped authors and titles', () => {
    const { referencesMap } = parseReferences({ 1: [
      textLine('References', { y: 0.1 }),
      textLine('Ashish Vaswani, Noam Shazeer,', { y: 0.2 }),
      textLine('and Jakob Uszkoreit. 2017a. Attention is all', { y: 0.216, x: 0.11 }),
      textLine('you need. In NeurIPS.', { y: 0.232, x: 0.11 }),
      textLine('Vaswani et al. 2017b. Follow-up.', { y: 0.248 }),
      textLine('Smith, J., & Lee, A. (2022). Measuring attention.', { y: 0.285 }),
    ] });
    expect(Object.keys(referencesMap)).toEqual(['ref-ay-vaswani-2017a', 'ref-ay-vaswani-2017b', 'ref-ay-smith-2022']);
    expect(referencesMap['ref-ay-vaswani-2017a']).toMatchObject({
      firstAuthorLastName: 'vaswani', secondAuthorLastName: 'shazeer', isEtAl: true,
      year: '2017a', title: 'Attention is all you need',
    });
    expect(referencesMap['ref-ay-vaswani-2017b']).toMatchObject({ isEtAl: true, year: '2017b' });
    expect(referencesMap['ref-ay-smith-2022']).toMatchObject({
      firstAuthorLastName: 'smith', secondAuthorLastName: 'lee', year: '2022', title: 'Measuring attention',
    });
  });

  it('preserves numeric IDs in a mixed bibliography and assigns deterministic collision suffixes', () => {
    const { referencesMap } = parseReferences({ 1: [
      textLine('References', { y: 0.1 }),
      textLine('1. Brown et al. Language models. Science, 2020.', { y: 0.2 }),
      textLine('García & Lee (2022). One result.', { y: 0.3 }),
      textLine('García and Kim (2022). Another result.', { y: 0.4 }),
    ] });
    expect(Object.keys(referencesMap)).toEqual(['ref-1', 'ref-ay-garcía-2022', 'ref-ay-garcía-2022-2']);
    expect(referencesMap['ref-1']).toMatchObject({ firstAuthorLastName: 'brown', year: '2020', title: 'Language models' });
  });

  it('splits year-last Nature entries with hanging titles at a paragraph break', () => {
    const { referencesMap } = parseReferences({ 1: [
      textLine('References and Notes', { y: 0.1 }),
      textLine('Smith, J. & Lee, A. Some experiments.', { y: 0.2 }),
      textLine('Nature 42, 100–103 (2022).', { x: 0.11, y: 0.216 }),
      textLine('Devlin, J. et al. Language models. Science 18, 10–20 (2019).', { y: 0.25 }),
    ] });
    expect(Object.keys(referencesMap)).toEqual(['ref-ay-smith-2022', 'ref-ay-devlin-2019']);
    expect(referencesMap['ref-ay-smith-2022']).toMatchObject({ secondAuthorLastName: 'lee', title: 'Some experiments' });
    expect(referencesMap['ref-ay-devlin-2019']).toMatchObject({ isEtAl: true, title: 'Language models' });
  });
});
