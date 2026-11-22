import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPageLines } from '../engine/pdfLoader';
import type { TextLine } from '../engine/types';
import type { NormalizedRect } from '../types/paper';

export interface PdfParagraphBlock {
  id: string;
  pageNumber: number;
  text: string;
  rect: NormalizedRect;
  lineCount: number;
  isHeading: boolean;
  isCaption: boolean;
}

function mergeLinesToText(lines: TextLine[]): string {
  let acc = '';
  for (const line of lines) {
    const t = line.text.trim();
    if (!t) continue;
    if (!acc) {
      acc = t;
    } else if (/[A-Za-z]-$/.test(acc) && /^[a-z]/.test(t)) {
      acc = acc.slice(0, -1) + t;
    } else if (/[\u4e00-\u9fa5]$/.test(acc) && /^[\u4e00-\u9fa5]/.test(t)) {
      acc += t;
    } else {
      acc += ` ${t}`;
    }
  }
  return acc
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\u2212/g, '-')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unionRects(lines: TextLine[]): NormalizedRect {
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const l of lines) {
    left = Math.min(left, l.rect.x);
    top = Math.min(top, l.rect.y);
    right = Math.max(right, l.rect.x + l.rect.width);
    bottom = Math.max(bottom, l.rect.y + l.rect.height);
  }
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.min(1 - Math.max(0, left), Math.max(0.01, right - left)),
    height: Math.min(1 - Math.max(0, top), Math.max(0.01, bottom - top)),
  };
}

function looksLikePageNoise(text: string, y: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 3 && /^\d+$/.test(trimmed)) return true;
  if (y < 0.04 || y > 0.96) {
    if (trimmed.length < 52) return true;
  }
  return false;
}

function isHeadingText(text: string): boolean {
  if (text.length > 100) return false;
  return /^(?:\d+(?:\.\d+)*\.?\s+[A-Z\u4e00-\u9fa5]|Abstract|Introduction|Conclusion|Conclusions|Discussion|Related Work|Background|Method|Methodology|Experiments|Results|Evaluation|Limitations|Acknowledgments?|References|Appendix|摘要|引言|结论|参考文献)\b/i.test(
    text,
  );
}

function isCaptionText(text: string): boolean {
  return /^(?:Fig(?:ure)?\.?\s*\d|Tab(?:le)?\.?\s*\d|Algorithm\s*\d|图\s*\d|表\s*\d)/i.test(
    text,
  );
}

/**
 * 过滤插图内标注文字、纯数学公式行、数据表格行，避免原位译文盖住图表和公式。
 */
function shouldSkipBlockForOverlay(
  text: string,
  rect: NormalizedRect,
  lineCount: number,
  isHeading: boolean,
  isCaption: boolean,
  pageNumber: number,
): boolean {
  if (isCaption) return false;
  if (isHeading) return false;

  // 第 1 页顶部标题允许覆盖
  if (pageNumber === 1 && rect.y < 0.24 && text.length >= 16) return false;

  // 过短的孤立单行极可能是插图内部节点标签（如 "Multi-Head", "Add & Norm", "Nx"）或公式编号
  if (lineCount === 1 && text.length < 28) return true;
  if (rect.width < 0.16 && lineCount <= 2) return true;

  // 统计字母/汉字占比与数字占比，排除纯公式和纯数值表
  const nonSpace = text.replace(/\s+/g, '');
  if (nonSpace.length < 8) return true;

  const words = text.split(/\s+/).filter((w) => /[A-Za-z\u4e00-\u9fa5]{2,}/.test(w));
  const letters = (nonSpace.match(/[A-Za-z\u4e00-\u9fa5]/g) || []).length;
  const digits = (nonSpace.match(/\d/g) || []).length;
  const mathOps = (nonSpace.match(/[=<>+\-*/^_{}|∑∫∏√≈≠≤≥∈∀∃→←λθασβγμ]/g) || []).length;

  const letterRatio = letters / nonSpace.length;
  const digitRatio = digits / nonSpace.length;
  const mathRatio = mathOps / nonSpace.length;

  // 独立公式行（通常含等号/运算符比例高且英文单词少）
  if (lineCount <= 2 && (mathRatio > 0.14 || (letterRatio < 0.48 && words.length < 6))) {
    return true;
  }

  // 数据表格行（数字比例高）
  if (digitRatio > 0.3 && words.length < 8) return true;
  if (letterRatio < 0.42) return true;

  return false;
}

function groupColumnBlocks(
  lines: TextLine[],
  pageNumber: number,
  prefix: string,
): PdfParagraphBlock[] {
  const blocks: PdfParagraphBlock[] = [];
  if (lines.length === 0) return blocks;

  const sorted = [...lines].sort((a, b) => a.rect.y - b.rect.y);
  let bucket: TextLine[] = [];
  let idx = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const text = mergeLinesToText(bucket);
    const rect = unionRects(bucket);
    const lineCount = bucket.length;
    bucket = [];

    if (!text) return;
    const heading = isHeadingText(text) || (pageNumber === 1 && idx === 0 && rect.y < 0.18 && lineCount <= 3);
    const caption = isCaptionText(text);

    if (shouldSkipBlockForOverlay(text, rect, lineCount, heading, caption, pageNumber)) {
      return;
    }

    idx += 1;
    blocks.push({
      id: `p${pageNumber}-${prefix}-${idx}`,
      pageNumber,
      text,
      rect,
      lineCount,
      isHeading: heading,
      isCaption: caption,
    });
  };

  for (const line of sorted) {
    if (looksLikePageNoise(line.text, line.rect.y)) continue;

    if (bucket.length === 0) {
      bucket.push(line);
      continue;
    }

    const prev = bucket[bucket.length - 1];
    const avgHeight = Math.max(prev.rect.height, line.rect.height, 0.011);
    const gap = line.rect.y - (prev.rect.y + prev.rect.height);
    const lineText = line.text.trim();
    const prevText = prev.text.trim();

    // 段落断开判定：垂直间距拉大、字体高度显著变化、新标题/图注开头、首行缩进、或前一行明显提前结束
    const heightJump =
      Math.abs(line.rect.height - prev.rect.height) > Math.min(line.rect.height, prev.rect.height) * 0.32;
    const indentShift = line.rect.x - prev.rect.x > 0.016 && /[.!?。！？:]$/.test(prevText);
    const prevEndedShort =
      /[.!?。！？]$/.test(prevText) &&
      prev.rect.width < Math.max(line.rect.width, 0.32) * 0.72 &&
      gap > avgHeight * 0.28;
    const startsSpecial = isHeadingText(lineText) || isCaptionText(lineText);
    const prevWasSpecial = bucket.length === 1 && isHeadingText(prevText);
    const xDisjoint =
      line.rect.x > prev.rect.x + prev.rect.width + 0.02 ||
      prev.rect.x > line.rect.x + line.rect.width + 0.02;

    if (
      gap > avgHeight * 0.85 ||
      heightJump ||
      indentShift ||
      prevEndedShort ||
      startsSpecial ||
      prevWasSpecial ||
      xDisjoint
    ) {
      flush();
    }

    bucket.push(line);
  }

  flush();
  return blocks;
}

/**
 * 提取单页 PDF 可原位覆盖翻译的正文段落块（带精确归一化坐标），
 * 自动避开插图、表格与独立公式，保留原始论文版面。
 */
export async function extractPdfPageBlocks(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfParagraphBlock[]> {
  const page = await pdfDoc.getPage(pageNumber);
  const lines = await extractPageLines(page, pageNumber);
  if (lines.length === 0) return [];

  const leftLines = lines.filter((l) => l.column === 'left');
  const rightLines = lines.filter((l) => l.column === 'right');
  const fullLines = lines.filter((l) => l.column === 'full');

  const isTwoCol = leftLines.length >= 4 && rightLines.length >= 4;
  if (!isTwoCol) {
    return groupColumnBlocks(lines, pageNumber, 'all');
  }

  const colTop = Math.min(
    ...leftLines.map((l) => l.rect.y),
    ...rightLines.map((l) => l.rect.y),
  );
  const topFull = fullLines.filter((l) => l.rect.y < colTop + 0.01);
  const bottomFull = fullLines.filter((l) => l.rect.y >= colTop + 0.01);

  return [
    ...groupColumnBlocks(topFull, pageNumber, 'top'),
    ...groupColumnBlocks(leftLines, pageNumber, 'left'),
    ...groupColumnBlocks(rightLines, pageNumber, 'right'),
    ...groupColumnBlocks(bottomFull, pageNumber, 'bot'),
  ];
}
