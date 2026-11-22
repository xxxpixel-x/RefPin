import type { NormalizedRect } from '../types/paper';

/** 单个字符及其归一化矩形（用于把正则命中区间精确映射回页面坐标） */
export interface TextChar {
  ch: string;
  rect: NormalizedRect;
  /** Font size and true glyph baseline, both relative to the page height (y grows down). */
  fontHeight?: number;
  baselineY?: number;
}

/** 视觉文本行：把 pdf.js 拆碎的 TextItem 重新聚合成人能读的一行 */
export interface TextLine {
  pageNumber: number;
  text: string;
  rect: NormalizedRect;
  /** 行顶部的归一化 y（与 rect.y 一致，独立保留便于排序/闪行） */
  baseline: number;
  column: 'left' | 'right' | 'full';
  chars: TextChar[];
}

export type LinesByPage = Record<number, TextLine[]>;

/** 参考文献正文的精确区间（坐标均为相对页面的归一化值） */
export interface RefRange {
  startPage: number;
  startY: number;
  endPage: number;
  endY: number;
}
