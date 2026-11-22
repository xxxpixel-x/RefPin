import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { CitationKind, InlineCitation, NormalizedRect } from '../types/paper';
import type { LinesByPage, RefRange, TextLine } from './types';
import { parseCaptionLabel } from './captionLabel';
import {
  clamp,
  isInsideRefRange,
  rectDistance,
  rectForRange,
  rectIoU,
} from './utils';

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

const REFERENCES_HEADING_RE = /^(?:references|bibliography|参考文献|references and notes)\s*$/i;

function rectArea(rect: NormalizedRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function overlapArea(a: NormalizedRect, b: NormalizedRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * 链接框通常只框住 [13] 里的数字或 Figure 2 里的 2，
 * 因此不能拿整行宽度做 IoU 分母；改为看链接框被行覆盖的比例。
 */
function linkHitsLine(lineRect: NormalizedRect, targetRect: NormalizedRect): boolean {
  const targetArea = Math.max(1e-6, rectArea(targetRect));
  if (overlapArea(lineRect, targetRect) / targetArea > 0.3) return true;

  const vertical =
    Math.min(lineRect.y + lineRect.height, targetRect.y + targetRect.height) -
    Math.max(lineRect.y, targetRect.y);
  const horizontal =
    Math.min(lineRect.x + lineRect.width, targetRect.x + targetRect.width) -
    Math.max(lineRect.x, targetRect.x);
  return vertical > 0 && horizontal > 0;
}

/** match.rect 与链接框只要有交叠（容差 0.005）就算命中 */
function matchHitsTarget(matchRect: NormalizedRect, targetRect: NormalizedRect): boolean {
  const tolerance = 0.005;
  const expanded: NormalizedRect = {
    x: targetRect.x - tolerance,
    y: targetRect.y - tolerance,
    width: targetRect.width + tolerance * 2,
    height: targetRect.height + tolerance * 2,
  };
  return overlapArea(matchRect, expanded) > 0;
}

const NAMED_DEST_RE =
  /(?:^|[./:_\-])(subsection|section|figure|fig|table|tab|equation|eq)[._:\-]?(\d+(?:\.\d+)*)/i;
const BOX_TEXT_RE =
  /(?:figure|fig\.?|table|tab\.?|equation|eq\.?|图|表|公式)\s*(\d+(?:[.\-–]\d+)?[a-zA-Z]?)/i;

function inferFromDestName(
  name: string | undefined,
): { kind: CitationKind; targetKeys: string[]; label: string } | null {
  if (!name) return null;
  const hit = name.match(NAMED_DEST_RE);
  if (!hit) return null;

  const family = hit[1].toLowerCase();
  const number = hit[2].toLowerCase();
  if (family.startsWith('fig')) {
    return { kind: 'figure', targetKeys: [`fig-${number}`], label: `Figure ${number}` };
  }
  if (family.startsWith('tab')) {
    return { kind: 'table', targetKeys: [`tab-${number}`], label: `Table ${number}` };
  }
  if (family === 'equation' || family === 'eq') {
    return { kind: 'equation', targetKeys: [`eq-${number}`], label: `Eq. (${number})` };
  }
  // 章节链接没有对应的 PaperAsset，只保留 nativeDest 供目标页兜底预览
  return { kind: 'reference', targetKeys: [], label: `Section ${number}` };
}

function inferFromBoxText(
  text: string,
): { kind: CitationKind; targetKeys: string[]; label: string } | null {
  const hit = text.match(BOX_TEXT_RE);
  if (!hit) return null;
  const prefix = hit[0].trim().toLowerCase();
  const number = hit[1].toLowerCase();
  if (prefix.startsWith('fig') || prefix.startsWith('图')) {
    return { kind: 'figure', targetKeys: [`fig-${number}`], label: `Figure ${number}` };
  }
  if (prefix.startsWith('tab') || prefix.startsWith('表')) {
    return { kind: 'table', targetKeys: [`tab-${number}`], label: `Table ${number}` };
  }
  return { kind: 'equation', targetKeys: [`eq-${number}`], label: `Eq. (${number})` };
}

function destName(dest: unknown): string | undefined {
  if (typeof dest === 'string') return dest;
  if (Array.isArray(dest)) {
    const first = dest[0] as unknown;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'name' in first) {
      const name = (first as { name?: unknown }).name;
      return typeof name === 'string' ? name : undefined;
    }
  }
  return undefined;
}

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
  const trimmed = text.trim();
  const isCaption = parseCaptionLabel(trimmed) !== null;

  const run = (
    re: RegExp,
    kind: CitationKind,
    toKeys: (captured: string, raw: string) => string[],
  ) => {
    re.lastIndex = 0;
    let hit: RegExpExecArray | null = re.exec(text);
    while (hit) {
      const start = hit.index;
      const rawText = hit[0].trimEnd();
      const end = start + rawText.length;
      if (isCaption && start === text.indexOf(trimmed) && rawText !== trimmed) {
        hit = re.exec(text);
        continue;
      }
      const targetKeys = toKeys(hit[1], hit[0]);
      // 年份 [2024] 等超出文献编号范围的内容不生成死链接热区
      if (targetKeys.length === 0) {
        hit = re.exec(text);
        continue;
      }
      const rect = rectForRange(line, start, end);
      if (rect) {
        matches.push({
          kind,
          rawText,
          targetKeys,
          rect,
        });
      }
      hit = re.exec(text);
    }
  };

  run(FIGURE_RE, 'figure', (num) => [`fig-${normalizeNumber(num)}`]);
  run(TABLE_RE, 'table', (num) => [`tab-${normalizeNumber(num)}`]);
  run(EQUATION_RE, 'equation', (num) => [`eq-${normalizeNumber(num)}`]);
  run(REFERENCE_RE, 'reference', (content) => expandReferenceKeys(content));

  return matches.sort((a, b) => a.rect.x - b.rect.x);
}

/** 路线二：纯文本层正则识别（Sioyek Smart Jump 思路） */
function detectFromText(
  linesByPage: LinesByPage,
  refRange: RefRange | undefined,
  signal?: AbortSignal,
): Record<number, InlineCitation[]> {
  const result: Record<number, InlineCitation[]> = {};

  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    signal?.throwIfAborted();
    const pageNumber = Number(pageKey);

    const citations: InlineCitation[] = [];
    for (const line of lines) {
      if (REFERENCES_HEADING_RE.test(line.text.trim())) continue;
      if (isInsideRefRange(pageNumber, line.rect.y + line.rect.height / 2, refRange)) {
        continue;
      }
      for (const match of collectMatches(line)) {
        // Some PDFs paint the same text twice at the same position.
        if (citations.some((item) =>
          item.rawText === match.rawText && rectIoU(item.rect, match.rect) > 0.6,
        )) continue;
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

/** 收集链接框内实际覆盖的字符文本与矩形 */
function collectBoxText(
  lines: TextLine[],
  targetRect: NormalizedRect,
): { text: string; rect: NormalizedRect | null } {
  const tolerance = 0.004;
  let text = '';
  let rect: NormalizedRect | null = null;

  for (const line of lines) {
    for (const char of line.chars) {
      const expanded: NormalizedRect = {
        x: char.rect.x - tolerance,
        y: char.rect.y - tolerance,
        width: char.rect.width + tolerance * 2,
        height: char.rect.height + tolerance * 2,
      };
      if (overlapArea(expanded, targetRect) <= 0) continue;
      text += char.ch;
      if (!rect) {
        rect = char.rect;
      } else {
        const right = Math.max(rect.x + rect.width, char.rect.x + char.rect.width);
        const bottom = Math.max(rect.y + rect.height, char.rect.y + char.rect.height);
        rect = {
          x: Math.min(rect.x, char.rect.x),
          y: Math.min(rect.y, char.rect.y),
          width: right - Math.min(rect.x, char.rect.x),
          height: bottom - Math.min(rect.y, char.rect.y),
        };
      }
    }
  }

  return { text: text.trim(), rect };
}

/** 路线一：PDF 原生内部超链接（PDFRefPreview 思路） */
async function detectFromAnnotations(
  doc: PDFDocumentProxy,
  linesByPage: LinesByPage,
  refRange: RefRange | undefined,
  signal?: AbortSignal,
): Promise<Record<number, InlineCitation[]>> {
  const result: Record<number, InlineCitation[]> = {};
  const destCache = new Map<string, NativeTarget | null>();

  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    signal?.throwIfAborted();
    const pageNumber = Number(pageKey);
    // 只排除真正落在参考文献正文里的行，起始页上方的图表和附录页照常识别
    const usableLines = lines.filter(
      (line) =>
        !isInsideRefRange(pageNumber, line.rect.y + line.rect.height / 2, refRange),
    );

    const native: InlineCitation[] = [];
    try {
      const page = await doc.getPage(pageNumber);
      signal?.throwIfAborted();
      const viewport = page.getViewport({ scale: 1 });
      const annotations = await page.getAnnotations();

      for (const annot of annotations) {
        signal?.throwIfAborted();
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
        if (isInsideRefRange(pageNumber, targetRect.y + targetRect.height / 2, refRange)) continue;

        const overlapping = usableLines.filter((line) =>
          linkHitsLine(line.rect, targetRect),
        );

        const hits: RawMatch[] = [];
        for (const line of overlapping) {
          for (const match of collectMatches(line)) {
            if (matchHitsTarget(match.rect, targetRect)) hits.push(match);
          }
        }

        const cacheKey = typeof dest === 'string' ? dest : JSON.stringify(dest);
        let target = destCache.get(cacheKey);
        if (target === undefined) {
          target = await resolveDestination(doc, dest).catch(() => null);
          signal?.throwIfAborted();
          destCache.set(cacheKey, target);
        }
        if (!target) continue;

        if (hits.length > 0) {
          // A tolerance-only neighbor should not inherit another citation's destination.
          const exact = hits.filter((hit) => overlapArea(hit.rect, targetRect) > 0);
          for (const hit of exact.length ? exact : hits) {
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
          continue;
        }

        // 正则没命中（如 hyperref 只框住 "2"）：用 dest 名称或框内文本兜底
        const box = collectBoxText(overlapping, targetRect);
        const inferred =
          inferFromDestName(destName(dest)) ?? inferFromBoxText(box.text);
        if (!inferred) continue;
        const rect = box.rect ?? targetRect;
        native.push({
          id: '',
          kind: inferred.kind,
          rawText: inferred.label,
          targetKeys: inferred.targetKeys,
          pageNumber,
          rect,
          lineY: rect.y,
          nativeDest: { pageNumber: target.pageNumber, targetY: target.targetY },
        });
      }
    } catch {
      // 单页注释解析失败不影响整篇
    }

    signal?.throwIfAborted();
    result[pageNumber] = native;
  }

  return result;
}

export interface DetectCitationOptions {
  refRange?: RefRange;
  signal?: AbortSignal;
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
  const { refRange, signal } = options;
  signal?.throwIfAborted();
  const textLayer = detectFromText(linesByPage, refRange, signal);
  const nativeLayer = await detectFromAnnotations(doc, linesByPage, refRange, signal);
  signal?.throwIfAborted();

  const merged: Record<number, InlineCitation[]> = {};
  const allPages = new Set<number>([
    ...Object.keys(textLayer).map(Number),
    ...Object.keys(nativeLayer).map(Number),
  ]);

  for (const pageNumber of allPages) {
    signal?.throwIfAborted();
    const citations = [...(textLayer[pageNumber] ?? [])];

    for (const native of nativeLayer[pageNumber] ?? []) {
      const existing = citations.find((item) => rectIoU(item.rect, native.rect) > 0.4)
        ?? citations.find((item) =>
          item.rawText === native.rawText && rectDistance(item.rect, native.rect) < 0.02,
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
