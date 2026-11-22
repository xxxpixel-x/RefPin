import type { ReferenceEntry } from '../types/paper';
import type { LinesByPage, RefRange, TextLine } from './types';
import { readingOrder } from './utils';

const HEADING_RE =
  /^(?:\d+\.?\s*)?(?:references(?:\s+and\s+notes)?|bibliography|参\s*考\s*文\s*献|參\s*考\s*文\s*獻)\s*$/i;
const BRACKET_ENTRY_RE = /^\[(\d{1,3})\]\s*/;
const NUMBER_ENTRY_RE = /^(\d{1,3})[.)、]\s+/;

/** 参考文献之后的附录 / 新大节标题，命中即停止收集 */
const STOP_SECTION_RE =
  /^(?:(?:\d+|[A-Z])(?:\.\d+)*\.?\s+)?(?:appendix|appendices|supplementary|supplemental|acknowledge?ments?|attention visualizations)\b|^(?:附\s*录|致\s*谢|參\s*考\s*文\s*獻|参\s*考\s*文\s*献)/i;

/** 参考文献里不应出现的图表标题，命中即说明已经进入附录 */
const CAPTION_STOP_RE =
  /^(?:figure|fig\.?|table|tab\.?|图|表)\s*\d+(?:[.\-–]\d+)?[a-zA-Z]?\s*[:：.．]/i;

/** 明显大于参考文献正文字号的行，视为新章节 / 图内标题 */
const HEADING_FONT_SIZE = 0.0175;

interface PendingEntry {
  index?: number;
  pageNumber: number;
  text: string;
}

const yearPattern = /\b(?:18|19|20)\d{2}[a-z]?\b/;
const particles = /^(?:de|del|der|den|di|da|du|van|von|la|le|al)$/;

export function normalizeSurname(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/’/g, "'").replace(/[‐‑–]/g, '-').trim();
}

function looksLikeNames(text: string): boolean {
  const words = text.match(/[\p{L}\p{M}’'-]+/gu);
  return !!words?.length && !/[?!:=\d]|\p{L}{2}\.\s+\p{Lu}/u.test(text) && words.every(word =>
    /^[\p{Lu}\p{Lt}]/u.test(word) || particles.test(word) || /^(and|et|al)$/i.test(word));
}

export function authorNames(authors: string) {
  const names = authors.replace(/\bet\s+al\.?.*$/i, '').split(/\s+(?:and|&)\s+|[,;&]/i)
    .map(name => name.trim()).filter(Boolean);
  const surnames: string[] = [];
  for (const name of names) {
    // APA puts initials after a comma. Vancouver puts them after the surname.
    const words = name.replace(/(?:\s+[A-Z]{1,3}\.?)+$/, '').match(/[\p{L}\p{M}’'-]+/gu) ?? [];
    if (!words.length || words.every(word => /^[A-Z]{1,3}$/.test(word))) continue;
    let start = words.length - 1;
    while (start > 0 && particles.test(words[start - 1])) start--;
    surnames.push(normalizeSurname(words.slice(start).join(' ')));
  }
  return {
    firstAuthorLastName: surnames[0],
    secondAuthorLastName: surnames[1],
    isEtAl: /\bet\s+al\b/i.test(authors) || surnames.length > 2,
  };
}

/**
 * 按句号切分作者与标题，但跳过首字母缩写（Quoc V. Le）、et al.、
 * e.g. / i.e. 等不应断句的情况。
 */
function splitSentenceBoundaries(body: string): string[] {
  const parts: string[] = [];
  const boundaryRe = /\.\s+|[。．]\s*/g;
  let start = 0;
  let hit: RegExpExecArray | null;

  while ((hit = boundaryRe.exec(body))) {
    const before = body.slice(0, hit.index + 1);
    const token = before.match(/(\S+)$/)?.[1] ?? '';
    const isInitial = /^[A-Z]\.$/.test(token);
    const isEtAl = /(?:^|\s)et\s+al\.$/i.test(before);
    const isAbbreviation = /(?:^|\s)(?:e\.g|i\.e|etc|vs|fig|tab|eq|no|dr|mr|ms|prof)\.$/i.test(
      before,
    );
    // In a surname-first reference the final initial also closes the author
    // list ("Smith, J. & Lee, A. Title..."). A following initial belongs to it.
    const next = body.slice(hit.index + hit[0].length);
    const endsAuthorList = isInitial && /,\s*(?:\p{Lu}\.\s*)+$/u.test(before) &&
      /^\p{Lu}(?!\.)/u.test(next) && looksLikeNames(before);
    if ((isInitial && !endsAuthorList) || isEtAl || isAbbreviation) continue;

    parts.push(body.slice(start, hit.index + 1).trim());
    start = hit.index + hit[0].length;
  }

  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

export function parseReferenceFields(raw: string) {
  const body = raw
    .replace(/^\[\d+\]\s*/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .trim();

  const years = [...body.matchAll(new RegExp(yearPattern, 'g'))];
  const earlyYear = years[0];
  const beforeYear = earlyYear && body.slice(0, earlyYear.index).replace(/[\s.,;(]+$/, '');
  const datedAuthors = beforeYear && looksLikeNames(beforeYear) ? beforeYear : undefined;
  const year = datedAuthors ? earlyYear[0] : years[years.length - 1]?.[0];

  const quoted = body.match(/(?:^|[\s,])[“"']([^”"']{6,200})[”"']/);
  let title = quoted?.[1]?.trim();
  let authors: string | undefined;

  if (datedAuthors) {
    authors = datedAuthors;
    const rest = body.slice(earlyYear.index! + earlyYear[0].length).replace(/^[\s).,:;]+/, '');
    title ??= splitSentenceBoundaries(rest)[0]?.replace(/[.。．]$/, '');
  } else if (title && quoted) {
    authors = body.slice(0, quoted.index).replace(/[.,;，。．；]\s*$/, '').trim();
  } else {
    // In year-last entries "et al." can terminate the author list.
    const etAl = /^(.+?\bet al\.)\s+(?=\p{Lu})/u.exec(body);
    const segments = etAl
      ? [etAl[1], ...splitSentenceBoundaries(body.slice(etAl[0].length))]
      : splitSentenceBoundaries(body);
    authors = segments[0]?.replace(/[.,;，。．；]\s*$/, '').trim();
    title = segments[1]?.replace(/[.,;，。．；]\s*$/, '').trim();
  }

  const names = authors ? authorNames(authors) : undefined;
  if (authors && authors.length > 160) authors = `${authors.slice(0, 157)}...`;
  if (title && title.length > 220) title = `${title.slice(0, 217)}...`;
  if (!title) title = body.slice(0, 160);

  return { title, authors, year, ...names };
}

export interface ReferenceParseResult {
  referencesMap: Record<string, ReferenceEntry>;
  /** References 标题所在页（兼容旧调用方） */
  startPage?: number;
  /** 参考文献正文的精确区间 */
  refRange?: RefRange;
}

export function parseReferences(linesByPage: LinesByPage): ReferenceParseResult {
  const pages = Object.keys(linesByPage)
    .map(Number)
    .sort((a, b) => a - b);

  let heading: TextLine | null = null;
  let stopped = false;
  const collected: Array<{ pageNumber: number; line: TextLine }> = [];

  for (const pageNumber of pages) {
    if (stopped) break;
    const lines = readingOrder(linesByPage[pageNumber] ?? []);

    for (const line of lines) {
      const text = line.text.trim();

      if (!heading) {
        if (HEADING_RE.test(text)) heading = line;
        continue;
      }

      if (!text) continue;
      // 页脚页码不能被吞进最后一条文献
      if (/^\d{1,4}$/.test(text) && line.rect.y > 0.9) continue;
      if (STOP_SECTION_RE.test(text)) {
        stopped = true;
        break;
      }
      if (CAPTION_STOP_RE.test(text)) {
        stopped = true;
        break;
      }
      // 后续页首出现大字号标题（如附录里的图内标题），直接结束
      if (pageNumber > heading.pageNumber && line.rect.height >= HEADING_FONT_SIZE) {
        stopped = true;
        break;
      }

      collected.push({ pageNumber, line });
    }
  }

  if (!heading) return { referencesMap: {} };

  const entries: PendingEntry[] = [];
  let current: PendingEntry | null = null;
  const numberedCount = collected.filter(({ line }) =>
    BRACKET_ENTRY_RE.test(line.text.trim()) || NUMBER_ENTRY_RE.test(line.text.trim())).length;
  const margins = new Map<string, number>();
  const columnKey = (line: TextLine) => line.pageNumber + '/' + line.column;
  for (const { line } of collected) {
    const column = columnKey(line);
    margins.set(column, Math.min(margins.get(column) ?? Infinity, line.rect.x));
  }
  for (const [i, { pageNumber, line }] of collected.entries()) {
    const text = line.text.trim();
    if (!text) continue;

    const bracket = text.match(BRACKET_ENTRY_RE);
    const numbered = text.match(NUMBER_ENTRY_RE);
    const index = bracket ? Number(bracket[1]) : numbered ? Number(numbered[1]) : null;

    if (index !== null && index > 0 && index <= 300) {
      if (current) entries.push(current);
      current = {
        index,
        pageNumber,
        text: text.replace(BRACKET_ENTRY_RE, '').replace(NUMBER_ENTRY_RE, '').trim(),
      };
    } else if (numberedCount >= 3) {
      if (current) current.text += ' ' + text;
    } else {
      const prev = collected[i - 1]?.line;
      const atMargin = line.rect.x <= margins.get(columnKey(line))! + 0.004;
      const paragraphBreak = !prev || columnKey(prev) !== columnKey(line) ||
        line.rect.x < prev.rect.x - 0.004 || line.rect.y - prev.rect.y > prev.rect.height * 1.55;
      const year = yearPattern.exec(text);
      const namePart = text.slice(0, year?.index).replace(/[\s.,;(]+$/, '');
      const datedAuthor = !!year && looksLikeNames(namePart);
      const authorLine = looksLikeNames(namePart) || looksLikeNames(parseReferenceFields(text).authors ?? '');
      // A hanging continuation may itself start with an author. Keep it in the
      // same entry until its year has been reached, even across a page break.
      const hasYear = current && yearPattern.test(current.text);
      // A single-line entry can be followed immediately by a wrapped author
      // list. Its date and hanging indent may first appear on the next line.
      const next = collected[i + 1]?.line;
      const wrappedAuthors = !year && next && next.pageNumber === pageNumber &&
        next.rect.x > line.rect.x + 0.004 && looksLikeNames(namePart);
      const newEntry = !current || (hasYear && atMargin &&
        (datedAuthor || wrappedAuthors || (paragraphBreak && authorLine)));
      if (newEntry) {
        if (current) entries.push(current);
        current = { pageNumber, text };
      } else if (current) {
        current.text += ' ' + text;
      }
    }
  }
  if (current) entries.push(current);

  const referencesMap: Record<string, ReferenceEntry> = {};
  for (const [position, entry] of entries.entries()) {
    const fields = parseReferenceFields(entry.text);
    let key = 'ref-' + entry.index;
    if (entry.index === undefined) {
      if (!fields.firstAuthorLastName || !fields.year) continue;
      const base = 'ref-ay-' + fields.firstAuthorLastName.replace(/\s+/g, '-') + '-' + fields.year;
      key = base;
      for (let n = 2; referencesMap[key]; n++) key = base + '-' + n;
    }
    if (referencesMap[key]) continue;
    referencesMap[key] = {
      key,
      index: entry.index ?? position + 1,
      rawText: entry.text,
      pageNumber: entry.pageNumber,
      ...fields,
    };
  }

  const last = collected[collected.length - 1];
  const refRange: RefRange = {
    startPage: heading.pageNumber,
    startY: heading.rect.y + heading.rect.height,
    endPage: last?.pageNumber ?? heading.pageNumber,
    endY: last ? last.line.rect.y + last.line.rect.height : heading.rect.y + heading.rect.height,
  };

  return { referencesMap, startPage: heading.pageNumber, refRange };
}
