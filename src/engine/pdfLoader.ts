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

export async function loadPdfDocument(
  source: string | ArrayBuffer,
): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({
    ...(typeof source === 'string' ? { url: source } : { data: source }),
    // 中文论文的 CMap 与标准字体全部走本地 public 目录，保证断网可用
    cMapUrl: '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/standard_fonts/',
  });
  return task.promise;
}

interface RawBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

function toLine(boxes: RawBox[], pageNumber: number): TextLine | null {
  const chars: TextChar[] = [];
  let text = '';

  boxes.forEach((box, boxIndex) => {
    if (boxIndex > 0) {
      const prev = boxes[boxIndex - 1];
      const gap = box.x - (prev.x + prev.width);
      if (gap > 0.0015 && !text.endsWith(' ') && !box.text.startsWith(' ')) {
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
      chars.push({ ch, rect });
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
    const baselineY = tx[5] - fontHeight;

    boxes.push({
      text: item.str,
      x: left / viewport.width,
      y: baselineY / viewport.height,
      width: (item.width * viewport.scale) / viewport.width,
      height: fontHeight / viewport.height,
      baseline: baselineY / viewport.height,
    });
  }

  if (boxes.length === 0) return [];

  boxes.sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  // 1) 按基线聚类成“同一视觉行”
  const groups: RawBox[][] = [];
  for (const box of boxes) {
    let placed = false;
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i];
      const diff = Math.abs(group[0].baseline - box.baseline);
      if (diff <= LINE_TOLERANCE) {
        group.push(box);
        placed = true;
        break;
      }
      if (group[0].baseline < box.baseline - LINE_TOLERANCE) break;
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
      if (gap > threshold) {
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
