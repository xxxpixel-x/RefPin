import type { ReferenceEntry } from '../types/paper';
import type { LinesByPage, RefRange, TextLine } from './types';
import { readingOrder } from './utils';

const HEADING_RE =
  /^(?:\d+\.?\s*)?(?:references|bibliography|参\s*考\s*文\s*献|參\s*考\s*文\s*獻)\s*$/i;
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
  index: number;
  pageNumber: number;
  text: string;
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
    if (isInitial || isEtAl || isAbbreviation) continue;

    parts.push(body.slice(start, hit.index + 1).trim());
    start = hit.index + hit[0].length;
  }

  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

function parseFields(raw: string): Pick<ReferenceEntry, 'title' | 'authors' | 'year'> {
  const body = raw
    .replace(/^\[\d+\]\s*/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .trim();

  const years = body.match(/\b(?:19|20)\d{2}\b/g);
  const year = years ? years[years.length - 1] : undefined;

  const quoted = body.match(/[“"']([^”"']{6,200})[”"']/);
  let title = quoted?.[1]?.trim();
  let authors: string | undefined;

  if (title) {
    authors = body.split(/[“"']/)[0]?.replace(/[.,;，。．；]\s*$/, '').trim();
  } else {
    const segments = splitSentenceBoundaries(body);
    authors = segments[0]?.replace(/[.,;，。．；]\s*$/, '').trim();
    title = segments[1]?.replace(/[.,;，。．；]\s*$/, '').trim();
  }

  if (authors && authors.length > 160) authors = `${authors.slice(0, 157)}...`;
  if (title && title.length > 220) title = `${title.slice(0, 217)}...`;
  if (!title) title = body.slice(0, 160);

  return { title, authors, year };
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

  for (const { pageNumber, line } of collected) {
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
    } else if (current) {
      current.text = `${current.text} ${text}`.trim();
    }
  }
  if (current) entries.push(current);

  const referencesMap: Record<string, ReferenceEntry> = {};
  for (const entry of entries) {
    const key = `ref-${entry.index}`;
    if (referencesMap[key]) continue;
    referencesMap[key] = {
      key,
      index: entry.index,
      rawText: entry.text,
      pageNumber: entry.pageNumber,
      ...parseFields(entry.text),
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
