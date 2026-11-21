import type { NormalizedRect } from '../types/paper';
import type { RefRange, TextLine } from './types';

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function clampRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp(rect.x, 0, 1);
  const y = clamp(rect.y, 0, 1);
  return {
    x,
    y,
    width: clamp(rect.width, 0, 1 - x),
    height: clamp(rect.height, 0, 1 - y),
  };
}

export function unionRect(a: NormalizedRect, b: NormalizedRect): NormalizedRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** 两个矩形的交并比 */
export function rectIoU(a: NormalizedRect, b: NormalizedRect): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, right - x) * Math.max(0, bottom - y);
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function centerOf(rect: NormalizedRect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectDistance(a: NormalizedRect, b: NormalizedRect): number {
  const ca = centerOf(a);
  const cb = centerOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/** 构成“真正栏行”的最小行数，低于该数量的零散短行不算双栏证据 */
const MIN_COLUMN_LINES = 3;
/** 真正双栏的中缝宽度上限；超过说明只是行尾碎片而非两栏 */
const MAX_GUTTER = 0.08;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
/** 同一栏的行应大致共享左边界，避免把单栏页的右侧行尾碎片当成一栏 */
const COLUMN_EDGE_TOLERANCE = 0.03;

function alignedColumnCount(lines: TextLine[]): number {
  let best = 0;
  for (const candidate of lines) {
    let count = 0;
    for (const line of lines) {
      if (Math.abs(line.rect.x - candidate.rect.x) <= COLUMN_EDGE_TOLERANCE) count += 1;
    }
    if (count > best) best = count;
  }
  return best;
}

/** 一行是否属于通栏内容（长行或明显居中的短标题） */
function isFullWidthLine(line: TextLine): boolean {
  if (line.rect.width > 0.62 || line.column === 'full') return true;
  const center = line.rect.x + line.rect.width / 2;
  return (
    Math.abs(center - 0.5) < 0.1 &&
    line.rect.x >= 0.12 &&
    line.rect.x + line.rect.width <= 0.88
  );
}

/**
 * 判断一页是否真的是双栏排版。
 * 单栏论文里也会有被拆短的行（比如表格单元、行尾断句），
 * 只有同时存在足够多“贴着左右栏边界”的长行、且两栏在纵向上大幅重叠时才算双栏。
 */
export function isTwoColumnPage(lines: TextLine[]): boolean {
  const left: TextLine[] = [];
  const right: TextLine[] = [];

  for (const line of lines) {
    if (line.rect.width < 0.18) continue;
    const rightEdge = line.rect.x + line.rect.width;
    if (rightEdge <= 0.51) {
      left.push(line);
    } else if (line.rect.x >= 0.49) {
      right.push(line);
    }
  }

  if (left.length < MIN_COLUMN_LINES || right.length < MIN_COLUMN_LINES) {
    return false;
  }
  // 双栏页每一栏的行会共享稳定的栏位左边界；单栏页的短行只是零散行尾
  if (
    alignedColumnCount(left) < Math.max(MIN_COLUMN_LINES, Math.ceil(left.length * 0.5)) ||
    alignedColumnCount(right) < Math.max(MIN_COLUMN_LINES, Math.ceil(right.length * 0.5))
  ) {
    return false;
  }

  // 单栏页的行尾碎片可能分别落在中线两侧，但它们的“中缝”很宽
  const gutter =
    median(right.map((line) => line.rect.x)) -
    median(left.map((line) => line.rect.x + line.rect.width));
  if (gutter <= 0 || gutter > MAX_GUTTER) return false;

  const leftTop = Math.min(...left.map((line) => line.rect.y));
  const leftBottom = Math.max(...left.map((line) => line.rect.y + line.rect.height));
  const rightTop = Math.min(...right.map((line) => line.rect.y));
  const rightBottom = Math.max(...right.map((line) => line.rect.y + line.rect.height));

  const overlap = Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop);
  if (overlap <= 0.15) return false;
  return overlap >= Math.min(leftBottom - leftTop, rightBottom - rightTop) * 0.35;
}

/**
 * 阅读顺序：
 * - 单栏页严格按基线（同基线按 x）排序，绝不拆成 left/full/right；
 * - 双栏页先左栏再右栏，通栏标题/摘要按 Y 位置自然穿插。
 */
export function readingOrder(lines: TextLine[]): TextLine[] {
  const byPosition = (a: TextLine, b: TextLine) =>
    a.baseline - b.baseline || a.rect.x - b.rect.x;

  if (!isTwoColumnPage(lines)) {
    return [...lines].sort(byPosition);
  }

  const full = lines.filter(isFullWidthLine).sort(byPosition);
  const left = lines.filter((line) => !isFullWidthLine(line) && line.column !== 'right').sort(byPosition);
  const right = lines.filter((line) => !isFullWidthLine(line) && line.column === 'right').sort(byPosition);

  const ordered: TextLine[] = [];
  const appendBand = (top: number, bottom: number) => {
    ordered.push(
      ...left.filter((line) => line.baseline >= top && line.baseline < bottom),
      ...right.filter((line) => line.baseline >= top && line.baseline < bottom),
    );
  };

  let bandTop = -Infinity;
  for (const line of full) {
    appendBand(bandTop, line.baseline);
    ordered.push(line);
    bandTop = line.rect.y + line.rect.height;
  }
  appendBand(bandTop, Infinity);

  return ordered;
}

/** 判断一个行位置是否落在参考文献正文区间内（区间外一律放行） */
export function isInsideRefRange(
  pageNumber: number,
  y: number,
  refRange?: RefRange,
): boolean {
  if (!refRange) return false;
  if (pageNumber < refRange.startPage || pageNumber > refRange.endPage) return false;
  if (refRange.startPage === refRange.endPage) {
    return y >= refRange.startY && y <= refRange.endY;
  }
  if (pageNumber === refRange.startPage) return y >= refRange.startY;
  if (pageNumber === refRange.endPage) return y <= refRange.endY;
  return true;
}

export function normalizeKeyNumber(raw: string): string {
  return raw.trim().toLowerCase().replace(/[–—]/g, '-');
}

/** 正文里真正的引用命中，落到字符级矩形 */
export function rectForRange(
  line: TextLine,
  start: number,
  end: number,
): NormalizedRect | null {
  if (start < 0 || end > line.chars.length || start >= end) return null;
  let rect = line.chars[start].rect;
  for (let i = start + 1; i < end; i += 1) {
    rect = unionRect(rect, line.chars[i].rect);
  }
  return rect;
}
