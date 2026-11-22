import { describe, expect, it } from 'vitest';
import { parseGlossary } from '../glossaryParser';
import { rectForRange } from '../utils';
import { textLine } from './fixtures';

describe('parseGlossary', () => {
  it('keeps the first definition in reading order and maps only subsequent whole terms to glyphs', () => {
    const definition = textLine('We use Multi-Head Attention (MHA). MHA works.', { y: 0.2 });
    const body = textLine('MHA and MHAS or nonMHA.', { pageNumber: 2 });
    const later = textLine('Multiple Head Aggregation (MHA).', { pageNumber: 3 });
    const result = parseGlossary({
      1: [definition, textLine('MHA is introduced below.', { y: 0.1 })], 2: [body], 3: [later],
    });
    const start = definition.text.indexOf('(MHA)') + 1;
    expect(result.glossaryMap.MHA).toEqual({
      term: 'MHA', expansion: 'Multi-Head Attention', contextSentence: 'We use Multi-Head Attention (MHA).',
      definedPage: 1, definedRect: rectForRange(definition, start, start + 3), kind: 'acronym',
    });
    expect(result.glossaryMentionsByPage[1]).toHaveLength(1);
    expect(result.glossaryMentionsByPage[1][0].rect.x).toEqual(definition.chars[start + 6].rect.x);
    expect(result.glossaryMentionsByPage[2]).toHaveLength(1);
    expect(result.glossaryMentionsByPage[2][0]).toMatchObject({ term: 'MHA', rawText: 'MHA', rect: rectForRange(body, 0, 3) });
    expect(result.glossaryMentionsByPage[3]).toHaveLength(1);
  });

  it.each([
    ['Low-Rank Adaptation', 'LoRA'], ['Residual Network', 'ResNet'],
    ['Layer Normalization', 'LayerNorm'], ['Mixture of Experts', 'MoE'],
    ['卷积神经网络', 'CNN'], ['图神经网络', '图网络'],
  ])('recognizes %s and its explicit abbreviation %s', (expansion, term) => {
    const cjk = expansion.startsWith('卷') || expansion.startsWith('图');
    const definition = cjk ? expansion + '（' + term + '）。' : 'We use ' + expansion + ' (' + term + ').';
    const { glossaryMap, glossaryMentionsByPage } = parseGlossary({ 1: [
      textLine(definition), textLine(cjk ? '该' + term + '可用。' : term + ' works.', { y: 0.4 }),
    ] });
    expect(glossaryMap[term]).toMatchObject({ expansion, kind: 'acronym' });
    expect(glossaryMentionsByPage[1].map(m => m.rawText)).toEqual([term]);
  });

  it('recovers a wrapped expansion and concise symbol definitions', () => {
    const { glossaryMap, glossaryMentionsByPage } = parseGlossary({ 1: [
      textLine('We use Multi-Head', { y: 0.1 }), textLine('Attention (MHA).', { y: 0.118 }),
      textLine('where d_k denotes the dimension of keys, measured per head.', { y: 0.2 }),
      textLine('where λ represents the penalty.', { y: 0.3 }),
      textLine('where L_CE is the classification loss.', { y: 0.35 }),
      textLine('Each d_k and λ is fixed; d_key is distinct.', { y: 0.4 }),
    ] });
    expect(glossaryMap.MHA.expansion).toBe('Multi-Head Attention');
    expect(glossaryMap.d_k).toMatchObject({ expansion: 'the dimension of keys', kind: 'symbol' });
    expect(glossaryMap['λ'].expansion).toBe('the penalty');
    expect(glossaryMap.L_CE.expansion).toBe('the classification loss');
    expect(glossaryMentionsByPage[1].map(m => m.term)).toEqual(['d_k', 'λ']);
  });

  it('rejects unrelated parentheticals, excluded terms, years and single-letter acronyms', () => {
    const text = 'Portable Document Format (PDF), Index Index Index (III), another method (XYZ), data (2020), alpha (A), a guess (Maybe).';
    expect(parseGlossary({ 1: [textLine(text)] }).glossaryMap).toEqual({});
  });

  it('excludes the bibliography and citation rectangles but keeps adjacent mentions', () => {
    const body = textLine('MHA MHA', { y: 0.3 });
    const rect = rectForRange(body, 0, 3)!;
    const result = parseGlossary({ 1: [
      textLine('Multi-Head Attention (MHA).'), body,
      textLine('Residual Network (ResNet). MHA.', { y: 0.8 }),
    ] }, {
      refRange: { startPage: 1, startY: 0.7, endPage: 1, endY: 1 },
      citationsByPage: { 1: [{ id: 'c', kind: 'reference', targetKeys: [], rawText: 'MHA', pageNumber: 1, lineY: 0.3, rect }] },
    });
    expect(Object.keys(result.glossaryMap)).toEqual(['MHA']);
    expect(result.glossaryMentionsByPage[1].map(m => m.rect)).toEqual([rectForRange(body, 4, 7)]);
  });
});
