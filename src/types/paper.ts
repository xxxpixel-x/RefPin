/**
 * RefPin 共享数据结构契约（成员 A 初始化，双方只读）
 */

export type CitationKind = 'figure' | 'table' | 'equation' | 'reference';

/** 相对页面左上角的归一化坐标（0~1） */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 正文中的一处引用热区，例如 “Fig. 2”、"[14]" */
export interface InlineCitation {
  id: string;
  kind: CitationKind;
  rawText: string;
  targetKeys: string[];
  pageNumber: number;
  rect: NormalizedRect;
  /** 所在视觉行的基线（归一化 y），用于定位闪行 */
  lineY: number;
  /** PDF 自带内部超链接解析出的目标位置（LaTeX 论文常见） */
  nativeDest?: { pageNumber: number; targetY?: number };
}

/** 从图表或文献卡片跳回正文中的一次引用 */
export interface CitationBacklink {
  citationId: string;
  pageNumber: number;
  rect: NormalizedRect;
  rawText: string;
}

/** 论文中的一张图 / 一个表 / 一条公式 */
export interface PaperAsset {
  key: string;
  kind: 'figure' | 'table' | 'equation';
  label: string;
  caption: string;
  pageNumber: number;
  cropRect: NormalizedRect;
  imageUrl?: string;
}

/** 参考文献条目 */
export interface ReferenceEntry {
  key: string;
  index: number;
  rawText: string;
  title?: string;
  authors?: string;
  year?: string;
  pageNumber: number;
}

/** 钉板停靠位置 */
export type DockPosition = 'right' | 'left' | 'top' | 'bottom';

/** 对照钉板中的一项 */
export interface PinnedItem {
  id: string;
  kind: CitationKind | 'snip';
  title: string;
  subtitle?: string;
  pageNumber: number;
  imageUrl?: string;
  cropRect?: NormalizedRect;
  /** 首次钉住时的初始裁切区域，用于上扩/下扩后一键还原 */
  originalCropRect?: NormalizedRect;
  /** 首次钉住时的初始裁切图，用于瞬时还原 */
  originalImageUrl?: string;
  reference?: ReferenceEntry;
  collapsed?: boolean;
  createdAt: number;
}

/** 跳页前保存的“回来”锚点 */
export type JumpAnchor = {
  fromPage: number;
  fromScrollTop: number;
  fromScrollLeft?: number;
  highlightRect?: NormalizedRect;
  label: string;
} | null;

export interface ReadingStats {
  savedFlips: number;
  savedScrollPx: number;
  peekCount: number;
  pinCount: number;
}

export interface SamplePaperMeta {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  demoStartPage: number;
  badge: string;
}
