import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { CitationKind, InlineCitation, NormalizedRect } from '../types/paper';
import type { LinesByPage, TextLine } from './types';
import { clamp, rectDistance, rectForRange, rectIoU } from './utils';

interface RawMatch {
  kind: CitationKind;
  rawText: string;
  targetKeys: string[];
  rect: NormalizedRect;
}

const FIGURE_RE = /(?:\bFig(?:ure)?s?\.?\s*|图\s*)(\d+(?:[.\-–]\d+)?[a-zA-Z]?)/gi;
const TABLE_RE = /(?:\bTab(?:le)?s?\.?\s*|表\s*)(\d+(?:[.\-–]\d+)?[a-zA-Z]?)/gi;
const EQUATION_RE = /(?:\bEq(?:uation)?s?\.?\s*|公式\s*|式\s*)\(?\s*(\d+(?:\.\d+)?)\s*\)?/gi;
const REFERENCE_RE = /\[(\d+(?:\s*[-–,，]\s*\d+)*)\]/g;

const CAPTION_START_RE = /^(?:figure|fig\.?|table|tab\.?|图|表)\s*\d/i;
const REFERENCES_HEADING_RE = /^(?:references|bibliography|参考文献|references and notes)\s*$/i;

function normalizeNumber(raw: string): string {
  return raw.trim().toLowerCase().replace(/[–—]/g, '-');
}

function expandReferenceKeys(content: string): string[] {
  const numbers: number[] = [];
  for (const chunk of content.split(/[,，]/)) {
    const part = chunk.trim();
    if (!part) continue;
    const range = part.split(/[-–]/);
    if (range.length === 2) {
      const from = Number(range[0]);
      const to = Number(range[1]);
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from && to - from <= 30) {
        for (let n = from; n <= to; n += 1) numbers.push(n);
      }
    } else {
      numbers.push(Number(part));
    }
  }
  return Array.from(new Set(numbers))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 300)
    .map((n) => `ref-${n}`);
}

function collectMatches(line: TextLine): RawMatch[] {
  const matches: RawMatch[] = [];
  const text = line.text;
  const isCaption = CAPTION_START_RE.test(text.trim());

  const run = (
    re: RegExp,
    kind: CitationKind,
    toKeys: (captured: string, raw: string) => string[],
  ) => {
    re.lastIndex = 0;
    let hit: RegExpExecArray | null = re.exec(text);
    while (hit) {
      const start = hit.index;
      const end = start + hit[0].length;
      const rect = rectForRange(line, start, end);
      if (rect) {
        matches.push({
          kind,
          rawText: hit[0].trim(),
          targetKeys: toKeys(hit[1], hit[0]),
          rect,
        });
      }
      hit = re.exec(text);
    }
  };

  if (!isCaption) {
    run(FIGURE_RE, 'figure', (num) => [`fig-${normalizeNumber(num)}`]);
    run(TABLE_RE, 'table', (num) => [`tab-${normalizeNumber(num)}`]);
    run(EQUATION_RE, 'equation', (num) => [`eq-${normalizeNumber(num)}`]);
  }
  run(REFERENCE_RE, 'reference', (content) => expandReferenceKeys(content));

  return matches.sort((a, b) => a.rect.x - b.rect.x);
}

/** 路线二：纯文本层正则识别（Sioyek Smart Jump 思路） */
function detectFromText(
  linesByPage: LinesByPage,
  referencesStartPage: number | undefined,
): Record<number, InlineCitation[]> {
  const result: Record<number, InlineCitation[]> = {};

  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    const pageNumber = Number(pageKey);
    if (referencesStartPage && pageNumber >= referencesStartPage) continue;

    const citations: InlineCitation[] = [];
    for (const line of lines) {
      if (REFERENCES_HEADING_RE.test(line.text.trim())) continue;
      for (const match of collectMatches(line)) {
        citations.push({
          id: '',
          kind: match.kind,
          rawText: match.rawText,
          targetKeys: match.targetKeys,
          pageNumber,
          rect: match.rect,
          lineY: line.baseline,
        });
      }
    }
    result[pageNumber] = citations;
  }

  return result;
}

interface NativeTarget {
  pageNumber: number;
  targetY?: number;
}

async function resolveDestination(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<NativeTarget | null> {
  let resolved: unknown = dest;
  if (typeof dest === 'string') {
    resolved = await doc.getDestination(dest);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) return null;

  const pageRef = resolved[0] as unknown;
  let pageIndex: number | null = null;
  if (typeof pageRef === 'number') {
    pageIndex = pageRef;
  } else if (pageRef && typeof pageRef === 'object') {
    try {
      pageIndex = await doc.getPageIndex(
        pageRef as Parameters<PDFDocumentProxy['getPageIndex']>[0],
      );
    } catch {
      pageIndex = null;
    }
  }
  if (pageIndex === null || pageIndex < 0) return null;

  const pageNumber = pageIndex + 1;
  const fitName =
    resolved[1] && typeof resolved[1] === 'object'
      ? (resolved[1] as { name?: string }).name
      : undefined;

  let top: number | undefined;
  if (fitName === 'XYZ') top = (resolved[3] as number | undefined) ?? undefined;
  if (fitName === 'FitH' || fitName === 'FitBH') {
    top = (resolved[2] as number | undefined) ?? undefined;
  }

  if (typeof top !== 'number' || !Number.isFinite(top)) {
    return { pageNumber };
  }

  try {
    const targetPage = await doc.getPage(pageNumber);
    const viewport = targetPage.getViewport({ scale: 1 });
    return { pageNumber, targetY: clamp(1 - top / viewport.height, 0, 1) };
  } catch {
    return { pageNumber };
  }
}

/** 路线一：PDF 原生内部超链接（PDFRefPreview 思路） */
async function detectFromAnnotations(
  doc: PDFDocumentProxy,
  linesByPage: LinesByPage,
  referencesStartPage: number | undefined,
): Promise<Record<number, InlineCitation[]>> {
  const result: Record<number, InlineCitation[]> = {};
  const destCache = new Map<string, NativeTarget | null>();

  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    const pageNumber = Number(pageKey);
    if (referencesStartPage && pageNumber >= referencesStartPage) continue;

    const native: InlineCitation[] = [];
    try {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const annotations = await page.getAnnotations();

      for (const annot of annotations) {
        if (annot.subtype !== 'Link') continue;
        const dest = (annot as { dest?: unknown }).dest;
        if (!dest) continue;
        if ((annot as { url?: string }).url) continue;

        const viewRect = viewport.convertToViewportRectangle(annot.rect);
        const targetRect: NormalizedRect = {
          x: Math.min(viewRect[0], viewRect[2]) / viewport.width,
          y: Math.min(viewRect[1], viewRect[3]) / viewport.height,
          width: Math.abs(viewRect[2] - viewRect[0]) / viewport.width,
          height: Math.abs(viewRect[3] - viewRect[1]) / viewport.height,
        };

        const overlapping = lines.filter(
          (line) => rectIoU(line.rect, targetRect) > 0.05,
        );

        const hits: RawMatch[] = [];
        for (const line of overlapping) {
          for (const match of collectMatches(line)) {
            const centerX = match.rect.x + match.rect.width / 2;
            const centerY = match.rect.y + match.rect.height / 2;
            const inside =
              centerX >= targetRect.x - 0.006 &&
              centerX <= targetRect.x + targetRect.width + 0.006 &&
              centerY >= targetRect.y - 0.006 &&
              centerY <= targetRect.y + targetRect.height + 0.006;
            if (inside) hits.push(match);
          }
        }
        if (hits.length === 0) continue;

        const cacheKey = typeof dest === 'string' ? dest : JSON.stringify(dest);
        let target = destCache.get(cacheKey);
        if (target === undefined) {
          target = await resolveDestination(doc, dest).catch(() => null);
          destCache.set(cacheKey, target);
        }
        if (!target) continue;

        for (const hit of hits) {
          native.push({
            id: '',
            kind: hit.kind,
            rawText: hit.rawText,
            targetKeys: hit.targetKeys,
            pageNumber,
            rect: hit.rect,
            lineY: hit.rect.y,
            nativeDest: { pageNumber: target.pageNumber, targetY: target.targetY },
          });
        }
      }
    } catch {
      // 单页注释解析失败不影响整篇
    }

    result[pageNumber] = native;
  }

  return result;
}

export interface DetectCitationOptions {
  referencesStartPage?: number;
}

/**
 * 双路融合：
 * - 文本层正则 → 覆盖没有内部超链接的 Word / 中文论文
 * - 原生 Link 注释 → 覆盖 LaTeX 论文，拿到精准目标页与 Y 坐标
 * 同一位置命中则合并，保留文本层 rawText，并挂上 nativeDest。
 */
export async function detectCitations(
  doc: PDFDocumentProxy,
  linesByPage: LinesByPage,
  options: DetectCitationOptions = {},
): Promise<Record<number, InlineCitation[]>> {
  const textLayer = detectFromText(linesByPage, options.referencesStartPage);
  const nativeLayer = await detectFromAnnotations(
    doc,
    linesByPage,
    options.referencesStartPage,
  );

  const merged: Record<number, InlineCitation[]> = {};
  const allPages = new Set<number>([
    ...Object.keys(textLayer).map(Number),
    ...Object.keys(nativeLayer).map(Number),
  ]);

  for (const pageNumber of allPages) {
    const citations = [...(textLayer[pageNumber] ?? [])];

    for (const native of nativeLayer[pageNumber] ?? []) {
      const existing = citations.find(
        (item) =>
          rectIoU(item.rect, native.rect) > 0.4 ||
          rectDistance(item.rect, native.rect) < 0.02,
      );
      if (existing) {
        if (native.nativeDest) existing.nativeDest = native.nativeDest;
      } else {
        citations.push(native);
      }
    }

    citations.sort((a, b) => a.lineY - b.lineY || a.rect.x - b.rect.x);
    citations.forEach((citation, index) => {
      citation.id = `cite-${pageNumber}-${index}`;
    });
    merged[pageNumber] = citations;
  }

  return merged;
}
