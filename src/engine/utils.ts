import type { NormalizedRect } from '../types/paper';
import type { TextLine } from './types';

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

/** 两列论文的阅读顺序：先左栏从上到下，再右栏从上到下 */
export function readingOrder(lines: TextLine[]): TextLine[] {
  const hasRight = lines.some((line) => line.column === 'right');
  if (!hasRight) return [...lines].sort((a, b) => a.baseline - b.baseline);
  const left = lines.filter((l) => l.column === 'left').sort((a, b) => a.baseline - b.baseline);
  const full = lines.filter((l) => l.column === 'full').sort((a, b) => a.baseline - b.baseline);
  const right = lines.filter((l) => l.column === 'right').sort((a, b) => a.baseline - b.baseline);
  return [...left, ...full, ...right];
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
