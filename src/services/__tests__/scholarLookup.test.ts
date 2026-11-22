import { afterEach, expect, it, vi } from 'vitest';
import type { ReferenceEntry } from '../../types/paper';
import { buildFallbackBibtex, extractDoi, getCachedScholarMetadata, lookupScholarMetadata, reconstructAbstract, titleSimilarity } from '../scholarLookup';

const ref: ReferenceEntry = { key: 'ref-14', index: 14, pageNumber: 7,
  title: 'Attention Is All You Need', authors: 'A. Vaswani', year: '2017', rawText: '[14] A. Vaswani (2017). Attention Is All You Need.' };
afterEach(() => vi.unstubAllGlobals());

it('keeps enrichment off by default and persists an explicit opt-in and opt-out', async () => {
  const values = new Map<string,string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value),
  } });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const { useReaderStore } = await import('../../store/useReaderStore');
  expect(useReaderStore.getState().scholarLookupEnabled).toBe(false);
  useReaderStore.getState().setScholarLookupEnabled(true);
  expect(values.get('refpin.scholar.v1')).toBe('true');
  vi.resetModules();
  const restored = (await import('../../store/useReaderStore')).useReaderStore;
  expect(restored.getState().scholarLookupEnabled).toBe(true);
  restored.getState().setScholarLookupEnabled(false);
  expect(values.get('refpin.scholar.v1')).toBe('false');
  expect(fetch).not.toHaveBeenCalled();
});

it('creates offline BibTeX with inferred fields and literal BibTeX punctuation', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(buildFallbackBibtex({ ...ref, title: 'A {B} & C' })).toContain('title = {A \\{B\\} \\& C}');
  const raw = buildFallbackBibtex({ ...ref, title: undefined, year: undefined, authors: undefined });
  expect(raw).toContain('author = {A. Vaswani}');
  expect(raw).toContain('year = {2017}');
  expect(buildFallbackBibtex({ ...ref, rawText: 'Anonymous note', title: undefined, authors: undefined, year: undefined })).toMatch(/^@misc/);
  expect(fetch).not.toHaveBeenCalled();
});

it('extracts punctuated DOIs and reconstructs repeated abstract words in position order', () => {
  expect(extractDoi('(doi:10.5555/ABC(4)).')).toBe('10.5555/abc(4)');
  expect(reconstructAbstract({ model: [1,3], A: [0], per: [2] })).toBe('A model per model');
  expect(titleSimilarity('Learning: With DATA', 'learning with data')).toBe(1);
  expect(titleSimilarity('Learning With Data', 'Completely unrelated work')).toBe(0);
});

it('matches a later OpenAlex candidate and reuses persistent metadata with a paper-local citation key', async () => {
  const data = new Map<string,string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (k: string,v: string) => data.set(k,v) });
  const fetch = vi.fn(async () => Response.json({ results: [
    { title: 'A different paper' }, { display_name: ref.title, doi: 'https://doi.org/10.5555/attention',
      cited_by_count: 0, best_oa_location: { pdf_url: 'https://publisher.org/a.pdf' },
      abstract_inverted_index: { attention: [1], With: [0] }, primary_location: { source: { display_name: 'Proceedings' } } },
  ] }));
  vi.stubGlobal('fetch', fetch);
  expect(await lookupScholarMetadata(ref)).toMatchObject({ title: ref.title, abstractText: 'With attention', source: 'openalex', citedByCount: 0 });
  expect(getCachedScholarMetadata(ref)?.venue).toBe('Proceedings');
  expect((await lookupScholarMetadata({ ...ref, key: 'ref-2' }))?.bibtex).toContain('{ref-2,');
  vi.resetModules();
  expect((await (await import('../scholarLookup')).lookupScholarMetadata(ref))?.title).toBe(ref.title);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('falls back to Crossref by DOI and quietly handles offline, mismatches and cancellation', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ message: { DOI: '10.5555/test', title: ['A Paper'],
      author: [{ given: 'Ada', family: 'Doe' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['J. Research'],
      license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/', 'content-version': 'am' }],
      link: [
        { URL: 'https://publisher.org/subscriber.pdf', 'content-type': 'application/pdf', 'content-version': 'vor' },
        { URL: 'https://publisher.org/accepted.pdf', 'content-type': 'application/pdf', 'content-version': 'am' },
      ] } }));
  vi.stubGlobal('fetch', fetch);
  expect(await lookupScholarMetadata({ ...ref, title: 'A Paper', rawText: 'doi:10.5555/test' })).toMatchObject({
    source: 'crossref', authors: 'Ada Doe', year: '2020', venue: 'J. Research', openAccessPdfUrl: 'https://publisher.org/accepted.pdf',
  });
  const other = { ...ref, title: 'Models of inference in vision', rawText: 'paper' };
  fetch.mockResolvedValueOnce(Response.json({ results: [{ title: 'Inferential statistics' }] })).mockRejectedValueOnce(new TypeError('offline'));
  expect(await lookupScholarMetadata(other)).toBeNull();
  const controller = new AbortController(); controller.abort();
  expect(await lookupScholarMetadata(other, controller.signal)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(4);
});
