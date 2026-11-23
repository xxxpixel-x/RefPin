import { describe, expect, it } from 'vitest';
import { locateLabels, scoreCitations, type LabelsFile } from '../../../eval/scoring';
import { detectCitations } from '../citationDetector';
import { annotationDoc, textLine } from './fixtures';
import { rectForRange } from '../utils';

describe('引用识别评测', () => {
  it('分别评测仅文本、仅有内部链接和合并后的引用，范围外的页面不参与计分', async () => {
    const line = textLine('See Fig. 2, Table 1 and B.1.');
    const link = (text: string, dest: string) => {
      const start = line.text.indexOf(text);
      const r = rectForRange(line, start, start + text.length)!;
      return { subtype: 'Link', dest, rect: [r.x, r.y, r.x + r.width, r.y + r.height] };
    };
    const figure = link('2', 'figure.2');
    const doc = annotationDoc([figure, figure, link('B.1', 'appendix.B.1')]);
    doc.getDestination = async () => [0, { name: 'Fit' }];
    const pages = { 1: [line], 2: [textLine('See Fig. 8.', { pageNumber: 2 })] };
    const file = { reviewedPages: [1], citations: [
      { pageNumber: 1, text: 'Fig. 2', targetKeys: ['fig-2'] },
      { pageNumber: 1, text: 'Table 1', targetKeys: ['tab-1'] },
      { pageNumber: 1, text: 'B.1', targetKeys: ['app-b.1'] },
    ] };
    const labels = locateLabels(file, pages);
    for (const [channel, keys] of [
      ['native', ['fig-2', 'app-b.1']], ['text', ['fig-2', 'tab-1']], ['both', ['fig-2', 'tab-1', 'app-b.1']],
    ] as const) {
      const predictions = await detectCitations(doc, pages, { channel });
      expect(predictions[1].map(p => p.targetKeys[0])).toEqual(keys);
      expect(scoreCitations(file, labels, predictions)).toMatchObject({
        predicted: keys.length, matched: keys.length, labeled: 3, precision: 1, recall: keys.length / 3, targetAccuracy: 1,
      });
    }
  });

  it('按同页字形重叠匹配一次，独立统计目标交集、重复预测和空白负例页', async () => {
    const line = textLine('[1, 3] [1, 3] Eq. (5)');
    const pages = { 1: [line], 2: [textLine('[1, 3]', { pageNumber: 2 })] };
    const file = { reviewedPages: [1, 2], citations: [
      { pageNumber: 1, text: '[1, 3]', occurrence: 2, targetKeys: ['ref-3'] },
      { pageNumber: 1, text: 'Eq. (5)', targetKeys: ['eq-5'] },
    ] };
    const predictions = await detectCitations(annotationDoc(), pages);
    // 只覆盖第二处方括号里的数字。另一页以及第一处同名引用都不能顶替它。
    const digit = line.chars[11].rect;
    const partial = { ...predictions[1][1], rawText: '3', rect: { ...digit, width: digit.width / 3 } };
    predictions[1] = [predictions[1][0], partial, partial, { ...predictions[1][2], targetKeys: ['eq-4'] }];
    const labels = locateLabels(file, pages);
    expect(scoreCitations(file, labels, predictions)).toMatchObject({
      labeled: 2, predicted: 5, matched: 2, located: 1, precision: 2 / 5, recall: 1, targetAccuracy: 0.5,
      wrongTarget: [{ text: 'Eq. (5)', predictedKeys: ['eq-4'] }],
    });
    expect(scoreCitations(file, labels, { 1: [predictions[1][0]], 2: predictions[2] })).toMatchObject({
      matched: 0, located: 0, precision: 0, recall: 0, targetAccuracy: null,
    });
    expect(scoreCitations({ reviewedPages: [1], citations: [] }, [], {})).toMatchObject({
      predicted: 0, labeled: 0, precision: null, recall: null, targetAccuracy: null,
    });
  });

  it('在宽窄热区重叠时找到最大一对一匹配', async () => {
    const line = textLine('[1][2]');
    const pages = { 1: [line] };
    const narrow = (await detectCitations(annotationDoc(), pages))[1][0];
    const broad = { ...narrow, rect: line.rect, rawText: line.text, targetKeys: ['ref-2'] };
    const file = { reviewedPages: [1], citations: [
      { pageNumber: 1, text: '[1]', targetKeys: ['ref-1'] }, { pageNumber: 1, text: '[2]', targetKeys: ['ref-2'] },
    ] };
    expect(scoreCitations(file, locateLabels(file, pages), { 1: [broad, narrow] })).toMatchObject({ matched: 2, located: 2 });
  });

  it('支持跨行和上下文锚点，对歧义、标注重复和无效页码报错', () => {
    const pages = { 1: [textLine('See Table 1 or (Smith,'), textLine('2020). Table 1: Data', { y: 0.4 })] };
    const table = { pageNumber: 1, text: 'Table 1', targetKeys: ['tab-1'] };
    const locate = (citations: LabelsFile['citations']) => locateLabels({ reviewedPages: [1], citations }, pages);
    expect(locate([{ ...table, context: 'See Table 1' }])[0].glyphs[0]).toEqual(pages[1][0].chars[4]);
    const wrapped = locate([{ ...table, text: '(Smith, 2020)' }])[0].glyphs;
    expect(wrapped[wrapped.length - 1]).toEqual(pages[1][1].chars[4]);
    expect(() => locate([table])).toThrow('出现 2 次');
    expect(() => locate([{ ...table, text: 'Table 2' }])).toThrow('找不到');
    expect(() => locate(Array(2).fill({ ...table, occurrence: 1 }))).toThrow('重复标注');
    expect(() => locateLabels({ reviewedPages: [2], citations: [] }, pages)).toThrow('评测页');
  });
});
