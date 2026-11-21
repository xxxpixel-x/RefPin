import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { NormalizedRect, PaperAsset } from '../types/paper';
import type { LinesByPage, TextLine } from './types';
import { clamp, clampRect } from './utils';

/** 离屏渲染倍率：2.0 保证钉板与灯箱里的图足够清晰 */
const RENDER_SCALE = 2;
/** 连续纯白空白带达到该宽度即认为图表结束 */
const BLANK_BAND_PX = 22;
/** 至少积累这么高的内容才允许被空白带截停，避免把细线当边界 */
const MIN_CONTENT_HEIGHT_PX = 70;
/** 裁切四周保留的舒适内边距 */
const PAD_PX = 10;
const DARK_THRESHOLD = 244;
const MAX_CACHED_PAGES = 3;

interface PageBitmap {
  canvas: HTMLCanvasElement;
  image: ImageData;
  width: number;
  height: number;
}

const bitmapCache = new Map<number, PageBitmap>();

export function resetAssetCache() {
  bitmapCache.clear();
}

async function getPageBitmap(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageBitmap> {
  const cached = bitmapCache.get(pageNumber);
  if (cached) return cached;

  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建离屏 Canvas 上下文');

  await page.render({ canvasContext: ctx, viewport }).promise;
  const bitmap: PageBitmap = {
    canvas,
    image: ctx.getImageData(0, 0, canvas.width, canvas.height),
    width: canvas.width,
    height: canvas.height,
  };

  bitmapCache.set(pageNumber, bitmap);
  if (bitmapCache.size > MAX_CACHED_PAGES) {
    const oldest = bitmapCache.keys().next().value;
    if (oldest !== undefined) bitmapCache.delete(oldest);
  }
  return bitmap;
}

function pixelIsDark(image: ImageData, x: number, y: number): boolean {
  const i = (y * image.width + x) * 4;
  const data = image.data;
  return (
    data[i] < DARK_THRESHOLD ||
    data[i + 1] < DARK_THRESHOLD ||
    data[i + 2] < DARK_THRESHOLD
  );
}

function rowHasContent(
  bitmap: PageBitmap,
  y: number,
  x0: number,
  x1: number,
): boolean {
  let hits = 0;
  for (let x = Math.max(0, x0); x < Math.min(bitmap.width, x1); x += 2) {
    if (pixelIsDark(bitmap.image, x, y)) {
      hits += 1;
      if (hits >= 2) return true;
    }
  }
  return false;
}

function columnHasContent(
  bitmap: PageBitmap,
  x: number,
  y0: number,
  y1: number,
): boolean {
  let hits = 0;
  for (let y = Math.max(0, y0); y < Math.min(bitmap.height, y1); y += 2) {
    if (pixelIsDark(bitmap.image, x, y)) {
      hits += 1;
      if (hits >= 2) return true;
    }
  }
  return false;
}

/**
 * 从 fromY 向 toY 扫描内容带：
 * 先跳过图表与 caption 之间的空隙，再累积内容，
 * 遇到 ≥22px 纯白空白带（且内容高度 ≥70px）或到达边界时截停。
 */
function scanContentBand(
  bitmap: PageBitmap,
  x0: number,
  x1: number,
  fromY: number,
  toY: number,
): { top: number; bottom: number } | null {
  const step = toY >= fromY ? 1 : -1;
  const end = clamp(toY, 0, bitmap.height - 1);
  let y = clamp(fromY, 0, bitmap.height - 1);

  let first = -1;
  let last = -1;
  let blankRun = 0;

  while (step > 0 ? y <= end : y >= end) {
    if (rowHasContent(bitmap, y, x0, x1)) {
      if (first < 0) first = y;
      last = y;
      blankRun = 0;
    } else if (first >= 0) {
      blankRun += 1;
      if (
        blankRun >= BLANK_BAND_PX &&
        Math.abs(last - first) >= MIN_CONTENT_HEIGHT_PX
      ) {
        break;
      }
    }
    y += step;
  }

  if (first < 0) return null;
  return { top: Math.min(first, last), bottom: Math.max(first, last) };
}

function trimHorizontal(
  bitmap: PageBitmap,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { left: number; right: number } | null {
  let left = x1;
  let right = x0;
  for (let x = Math.max(0, x0); x < Math.min(bitmap.width, x1); x += 2) {
    if (columnHasContent(bitmap, x, y0, y1)) {
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return left <= right ? { left, right } : null;
}

function cropToDataUrl(
  bitmap: PageBitmap,
  pxX: number,
  pxY: number,
  pxW: number,
  pxH: number,
): string {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(pxW));
  out.height = Math.max(1, Math.round(pxH));
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(bitmap.canvas, pxX, pxY, pxW, pxH, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

interface CaptionInfo {
  key: string;
  kind: 'figure' | 'table';
  number: string;
  label: string;
  lines: TextLine[];
  text: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const CAPTION_RE =
  /^(Figure|Fig\.?|Table|Tab\.?|图|表)\s*(\d+(?:[.\-–]\d+)?[a-zA-Z]?)(.*)$/i;
const VERB_AFTER_NUMBER_RE =
  /^(shows?|illustrates?|presents?|depicts?|summarizes?|reports?|lists?|gives?|is|are|were|was)\b/i;

function normalizeNumber(raw: string): string {
  return raw.trim().toLowerCase().replace(/[–—]/g, '-');
}

function parseCaptionLine(line: TextLine): {
  kind: 'figure' | 'table';
  number: string;
  label: string;
} | null {
  const text = line.text.trim();
  const match = text.match(CAPTION_RE);
  if (!match) return null;

  const prefix = match[1];
  const number = match[2];
  const rest = match[3] ?? '';

  const isFigure = /^(?:图|fig)/i.test(prefix);
  // 正文里 "Figure 2 shows ..." 不是 caption，避免把段落当标题
  const restTrim = rest.trim();
  if (VERB_AFTER_NUMBER_RE.test(restTrim) && !/^[:：.．]/.test(restTrim)) {
    return null;
  }
  // 英文 caption 必须有分隔符或明显的描述文本
  if (/^(?:figure|fig\.?|table|tab\.?)/i.test(prefix)) {
    if (!/^[:：.．]/.test(restTrim) && restTrim.length < 8) return null;
  }

  return {
    kind: isFigure ? 'figure' : 'table',
    number,
    label: isFigure ? `Figure ${number}` : `Table ${number}`,
  };
}

function sameColumn(a: TextLine, b: TextLine): boolean {
  const aRight = a.rect.x + a.rect.width;
  const bRight = b.rect.x + b.rect.width;
  const overlap = Math.min(aRight, bRight) - Math.max(a.rect.x, b.rect.x);
  return overlap > Math.min(a.rect.width, b.rect.width) * 0.35;
}

/**
 * 判断一行是否像“正文段落”。
 * 图表内部的标签、表格单元格都是短行且不从栏位左边界开始，
 * 不能拿它们当裁切边界，否则 Table 1 会被表头行截断。
 */
function isParagraphLine(line: TextLine): boolean {
  if (line.rect.width < 0.22) return false;
  if (line.column === 'full') return true;
  const [colLeft] = columnRange(line);
  return Math.abs(line.rect.x - colLeft) < 0.09;
}

function columnRange(line: TextLine): [number, number] {
  if (line.rect.width > 0.62 || line.column === 'full') return [0.03, 0.97];
  // 居中、左右都留出明显边距的短标题（通栏图表的 caption）按通栏处理
  if (line.rect.x > 0.18 && line.rect.x + line.rect.width < 0.88 && line.rect.x < 0.35) {
    return [0.03, 0.97];
  }
  if (line.column === 'left') return [0.03, 0.48];
  return [0.51, 0.97];
}

function collectCaptions(
  linesByPage: LinesByPage,
  referencesStartPage?: number,
): CaptionInfo[] {
  const captions: CaptionInfo[] = [];
  const seen = new Set<string>();

  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    const pageNumber = Number(pageKey);
    if (referencesStartPage && pageNumber >= referencesStartPage) continue;

    const ordered = [...lines].sort((a, b) => a.baseline - b.baseline);
    const captionLineSet = new Set<TextLine>();

    for (let i = 0; i < ordered.length; i += 1) {
      const line = ordered[i];
      const parsed = parseCaptionLine(line);
      if (!parsed) continue;
      if (captionLineSet.has(line)) continue;

      const key =
        parsed.kind === 'figure'
          ? `fig-${normalizeNumber(parsed.number)}`
          : `tab-${normalizeNumber(parsed.number)}`;
      if (seen.has(key)) continue;

      // 合并 caption 描述行（长 caption 可能跨 4 行）
      const group: TextLine[] = [line];
      let cursor = i + 1;
      while (cursor < ordered.length && group.length < 5) {
        const next = ordered[cursor];
        const prev = group[group.length - 1];
        const gap = next.rect.y - (prev.rect.y + prev.rect.height);
        if (
          gap < -0.002 ||
          gap > 0.016 ||
          Math.abs(next.rect.x - line.rect.x) > 0.03 ||
          !sameColumn(prev, next) ||
          parseCaptionLine(next)
        ) {
          break;
        }
        group.push(next);
        cursor += 1;
      }
      group.forEach((item) => captionLineSet.add(item));

      const top = Math.min(...group.map((item) => item.rect.y));
      const bottom = Math.max(...group.map((item) => item.rect.y + item.rect.height));
      const bars = group.map((item) => columnRange(item));
      const left = Math.min(...bars.map((bar) => bar[0]));
      const right = Math.max(...bars.map((bar) => bar[1]));

      captions.push({
        key,
        kind: parsed.kind,
        number: parsed.number,
        label: parsed.label,
        lines: group,
        text: group.map((item) => item.text.trim()).join(' '),
        top,
        bottom,
        left,
        right,
      });
      seen.add(key);
    }
  }

  return captions;
}

export interface ExtractAssetsOptions {
  referencesStartPage?: number;
  onProgress?: (percent: number) => void;
}

export async function extractAssets(
  doc: PDFDocumentProxy,
  linesByPage: LinesByPage,
  options: ExtractAssetsOptions = {},
): Promise<Record<string, PaperAsset>> {
  const assets: Record<string, PaperAsset> = {};
  const captions = collectCaptions(linesByPage, options.referencesStartPage);

  // 公式行的候选（(1) / （3）独立成行，且位于栏位右半侧）
  const equationCandidates: Array<{ line: TextLine; number: string }> = [];
  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    const pageNumber = Number(pageKey);
    if (options.referencesStartPage && pageNumber >= options.referencesStartPage) continue;
    for (const line of lines) {
      const hit = line.text.trim().match(/^[(（](\d{1,3})[)）]$/);
      if (!hit) continue;
      const [colLeft, colRight] = columnRange(line);
      const center = line.rect.x + line.rect.width / 2;
      if (center > (colLeft + colRight) / 2) {
        equationCandidates.push({ line, number: hit[1] });
      }
    }
  }

  const total = captions.length + equationCandidates.length;
  let done = 0;
  const report = () => {
    done += 1;
    if (total > 0) options.onProgress?.((done / total) * 100);
  };

  for (const caption of captions) {
    try {
      const pageNumber = caption.lines[0].pageNumber;
      const bitmap = await getPageBitmap(doc, pageNumber);

      const captionLines = new Set(caption.lines);
      const pageLines = linesByPage[pageNumber] ?? [];
      const above = pageLines
        .filter(
          (line) =>
            !captionLines.has(line) &&
            isParagraphLine(line) &&
            sameColumn(line, caption.lines[0]) &&
            line.rect.y + line.rect.height <= caption.top - 0.002,
        )
        .sort((a, b) => b.rect.y + b.rect.height - (a.rect.y + a.rect.height))[0];
      const below = pageLines
        .filter(
          (line) =>
            !captionLines.has(line) &&
            isParagraphLine(line) &&
            sameColumn(line, caption.lines[0]) &&
            line.rect.y >= caption.bottom + 0.002,
        )
        .sort((a, b) => a.rect.y - b.rect.y)[0];

      const limitTop = above
        ? Math.min(0.99, above.rect.y + above.rect.height + 0.006)
        : 0.02;
      const limitBottom = below ? Math.max(0.01, below.rect.y - 0.006) : 0.98;

      const x0 = Math.floor(caption.left * bitmap.width);
      const x1 = Math.ceil(caption.right * bitmap.width);
      const captionTopPx = Math.floor(caption.top * bitmap.height);
      const captionBottomPx = Math.ceil(caption.bottom * bitmap.height);

      let band: { top: number; bottom: number } | null = null;
      if (caption.kind === 'figure') {
        band = scanContentBand(
          bitmap,
          x0,
          x1,
          captionTopPx - 4,
          Math.floor(limitTop * bitmap.height),
        );
        if (!band) {
          band = scanContentBand(
            bitmap,
            x0,
            x1,
            captionBottomPx + 4,
            Math.ceil(limitBottom * bitmap.height),
          );
        }
      } else {
        band = scanContentBand(
          bitmap,
          x0,
          x1,
          captionBottomPx + 4,
          Math.ceil(limitBottom * bitmap.height),
        );
        if (!band) {
          band = scanContentBand(
            bitmap,
            x0,
            x1,
            captionTopPx - 4,
            Math.floor(limitTop * bitmap.height),
          );
        }
      }

      if (!band) {
        report();
        continue;
      }

      let y0 = band.top;
      let y1 = band.bottom;
      // 不要越过 caption 本身
      if (caption.kind === 'figure') y1 = Math.min(y1, captionTopPx - 2);
      else y0 = Math.max(y0, captionBottomPx + 2);

      const horizontal = trimHorizontal(bitmap, x0, x1, y0, y1);
      const left = Math.max(0, (horizontal?.left ?? x0) - PAD_PX);
      const right = Math.min(bitmap.width, (horizontal?.right ?? x1) + PAD_PX);
      const top = Math.max(0, y0 - PAD_PX);
      const bottom = Math.min(bitmap.height, y1 + PAD_PX);

      const width = right - left;
      const height = bottom - top;
      if (width < 40 || height < 30) {
        report();
        continue;
      }

      assets[caption.key] = {
        key: caption.key,
        kind: caption.kind,
        label: caption.label,
        caption: caption.text,
        pageNumber,
        cropRect: clampRect({
          x: left / bitmap.width,
          y: top / bitmap.height,
          width: width / bitmap.width,
          height: height / bitmap.height,
        }),
        imageUrl: cropToDataUrl(bitmap, left, top, width, height),
      };
    } catch {
      // 单张图失败不影响整篇
    }
    report();
  }

  for (const candidate of equationCandidates) {
    const key = `eq-${normalizeNumber(candidate.number)}`;
    if (assets[key]) {
      report();
      continue;
    }
    try {
      const pageNumber = candidate.line.pageNumber;
      const bitmap = await getPageBitmap(doc, pageNumber);
      const [colLeft, colRight] = columnRange(candidate.line);

      const y0 = Math.max(0, candidate.line.rect.y - 0.03);
      const y1 = Math.min(1, candidate.line.rect.y + candidate.line.rect.height + 0.03);
      const pxY0 = Math.floor(y0 * bitmap.height);
      const pxY1 = Math.ceil(y1 * bitmap.height);
      const pxX0 = Math.floor(colLeft * bitmap.width);
      const pxX1 = Math.ceil(colRight * bitmap.width);

      const horizontal = trimHorizontal(bitmap, pxX0, pxX1, pxY0, pxY1);
      if (!horizontal) {
        report();
        continue;
      }

      const left = Math.max(0, horizontal.left - PAD_PX);
      const right = Math.min(bitmap.width, horizontal.right + PAD_PX);
      const top = Math.max(0, pxY0 - PAD_PX);
      const bottom = Math.min(bitmap.height, pxY1 + PAD_PX);
      const width = right - left;
      const height = bottom - top;
      if (width < 40 || height < 20) {
        report();
        continue;
      }

      assets[key] = {
        key,
        kind: 'equation',
        label: `Eq. (${candidate.number})`,
        caption: candidate.line.text.trim(),
        pageNumber,
        cropRect: clampRect({
          x: left / bitmap.width,
          y: top / bitmap.height,
          width: width / bitmap.width,
          height: height / bitmap.height,
        }),
        imageUrl: cropToDataUrl(bitmap, left, top, width, height),
      };
    } catch {
      // ignore
    }
    report();
  }

  return assets;
}

/** 原生链接兜底：按目标 Y 截取该页上下约 32% 页面高度 */
export async function captureDestinationPreview(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetY?: number,
): Promise<{ cropRect: NormalizedRect; imageUrl: string }> {
  const bitmap = await getPageBitmap(doc, pageNumber);
  const height = 0.32;
  const anchor = clamp(targetY ?? 0.2, 0, 1);
  const y = clamp(anchor - height / 2, 0.01, Math.max(0.01, 1 - height - 0.01));
  const cropRect: NormalizedRect = { x: 0.03, y, width: 0.94, height };
  const imageUrl = cropToDataUrl(
    bitmap,
    Math.floor(cropRect.x * bitmap.width),
    Math.floor(cropRect.y * bitmap.height),
    Math.floor(cropRect.width * bitmap.width),
    Math.floor(cropRect.height * bitmap.height),
  );
  return { cropRect, imageUrl };
}

/** 自由框选 / 手动微调后重新生成高清截图 */
export async function recropPageRegion(
  doc: PDFDocumentProxy,
  pageNumber: number,
  rect: NormalizedRect,
): Promise<string> {
  const bitmap = await getPageBitmap(doc, pageNumber);
  const safe = clampRect(rect);
  return cropToDataUrl(
    bitmap,
    Math.floor(safe.x * bitmap.width),
    Math.floor(safe.y * bitmap.height),
    Math.max(1, Math.floor(safe.width * bitmap.width)),
    Math.max(1, Math.floor(safe.height * bitmap.height)),
  );
}
