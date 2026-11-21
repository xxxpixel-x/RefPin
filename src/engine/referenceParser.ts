import type { ReferenceEntry } from '../types/paper';
import type { LinesByPage } from './types';
import { readingOrder } from './utils';

const HEADING_RE = /^(?:references|bibliography|参考文献|參考文獻)\s*$/i;
const BRACKET_ENTRY_RE = /^\[(\d{1,3})\]\s*/;
const NUMBER_ENTRY_RE = /^(\d{1,3})[.)、]\s+/;

interface PendingEntry {
  index: number;
  pageNumber: number;
  text: string;
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
    authors = body.split(/[“"']/)[0]?.replace(/[.,;]\s*$/, '').trim();
  } else {
    const segments = body.split(/\.\s+/);
    authors = segments[0]?.trim();
    title = segments[1]?.trim();
  }

  if (authors && authors.length > 160) authors = `${authors.slice(0, 157)}...`;
  if (title && title.length > 220) title = `${title.slice(0, 217)}...`;
  if (!title) title = body.slice(0, 160);

  return { title, authors, year };
}

export interface ReferenceParseResult {
  referencesMap: Record<string, ReferenceEntry>;
  /** References 标题所在页，用于正文引用检测时排除文献区编号 */
  startPage?: number;
}

export function parseReferences(linesByPage: LinesByPage): ReferenceParseResult {
  const pages = Object.keys(linesByPage)
    .map(Number)
    .sort((a, b) => a - b);

  let headingPage: number | undefined;
  const collected: string[] = [];

  for (const pageNumber of pages) {
    const lines = readingOrder(linesByPage[pageNumber] ?? []);
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i].text.trim();
      if (!headingPage) {
        if (HEADING_RE.test(text)) {
          headingPage = pageNumber;
          continue;
        }
        continue;
      }
      if (text.length > 0) collected.push(`\u0000${pageNumber}\u0000${text}`);
    }
  }

  if (!headingPage) return { referencesMap: {} };

  const entries: PendingEntry[] = [];
  let current: PendingEntry | null = null;

  for (const record of collected) {
    const [, pageText, ...rest] = record.split('\u0000');
    const pageNumber = Number(pageText);
    const text = rest.join('\u0000').trim();
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

  return { referencesMap, startPage: headingPage };
}
