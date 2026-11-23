import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { CitationKind, InlineCitation, NormalizedRect, ReferenceEntry } from '../types/paper';
import type { LinesByPage, RefRange, TextLine } from './types';
import { parseCaptionLabel, parseStructureHeading, structuredMentions } from './captionLabel';
import { resolveDestination, type NativeTarget } from './outlineParser';
import { authorNames, normalizeSurname, parseReferenceFields } from './referenceParser';
import {
  isInsideRefRange,
  rectDistance,
  rectForRange,
  rectIoU,
  readingOrder,
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
  const destinationLabel = name.replace(/^(?:.*[/:])?(?:sub)*section[.:_-]/i, 'Section ')
    .replace(/(?:^|[./:_-])(algorithm|alg|theorem|thm|lemma|lem|proposition|prop|corollary|cor|definition|def|appendix|app)[.:_-]/i, ' $1 ');
  const structured = structuredMentions(destinationLabel)[0];
  if (structured) return { ...structured, label: structured.rawText };
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
  return { kind: 'section', targetKeys: [`sec-${number}`], label: `Section ${number}` };
}

function inferFromBoxText(
  text: string,
): { kind: CitationKind; targetKeys: string[]; label: string } | null {
  const structured = structuredMentions(text)[0];
  if (structured) return { ...structured, label: structured.rawText };
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

function expandReferenceKeys(content: string, requireAll = false): string[] {
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
      } else if (requireAll) {
        return [];
      }
    } else {
      numbers.push(Number(part));
    }
  }
  if (requireAll && numbers.some(n => !Number.isInteger(n) || n < 1 || n > 300)) return [];
  return Array.from(new Set(numbers))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 300)
    .map((n) => `ref-${n}`);
}

const surname = String.raw`(?:(?:van|von|der|den|de|del|da|di|la|al)\s+)*[\p{Lu}\p{Lt}][\p{L}\p{M}'’‐‑–-]*`;
const citedAuthors = '(' + surname + ')(?:\\s+et\\s+al\\.?|\\s+(?:and|&)\\s+(' + surname + '))?';
const citedYear = '((?:18|19|20)\\d{2}[a-z]?)';
const authorInParens = new RegExp('^(?:(?:e\\.g\\.|i\\.e\\.|see(?: also)?|cf\\.)[,\\s]+)?' +
  citedAuthors + ',?\\s+' + citedYear + '$', 'u');
const narrative = new RegExp('(?<![\\p{L}\\p{N}_])' + citedAuthors + '\\s*\\(' + citedYear + '\\)', 'gu');

function indexReferences(references: Record<string, ReferenceEntry>) {
  const byAuthorYear = new Map<string, ReferenceEntry[]>();
  for (const reference of Object.values(references)) {
    let entry = reference;
    if (!entry.firstAuthorLastName) {
      // Older parse results and archived pins may have only authors or raw text.
      const fields = entry.authors && entry.year ? authorNames(entry.authors) : parseReferenceFields(entry.rawText);
      entry = { ...fields, ...reference, firstAuthorLastName: fields.firstAuthorLastName };
    }
    if (!entry.firstAuthorLastName || !entry.year) continue;
    const key = normalizeSurname(entry.firstAuthorLastName) + '/' + entry.year;
    const bucket = byAuthorYear.get(key) ?? [];
    bucket.push(entry);
    byAuthorYear.set(key, bucket);
  }
  return { references, byAuthorYear, hasNumbered: Object.keys(references).some(key => /^ref-\d+$/.test(key)) };
}

type ReferenceIndex = ReturnType<typeof indexReferences>;

function resolveAuthorYear(hit: RegExpMatchArray, index: ReferenceIndex): string[] {
  const [, first, second, year] = hit;
  const prefix = normalizeSurname(first) + '/';
  const candidates = index.byAuthorYear.get(prefix + year) ??
    (year.length === 5 ? index.byAuthorYear.get(prefix + year.slice(0, 4)) : undefined);
  if (!candidates) return [];
  const matching = second
    ? candidates.filter(entry => entry.secondAuthorLastName && normalizeSurname(entry.secondAuthorLastName) === normalizeSurname(second))
    : candidates;
  return matching.length === 1 ? [matching[0].key] : [];
}

// A PDF hotspot has one rectangle. A parenthetical or narrative citation
// spanning a line break gets a separate exact hotspot on each printed line.
function authorYearMatches(lines: TextLine[], index: ReferenceIndex) {
  const byLine = new Map<TextLine, RawMatch[]>();
  if (!index.byAuthorYear.size) return byLine;
  let paragraph = '';
  let spans: { line: TextLine; start: number; end: number }[] = [];
  function add(start: number, raw: string, keys: string[]) {
    if (!keys.length) return;
    for (const span of spans) {
      const first = Math.max(0, start - span.start);
      const end = Math.min(span.end, start + raw.length) - span.start;
      const rect = rectForRange(span.line, first, end);
      if (!rect) continue;
      const hits = byLine.get(span.line) ?? [];
      hits.push({ kind: 'reference', rawText: span.line.text.slice(first, end), targetKeys: keys, rect });
      byLine.set(span.line, hits);
    }
  }
  function flush() {
    for (const group of paragraph.matchAll(/\(([^()]*)\)/g)) {
      const keys = new Set<string>();
      for (const part of group[1].split(';')) {
        const hit = authorInParens.exec(part.trim());
        if (hit) for (const key of resolveAuthorYear(hit, index)) keys.add(key);
      }
      add(group.index!, group[0], [...keys]);
    }
    for (const hit of paragraph.matchAll(narrative)) {
      add(hit.index!, hit[0], resolveAuthorYear(hit, index));
    }
    paragraph = '';
    spans = [];
  }
  let previous: TextLine | undefined;
  for (const line of readingOrder(lines)) {
    // Overprinted lines or a column/paragraph break cannot continue a citation.
    if (previous && (line.rect.y <= previous.rect.y || line.rect.y - previous.rect.y > previous.rect.height * 2.2 ||
        Math.min(line.rect.x + line.rect.width, previous.rect.x + previous.rect.width) <= Math.max(line.rect.x, previous.rect.x))) flush();
    const start = paragraph.length;
    spans.push({ line, start, end: start + line.text.length });
    paragraph += line.text + ' ';
    previous = line;
  }
  flush();
  return byLine;
}

const superDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function followsProse(before: string): boolean {
  if (!/[\p{L}.,;:!?'’”")\]。，；：！？]$/u.test(before)) return false;
  const base = before.replace(/[.,;:!?'’”"。，；：！？]+$/u, '');
  if (/\b[A-Za-z]\([^()]*\)$|\([^()]*[=+*/^][^()]*\)$/u.test(base)) return false;
  const word = base.replace(/[)\]]+$/u, '');
  return !/(?:^|[^\p{L}\p{N}_])(?:[A-Za-z\p{Script=Greek}]|mm|cm|km)$|[\d^_=+*/×÷−]$/u.test(word) &&
    !/[=+*/×÷^_−]\s*[\p{L}\p{N}]+$/u.test(word);
}

function superscriptMatches(line: TextLine, index: ReferenceIndex, add: (start: number, end: number, keys: string[]) => void) {
  if (!index.hasNumbered || !/[\d⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(line.text)) return;
  // Letters give a representative body font even on a line ending in a long citation list.
  const body = line.chars.filter(c => /\p{L}/u.test(c.ch));
  if (!body.length) return;
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const height = median(body.map(c => c.fontHeight ?? c.rect.height));
  const baseline = median(body.map(c => c.baselineY ?? c.rect.y + c.rect.height));
  const raisedDigit = (i: number) => {
    const c = line.chars[i];
    if (!c) return false;
    if (superDigits.includes(c.ch)) return true;
    return /\d/.test(c.ch) && (c.fontHeight ?? c.rect.height) < height * 0.8 &&
      (c.baselineY ?? c.rect.y + c.rect.height) < baseline - height * 0.12;
  };
  for (let start = 1; start < line.chars.length; start++) {
    if (!raisedDigit(start)) continue;
    let end = start + 1;
    while (end < line.chars.length) {
      if (raisedDigit(end)) { end++; continue; }
      if (!/[,–⁻-]/.test(line.text[end])) break;
      let next = end + 1;
      while (line.text[next] === ' ') next++;
      if (!raisedDigit(next)) break;
      end = next + 1;
    }
    const before = line.text.slice(0, start);
    const raw = line.text.slice(start, end);
    if (followsProse(before) && !/^[\p{L}\p{N}_^=]/u.test(line.text.slice(end))) {
      const numeric = raw.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => String(superDigits.indexOf(digit))).replace(/⁻/g, '-');
      const keys = expandReferenceKeys(numeric, true);
      if (keys.length && keys.every(key => index.references[key])) add(start, end, keys);
    }
    start = end - 1;
  }
}

function collectMatches(line: TextLine, index: ReferenceIndex, authorYear: RawMatch[]): RawMatch[] {
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

  const heading = parseStructureHeading(trimmed);
  for (const hit of structuredMentions(text)) {
    if (heading && hit.start === text.indexOf(trimmed) && hit.rawText !== trimmed) continue;
    const rect = rectForRange(line, hit.start, hit.start + hit.rawText.length);
    if (rect) matches.push({ ...hit, rect });
  }

  run(FIGURE_RE, 'figure', (num) => [`fig-${normalizeNumber(num)}`]);
  run(TABLE_RE, 'table', (num) => [`tab-${normalizeNumber(num)}`]);
  run(EQUATION_RE, 'equation', (num) => [`eq-${normalizeNumber(num)}`]);
  run(REFERENCE_RE, 'reference', (content) => expandReferenceKeys(content));

  const addReference = (start: number, end: number, targetKeys: string[]) => {
    if (!targetKeys.length) return;
    const rect = rectForRange(line, start, end);
    if (rect && !matches.some(match => rectIoU(match.rect, rect) > 1e-8)) {
      matches.push({ kind: 'reference', rawText: text.slice(start, end), targetKeys, rect });
    }
  };
  for (const hit of authorYear) {
    if (!matches.some(match => rectIoU(match.rect, hit.rect) > 1e-8)) matches.push(hit);
  }
  superscriptMatches(line, index, addReference);

  return matches.sort((a, b) => a.rect.x - b.rect.x);
}

/** 路线二：纯文本层正则识别（Sioyek Smart Jump 思路） */
function detectFromText(
  linesByPage: LinesByPage,
  index: ReferenceIndex,
  refRange: RefRange | undefined,
  signal?: AbortSignal,
) {
  const result: Record<number, InlineCitation[]> = {};
  const matchesByLine = new Map<TextLine, RawMatch[]>();

  for (const [pageKey, lines] of Object.entries(linesByPage)) {
    signal?.throwIfAborted();
    const pageNumber = Number(pageKey);

    const citations: InlineCitation[] = [];
    const body = lines.filter(line => !REFERENCES_HEADING_RE.test(line.text.trim()) &&
      !isInsideRefRange(pageNumber, line.rect.y + line.rect.height / 2, refRange));
    const authorYear = authorYearMatches(body, index);
    for (const line of body) {
      const matches = collectMatches(line, index, authorYear.get(line) ?? []);
      matchesByLine.set(line, matches);
      for (const match of matches) {
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

  return { citationsByPage: result, matchesByLine };
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
  matchesByLine: Map<TextLine, RawMatch[]>,
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
          for (const match of matchesByLine.get(line) ?? []) {
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

export interface DetectCitationsOptions {
  channel?: 'native' | 'text' | 'both';
  referencesMap?: Record<string, ReferenceEntry>;
  refRange?: RefRange;
  signal?: AbortSignal;
}

export type DetectCitationOptions = DetectCitationsOptions;

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
  const { channel = 'both', refRange, signal } = options;
  signal?.throwIfAborted();
  const index = indexReferences(options.referencesMap ?? {});
  const { citationsByPage: textLayer, matchesByLine } = detectFromText(linesByPage, index, refRange, signal);
  // 原生通道仍使用链接框附近的文本解释链接，但仅输出有内部链接的命中。
  const nativeLayer = channel === 'text' ? {} : await detectFromAnnotations(doc, linesByPage, matchesByLine, refRange, signal);
  signal?.throwIfAborted();

  const merged: Record<number, InlineCitation[]> = {};
  const allPages = new Set<number>([
    ...Object.keys(textLayer).map(Number),
    ...Object.keys(nativeLayer).map(Number),
  ]);

  for (const pageNumber of allPages) {
    signal?.throwIfAborted();
    const citations = channel === 'native' ? [] : [...(textLayer[pageNumber] ?? [])];

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
