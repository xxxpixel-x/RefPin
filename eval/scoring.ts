import type { InlineCitation, NormalizedRect } from '../src/types/paper';
import type { LinesByPage, TextChar } from '../src/engine/types';
import { readingOrder, rectIoU } from '../src/engine/utils';

export interface Label {
  pageNumber: number;
  text: string;
  targetKeys: string[];
  context?: string;
  occurrence?: number;
}

export interface LabelsFile {
  reviewedPages: number[];
  citations: Label[];
}

export interface Counts {
  predicted: number;
  labeled: number;
  matched: number;
  located: number;
}

/** 按实际字形锚定原文，使同页同名、图题和跨行引用都有确定的位置。 */
export function locateLabels(file: LabelsFile, linesByPage: LinesByPage) {
  const pages = new Map<number, { text: string; chars: TextChar[]; occupied: Set<number> }>();
  for (const page of file.reviewedPages) {
    if (!Number.isInteger(page) || page < 1 || !linesByPage[page] || pages.has(page)) {
      throw new Error(`无效或重复的评测页：${page}`);
    }
    const chars = readingOrder(linesByPage[page]).flatMap(line => line.chars.filter(c => !/\s/u.test(c.ch)));
    pages.set(page, { text: chars.map(c => c.ch).join(''), chars, occupied: new Set() });
  }
  if (!pages.size) throw new Error('请至少声明一个已完整标注的页面');
  return file.citations.map(label => {
    const page = pages.get(label.pageNumber);
    const query = label.text.replace(/\s/gu, '');
    if (!page || !query || !Array.isArray(label.targetKeys) || !label.targetKeys.length ||
        label.targetKeys.some(key => typeof key !== 'string' || !key.trim())) {
      throw new Error(`无效标注：${JSON.stringify(label)}`);
    }
    const context = label.context?.replace(/\s/gu, '') ?? query;
    const offset = context.indexOf(query);
    if (offset < 0 || context.lastIndexOf(query) !== offset) {
      throw new Error(`context 中须包含一次引用原文：${JSON.stringify(label)}`);
    }
    const starts: number[] = [];
    for (let i = page.text.indexOf(context); i !== -1; i = page.text.indexOf(context, i + 1)) starts.push(i + offset);
    if (starts.length > 1 && label.occurrence === undefined) {
      throw new Error(`第 ${label.pageNumber} 页「${label.text}」出现 ${starts.length} 次，请补 context 或 occurrence`);
    }
    const start = starts[(label.occurrence ?? 1) - 1];
    if (start === undefined) throw new Error(`第 ${label.pageNumber} 页找不到标注：${JSON.stringify(label)}`);
    for (let i = start; i < start + query.length; i++) {
      if (page.occupied.has(i)) throw new Error(`同一处原文被重复标注：${JSON.stringify(label)}`);
      page.occupied.add(i);
    }
    return { label, glyphs: page.chars.slice(start, start + query.length) };
  });
}

function coveredGlyphs(glyphs: TextChar[], rect: NormalizedRect) {
  // 容差仅排除相邻字形恰好接边时产生的浮点误差。
  return glyphs.filter(char => rectIoU(char.rect, rect) > 1e-12).length;
}

export function metrics({ predicted, labeled, matched, located }: Counts) {
  return {
    precision: predicted ? matched / predicted : null,
    recall: labeled ? matched / labeled : null,
    targetAccuracy: matched ? located / matched : null,
  };
}

export function scoreCitations(
  file: LabelsFile,
  labels: ReturnType<typeof locateLabels>,
  citations: Record<number, InlineCitation[]>,
) {
  const predictions = file.reviewedPages.flatMap(page => citations[page] ?? []);
  const candidates = labels.map(({ label, glyphs }) => predictions
    .map((p, index) => ({ index, overlap: p.pageNumber === label.pageNumber ? coveredGlyphs(glyphs, p.rect) : 0 }))
    .filter(hit => hit.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap));

  // 增广路确保每处最多计一次，宽热区和窄热区争用同一标注时仍能找到最大匹配。
  // 配对只看文本位置，避免用预期目标选配对后再评估定位正确率。
  const owners = new Map<number, number>();
  function assign(labelIndex: number, visited: Set<number>): boolean {
    for (const { index } of candidates[labelIndex]) {
      if (visited.has(index)) continue;
      visited.add(index);
      const previous = owners.get(index);
      if (previous === undefined || assign(previous, visited)) {
        owners.set(index, labelIndex);
        return true;
      }
    }
    return false;
  }
  labels.forEach((_, index) => assign(index, new Set()));
  const paired = new Set(owners.values());
  const missed = labels.filter((_, i) => !paired.has(i)).map(item => item.label);
  const extra = predictions.filter((_, i) => !owners.has(i)).map(({ pageNumber, rawText, targetKeys }) =>
    ({ pageNumber, text: rawText, targetKeys }));
  const wrongTarget = [];
  for (const [predictionIndex, labelIndex] of owners) {
    const { label } = labels[labelIndex];
    const { targetKeys } = predictions[predictionIndex];
    if (!label.targetKeys.some(key => targetKeys.includes(key))) {
      wrongTarget.push({ ...label, predictedKeys: targetKeys });
    }
  }
  const counts = { labeled: labels.length, predicted: predictions.length, matched: owners.size, located: owners.size - wrongTarget.length };
  return { ...counts, ...metrics(counts), missed, extra, wrongTarget };
}
