import { parseReferenceFields } from '../engine/referenceParser';
import type { ReferenceEntry } from '../types/paper';

export interface ScholarMetadata {
  title: string;
  authors?: string;
  year?: string;
  venue?: string;
  citedByCount?: number;
  doi?: string;
  openAccessPdfUrl?: string;
  abstractText?: string;
  bibtex: string;
  source: 'openalex' | 'crossref';
  fetchedAt: number;
}

export function extractDoi(text: string): string | undefined {
  let doi = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0].replace(/[.;:]+$/, '');
  if (doi?.endsWith(')') && doi.split(')').length > doi.split('(').length) doi = doi.slice(0, -1);
  return doi?.toLowerCase();
}

function bibtex(ref: ReferenceEntry, fields: Pick<ScholarMetadata, 'title' | 'authors' | 'year' | 'venue' | 'doi'>) {
  const key = ref.key.replace(/[^a-zA-Z0-9:_-]/g, '') || 'ref' + ref.index;
  const values = { title: fields.title, author: fields.authors?.replace(/\s*(?:;|\s&\s)\s*/g, ' and '),
    year: fields.year, journal: fields.venue, doi: fields.doi };
  const lines = Object.entries(values).filter(([, value]) => value).map(([name, value]) => {
    const escaped = value!.replace(/\s+/g, ' ').trim().replace(/[\\{}%&#_$]/g, ch =>
      ch === '\\' ? '\\textbackslash{}' : '\\' + ch);
    return '  ' + name + ' = {' + escaped + '}';
  });
  return '@' + (fields.venue || (fields.authors && fields.year) ? 'article' : 'misc') +
    '{' + key + ',\n' + lines.join(',\n') + '\n}';
}

export function buildFallbackBibtex(ref: ReferenceEntry): string {
  const parsed = parseReferenceFields(ref.rawText);
  return bibtex(ref, {
    title: ref.title || parsed.title || ref.rawText || '[' + ref.index + ']',
    authors: ref.authors || (parsed.authors !== parsed.title ? parsed.authors : undefined),
    year: ref.year || parsed.year, doi: extractDoi(ref.rawText),
  });
}

function normalized(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function titleSimilarity(a: string, b: string): number {
  const x = normalized(a), y = normalized(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const left = new Set(x.split(' ')), right = new Set(y.split(' '));
  const shared = [...left].filter(word => right.has(word)).length;
  return 2 * shared / (left.size + right.size);
}

export function reconstructAbstract(index?: Record<string, number[]> | null): string | undefined {
  if (!index) return;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 10000) words[position] = word;
    }
  }
  return words.filter(Boolean).join(' ').slice(0, 16000) || undefined;
}

const CACHE_KEY = 'refpin.scholar.cache.v1';
const cache = new Map<string, ScholarMetadata>();
let hydrated = false;
function cacheKey(ref: ReferenceEntry) {
  return extractDoi(ref.rawText) || [normalized(ref.title || ref.rawText), ref.year, normalized(ref.authors || '')].join('|');
}
export function getCachedScholarMetadata(ref: ReferenceEntry): ScholarMetadata | undefined {
  if (!hydrated) {
    hydrated = true;
    try {
      const records = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      for (const [key, record] of records.slice(-200)) {
        if (typeof key === 'string' && typeof record?.title === 'string' && typeof record.bibtex === 'string' &&
            ['openalex', 'crossref'].includes(record.source)) cache.set(key, record);
      }
    } catch { /* Storage is optional. */ }
  }
  const hit = cache.get(cacheKey(ref));
  // Citation keys are paper-local even when metadata is shared across papers.
  return hit && { ...hit, bibtex: bibtex(ref, hit) };
}

interface OpenAlexWork {
  title?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } };
  best_oa_location?: { pdf_url?: string };
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
  doi?: string;
}
interface CrossrefWork {
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  published?: { 'date-parts'?: number[][] };
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  'is-referenced-by-count'?: number;
  DOI?: string;
  abstract?: string;
  link?: { URL?: string; 'content-type'?: string; 'content-version'?: string }[];
  license?: { URL?: string; 'content-version'?: string; start?: { timestamp?: number } }[];
}
type Candidate = Omit<ScholarMetadata, 'source' | 'bibtex' | 'fetchedAt'>;
function openAlex(work: OpenAlexWork): Candidate {
  return {
    title: work.title || work.display_name || '',
    authors: work.authorships?.map(row => row.author?.display_name).filter(Boolean).join(' and '),
    year: work.publication_year?.toString(), venue: work.primary_location?.source?.display_name,
    openAccessPdfUrl: work.best_oa_location?.pdf_url, doi: extractDoi(work.doi || ''),
    citedByCount: work.cited_by_count, abstractText: reconstructAbstract(work.abstract_inverted_index),
  };
}
function crossref(work: CrossrefWork): Candidate {
  // Crossref also lists subscription/TDM links. Only expose a PDF covered by an active open license.
  const openLicenses = work.license?.filter(license =>
    /^https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\//i.test(license.URL || '') &&
    (license.start?.timestamp ?? 0) <= Date.now());
  const openPdf = work.link?.find(link => link['content-type'] === 'application/pdf' &&
    openLicenses?.some(license => license['content-version'] === 'unspecified' ||
      license['content-version'] === link['content-version']));
  return {
    title: work.title?.[0] || '',
    authors: work.author?.map(a => a.name || [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).join(' and '),
    year: (work.published || work.issued)?.['date-parts']?.[0]?.[0]?.toString(),
    venue: work['container-title']?.[0], citedByCount: work['is-referenced-by-count'], openAccessPdfUrl: openPdf?.URL,
    doi: extractDoi(work.DOI || ''), abstractText: work.abstract?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16000),
  };
}

// Called only after the reader enables online enrichment. Reserve time for the fallback provider.
export async function lookupScholarMetadata(ref: ReferenceEntry, signal?: AbortSignal): Promise<ScholarMetadata | null> {
  const cached = getCachedScholarMetadata(ref);
  if (cached) return cached;
  const doi = extractDoi(ref.rawText);
  const title = (ref.title || ref.rawText).replace(/^\s*\[\d+\]\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const matchTitle = ref.title || parseReferenceFields(ref.rawText).title || title;
  if (!doi && !title) return null;
  const deadline = Date.now() + 6500;
  for (const source of ['openalex', 'crossref'] as const) {
    if (signal?.aborted || Date.now() >= deadline) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, Math.min(source === 'openalex' ? 3200 : 6500, deadline - Date.now()));
    try {
      const api = source === 'openalex' ? 'https://api.openalex.org/works' : 'https://api.crossref.org/works';
      const path = doi ? '/' + (source === 'openalex' ? 'https://doi.org/' : '') + doi.split('/').map(encodeURIComponent).join('/') :
        '?' + new URLSearchParams(source === 'openalex' ? { search: title, 'per-page': '3' } :
          { 'query.bibliographic': title, rows: '3' }).toString();
      const response = await fetch(api + path, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) continue;
      const body = await response.json();
      const candidates: Candidate[] = source === 'openalex'
        ? (doi ? [body] : body.results || []).map(openAlex)
        : (doi ? [body.message] : body.message?.items || []).map(crossref);
      const best = candidates.filter(c => c.title && (doi ? doi === c.doi : titleSimilarity(matchTitle, c.title) >= 0.78))
        .sort((a, b) => titleSimilarity(matchTitle, b.title) - titleSimilarity(matchTitle, a.title))[0];
      if (!best || controller.signal.aborted) continue;
      if (!/^https:\/\//i.test(best.openAccessPdfUrl || '')) delete best.openAccessPdfUrl;
      const result = { ...best, source, bibtex: bibtex(ref, best), fetchedAt: Date.now() };
      cache.set(cacheKey(ref), result);
      while (cache.size > 200) cache.delete(cache.keys().next().value!);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache])); } catch { /* Memory cache remains available. */ }
      return result;
    } catch { /* Offline, timed out, or provider unavailable. */ }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  return null;
}
