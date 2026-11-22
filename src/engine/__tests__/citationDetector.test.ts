import { describe, expect, it } from 'vitest';
import { detectCitations } from '../citationDetector';
import { parseReferences } from '../referenceParser';
import { rectForRange } from '../utils';
import { annotationDoc, textLine } from './fixtures';

describe('detectCitations', () => {
  it.each([
    ['Fig. 2', 'figure', ['fig-2']],
    ['Figure 1a', 'figure', ['fig-1a']],
    ['Table 1', 'table', ['tab-1']],
    ['Eq. (3)', 'equation', ['eq-3']],
    ['Algorithm 1', 'algorithm', ['alg-1']],
    ['Algorithms 1 and 2', 'algorithm', ['alg-1', 'alg-2']],
    ['Alg. A.1', 'algorithm', ['alg-a.1']],
    ['算法 1', 'algorithm', ['alg-1']],
    ['Theorem 2', 'theorem', ['thm-2']],
    ['Thm. 2.1', 'theorem', ['thm-2.1']],
    ['Lemma 1', 'theorem', ['lem-1']],
    ['Lem. A.1', 'theorem', ['lem-a.1']],
    ['Proposition 3', 'theorem', ['prop-3']],
    ['Prop. 3', 'theorem', ['prop-3']],
    ['Corollary 1', 'theorem', ['cor-1']],
    ['Cor. 1', 'theorem', ['cor-1']],
    ['Definition 2', 'theorem', ['def-2']],
    ['Def. 2', 'theorem', ['def-2']],
    ['定理 2', 'theorem', ['thm-2']],
    ['引理 1', 'theorem', ['lem-1']],
    ['命题 3', 'theorem', ['prop-3']],
    ['推论 1', 'theorem', ['cor-1']],
    ['定义 2', 'theorem', ['def-2']],
    ['Section 3.2', 'section', ['sec-3.2']],
    ['Sec. 3.2', 'section', ['sec-3.2']],
    ['Secs. 3 and 4', 'section', ['sec-3', 'sec-4']],
    ['§3.2', 'section', ['sec-3.2']],
    ['Appendix A', 'section', ['app-a']],
    ['Appendix B.1', 'section', ['app-b.1']],
    ['App. A', 'section', ['app-a']],
    ['第 3.2 节', 'section', ['sec-3.2']],
    ['附录 A', 'section', ['app-a']],
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

  it('ignores unnumbered environments, longer words and references inside the bibliography', async () => {
    const lines = [textLine('These apps follow a theorem. Lemma A and Proposition 2nd are labels.'),
      textLine('Algorithm 1 runs in linear time.', { y: 0.3 }),
      textLine('Theorem 2 (Bound). The bound holds.', { y: 0.4 }),
      textLine('See Appendix A and Algorithm 9.', { y: 0.5 })];
    const { 1: hits } = await detectCitations(annotationDoc(), { 1: lines },
      { refRange: { startPage: 1, endPage: 1, startY: 0.48, endY: 0.8 } });
    expect(hits.map(hit => hit.targetKeys)).toEqual([['alg-1']]);
  });

  it('merges a number-only annotation with an inline theorem and infers bare appendix links from their destination', async () => {
    const line = textLine('See Lemma 3 or B.1');
    const annotation = (start: number, dest: unknown) => {
      const r = line.chars[start].rect;
      return { subtype: 'Link', dest, rect: [r.x, r.y, r.x + r.width, r.y + r.height] };
    };
    const doc = annotationDoc([annotation(10, [2, { name: 'Fit' }]), annotation(15, 'appendix.B.1')]);
    doc.getDestination = async () => [1, { name: 'Fit' }];
    const { 1: hits } = await detectCitations(doc, { 1: [line] });
    expect(hits.map(h => [h.kind, h.targetKeys, h.nativeDest?.pageNumber])).toEqual([
      ['theorem', ['lem-3'], 3], ['section', ['app-b.1'], 2],
    ]);
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

const { referencesMap } = parseReferences({ 2: [
  textLine('References', { y: 0.1 }),
  textLine('[14] A. Vaswani et al. 2017. Attention.', { y: 0.2 }),
  textLine('Devlin et al. (2019). BERT.', { y: 0.3 }),
  textLine('Smith & Lee (2022). Results.', { y: 0.4 }),
  textLine('Brown et al. 2020. Language models.', { y: 0.5 }),
  textLine('Devlin et al. 2019b. A follow-up.', { y: 0.6 }),
] });

describe('author-year citations', () => {
  it.each([
    ['(Vaswani et al., 2017)', ['ref-14']],
    ['(e.g., Brown et al., 2020)', ['ref-ay-brown-2020']],
    ['(Vaswani et al., 2017; Devlin et al., 2019; Smith & Lee, 2022)', ['ref-14', 'ref-ay-devlin-2019', 'ref-ay-smith-2022']],
    ['Vaswani et al. (2017)', ['ref-14']],
    ['Smith and Lee (2022)', ['ref-ay-smith-2022']],
    ['Smith & Lee (2022)', ['ref-ay-smith-2022']],
    ['(Devlin et al., 2019b)', ['ref-ay-devlin-2019b']],
    ['(Vaswani et al., 2017a; Unknown, 1999)', ['ref-14']],
  ] as const)('resolves %s to the parsed bibliography', async (rawText, targetKeys) => {
    const line = textLine('See ' + rawText + '.');
    const { 1: citations } = await detectCitations(annotationDoc(), { 1: [line] }, { referencesMap });
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ rawText, targetKeys, rect: rectForRange(line, 4, 4 + rawText.length) });
  });

  it('skips unknown authors, wrong coauthors and bare years', async () => {
    const line = textLine('Unknown (2022), Smith & Kim (2022), (in 2020), and (2017).');
    expect((await detectCitations(annotationDoc(), { 1: [line] }, { referencesMap }))[1]).toEqual([]);
  });

  it('keeps wrapped groups clickable on both lines without highlighting the space between lines', async () => {
    const first = textLine('Earlier work (Vaswani et al., 2017;', { y: 0.2 });
    const second = textLine('Smith & Lee, 2022) found a difference.', { y: 0.216 });
    const { 1: hits } = await detectCitations(annotationDoc(), { 1: [second, first] }, { referencesMap });
    expect(hits.map(hit => hit.targetKeys)).toEqual([['ref-14', 'ref-ay-smith-2022'], ['ref-14', 'ref-ay-smith-2022']]);
    expect(hits.map(hit => hit.rect)).toEqual([rectForRange(first, first.text.indexOf('('), first.text.length),
      rectForRange(second, 0, second.text.indexOf(')') + 1)]);
  });
});

describe('superscript references', () => {
  const numbered = Object.fromEntries([1, 2, 3, 4, 5, 6, 12, 14, 15, 16].map(n => ['ref-' + n, {
    key: 'ref-' + n, index: n, rawText: 'Work ' + n, pageNumber: 3,
  }]));
  it.each([
    ['text14', '14', [14]], ['Evidence.1,2', '1,2', [1, 2]],
    ['Studies12,14–16', '12,14–16', [12, 14, 15, 16]],
    ['text¹⁴', '¹⁴', [14]], ['text¹⁻³', '¹⁻³', [1, 2, 3]],
  ] as const)('links %s using the actual elevated run', async (text, rawText, numbers) => {
    const line = textLine(text);
    const start = text.length - rawText.length;
    for (const [i, char] of line.chars.entries()) {
      char.fontHeight = i < start ? 0.012 : 0.008;
      char.baselineY = i < start ? 0.212 : 0.207;
      char.rect = { ...char.rect, y: char.baselineY - char.fontHeight, height: char.fontHeight };
    }
    const hits = (await detectCitations(annotationDoc(), { 1: [line] }, { referencesMap: numbered }))[1];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'reference', rawText, targetKeys: numbers.map(n => 'ref-' + n),
      rect: rectForRange(line, start, text.length) });
  });
  it('rejects math exponents, normal digits, subscripts, and absent targets', async () => {
    const line = textLine('x², 10⁶, R², O(n²), word14, results⁹ and a subscript2.');
    const sub = line.chars[line.text.lastIndexOf('2')];
    sub.fontHeight = 0.007;
    sub.baselineY = line.rect.y + line.rect.height + 0.002;
    expect((await detectCitations(annotationDoc(), { 1: [line] }, { referencesMap: numbered }))[1]).toEqual([]);
  });
});
