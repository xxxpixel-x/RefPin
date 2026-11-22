import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { NormalizedRect } from '../types/paper';
import type { TextChar, TextLine } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** 同一视觉行的基线容差（相对页高） */
const LINE_TOLERANCE = 0.007;
/** 超过该水平间距视为换栏 / 换块（相对页宽） */
const COLUMN_GAP = 0.018;
/** 双栏页里真正跨越中缝的最小间距（CJK 双栏中缝实测约 0.013） */
const MIDLINE_GAP = 0.012;

function getPublicAssetUrl(subpath: string): string {
  if (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.getURL === 'function'
  ) {
    return chrome.runtime.getURL(subpath);
  }
  return `/${subpath}`;
}

type PdfSource = ArrayBuffer | Uint8Array | string;

/** Hash the visible bytes of the input before pdf.js transfers them to its worker. */
export async function computePdfFingerprint(source: PdfSource, _fileName?: string): Promise<string> {
  let bytes: Uint8Array;
  if (typeof source === 'string') {
    bytes = new TextEncoder().encode(`url:${source}`);
  } else {
    bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const size = bytes.byteLength;
    if (size > 2 * 1024 * 1024) {
      const chunk = 512 * 1024;
      const middle = Math.floor((size - chunk) / 2);
      const sample = new Uint8Array(8 + 3 * chunk);
      new DataView(sample.buffer).setBigUint64(0, BigInt(size));
      sample.set(bytes.subarray(0, chunk), 8);
      sample.set(bytes.subarray(middle, middle + chunk), 8 + chunk);
      sample.set(bytes.subarray(size - chunk), 8 + 2 * chunk);
      bytes = sample;
    }
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadReaderPdf(source: PdfSource, fileName: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const paperHash = await computePdfFingerprint(source, fileName);
  const doc = await loadPdfDocument(source, signal);
  return { doc, paperHash };
}

export async function loadPdfDocument(
  source: PdfSource,
  signal?: AbortSignal,
): Promise<PDFDocumentProxy> {
  signal?.throwIfAborted();
  const task = pdfjsLib.getDocument({
    ...(typeof source === 'string' ? { url: source } : {
      data: source instanceof Uint8Array ? source : new Uint8Array(source),
    }),
    // 中文论文的 CMap 与标准字体全部走本地静态目录，保证断网与扩展环境均可离线运行
    cMapUrl: getPublicAssetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: getPublicAssetUrl('standard_fonts/'),
  });
  let onAbort: (() => void) | undefined;
  try {
    if (!signal) return await task.promise;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([task.promise, aborted]);
  } catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

interface RawBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

/**
 * 在行聚类之前先用原始 box 判断整页是否双栏。
 * 单栏页的正文 box 往往横跨中缝，不会被误判。
 */
function looksTwoColumn(boxes: RawBox[]): boolean {
  const left: RawBox[] = [];
  const right: RawBox[] = [];

  for (const box of boxes) {
    if (box.width < 0.18) continue;
    const rightEdge = box.x + box.width;
    if (rightEdge <= 0.51) {
      left.push(box);
    } else if (box.x >= 0.49) {
      right.push(box);
    }
  }

  if (left.length < 3 || right.length < 3) return false;

  // 每一栏的行需要共享稳定的左边界，排除单栏页右侧的零散行尾碎片
  const alignedCount = (boxes: RawBox[]) => {
    let best = 0;
    for (const candidate of boxes) {
      let count = 0;
      for (const box of boxes) {
        if (Math.abs(box.x - candidate.x) <= 0.03) count += 1;
      }
      if (count > best) best = count;
    }
    return best;
  };
  if (
    alignedCount(left) < Math.max(3, Math.ceil(left.length * 0.5)) ||
    alignedCount(right) < Math.max(3, Math.ceil(right.length * 0.5))
  ) {
    return false;
  }

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const gutter =
    median(right.map((box) => box.x)) -
    median(left.map((box) => box.x + box.width));
  if (gutter <= 0 || gutter > 0.08) return false;

  const leftTop = Math.min(...left.map((box) => box.y));
  const leftBottom = Math.max(...left.map((box) => box.y + box.height));
  const rightTop = Math.min(...right.map((box) => box.y));
  const rightBottom = Math.max(...right.map((box) => box.y + box.height));
  const overlap = Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop);
  if (overlap <= 0.15) return false;
  return overlap >= Math.min(leftBottom - leftTop, rightBottom - rightTop) * 0.35;
}

function toLine(boxes: RawBox[], pageNumber: number): TextLine | null {
  const chars: TextChar[] = [];
  let text = '';

  boxes.forEach((box, boxIndex) => {
    if (boxIndex > 0) {
      const prev = boxes[boxIndex - 1];
      const gap = box.x - (prev.x + prev.width);
      // A separately positioned superscript can have a small tracking gap
      // without having a word space before it.
      const raisedNumber = /^\d/.test(box.text) && gap < prev.height * 0.4 &&
        box.height < prev.height * 0.8 && box.baseline < prev.baseline - prev.height * 0.12;
      if (!raisedNumber && gap > 0.0015 && !text.endsWith(' ') && !box.text.startsWith(' ')) {
        const spaceRect: NormalizedRect = {
          x: prev.x + prev.width,
          y: box.y,
          width: Math.min(gap, 0.01),
          height: box.height,
        };
        text += ' ';
        chars.push({ ch: ' ', rect: spaceRect });
      }
    }

    const glyphs = Array.from(box.text);
    const charWidth = box.width / Math.max(1, glyphs.length);
    glyphs.forEach((ch, index) => {
      const rect: NormalizedRect = {
        x: box.x + index * charWidth,
        y: box.y,
        width: charWidth,
        height: box.height,
      };
      text += ch;
      // RegExp indices use UTF-16 offsets, even when a glyph is a surrogate pair.
      for (let i = 0; i < ch.length; i += 1) {
        chars.push({ ch: ch[i], rect, fontHeight: box.height, baselineY: box.baseline });
      }
    });
  });

  if (!text.trim() || chars.length === 0) return null;

  const first = chars[0].rect;
  let rect = first;
  for (const char of chars) {
    const right = Math.max(rect.x + rect.width, char.rect.x + char.rect.width);
    const bottom = Math.max(rect.y + rect.height, char.rect.y + char.rect.height);
    rect = {
      x: Math.min(rect.x, char.rect.x),
      y: Math.min(rect.y, char.rect.y),
      width: right - Math.min(rect.x, char.rect.x),
      height: bottom - Math.min(rect.y, char.rect.y),
    };
  }

  const centerX = rect.x + rect.width / 2;
  const column: TextLine['column'] =
    rect.width > 0.62 ? 'full' : centerX < 0.5 ? 'left' : 'right';

  return {
    pageNumber,
    text,
    rect,
    baseline: rect.y,
    column,
    chars,
  };
}

/**
 * 提取一页的视觉文本行。
 * 关键：pdf.js 会把 “Fig.” “2” “[” “14” “]” 拆成多个 TextItem，
 * 这里按基线聚类 + 大间距断栏 + 字符级矩形，保证正则能整段匹配。
 */
export async function extractPageLines(
  page: PDFPageProxy,
  pageNumber: number,
): Promise<TextLine[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const boxes: RawBox[] = [];

  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    const item = raw;
    if (!item.str || !item.str.trim()) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || item.height || 8;
    const left = tx[4];
    const baselineY = tx[5] / viewport.height;

    boxes.push({
      text: item.str,
      x: left / viewport.width,
      y: baselineY - fontHeight / viewport.height,
      width: (item.width * viewport.scale) / viewport.width,
      height: fontHeight / viewport.height,
      baseline: baselineY,
    });
  }

  if (boxes.length === 0) return [];

  // Group on glyph tops as before: raised small type can share a body line
  // even when its true baseline is well above that line's baseline.
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const twoColumnPage = looksTwoColumn(boxes);

  // 1) 按基线聚类成“同一视觉行”
  const groups: RawBox[][] = [];
  for (const box of boxes) {
    let placed = false;
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i];
      const diff = Math.abs(group[0].y - box.y);
      if (diff <= LINE_TOLERANCE) {
        group.push(box);
        placed = true;
        break;
      }
      if (group[0].y < box.y - LINE_TOLERANCE) break;
    }
    if (!placed) groups.push([box]);
  }

  // 2) 同一行内按水平大间距断成不同栏 / 文本块
  const lines: TextLine[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    let run: RawBox[] = [group[0]];

    const flush = () => {
      const line = toLine(run, pageNumber);
      if (line) lines.push(line);
    };

    for (let i = 1; i < group.length; i += 1) {
      const prev = group[i - 1];
      const current = group[i];
      const gap = current.x - (prev.x + prev.width);
      const threshold = Math.max(COLUMN_GAP, prev.height * 1.6);
      // 双栏页里左右两栏的窄中缝也可能小于常规阈值，必须强制断开
      const crossesMidline =
        twoColumnPage &&
        prev.x + prev.width < 0.5 &&
        current.x > 0.49 &&
        gap > MIDLINE_GAP;
      if (gap > threshold || crossesMidline) {
        flush();
        run = [current];
      } else {
        run.push(current);
      }
    }
    flush();
  }

  return lines.sort((a, b) => a.baseline - b.baseline || a.rect.x - b.rect.x);
}
