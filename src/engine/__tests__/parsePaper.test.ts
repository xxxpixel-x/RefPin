import type { PDFDocumentProxy } from 'pdfjs-dist';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCitations } from '../citationDetector';
import { getCachedPageLines } from '../pageLinesCache';
import { parsePaper } from '../parsePaper';
import { extractPageLines } from '../pdfLoader';
import { useReaderStore } from '../../store/useReaderStore';
import { annotationDoc, textLine } from './fixtures';

vi.mock('../pdfLoader', () => ({ extractPageLines: vi.fn() }));
beforeEach(() => vi.mocked(extractPageLines).mockReset());

describe('reader parse lifecycle', () => {
  it('publishes compact lines per document, and indexes citations only when the result is installed', async () => {
    const doc = annotationDoc();
    doc.destroy = vi.fn(async () => {});
    const line = textLine('See Fig. 2a.');
    vi.mocked(extractPageLines).mockResolvedValue([line]);
    const result = await parsePaper(doc);
    expect(result.isImageOnly).toBe(false);
    expect(getCachedPageLines(doc)).toEqual({ 1: [{ text: line.text, pageNumber: 1, rect: line.rect }] });
    expect(getCachedPageLines(annotationDoc())).toBeUndefined();
    const store = useReaderStore.getState();
    store.setPdfDocument(doc, 'local.pdf', 'hash', null);
    store.setParseResult(result);
    expect(useReaderStore.getState()).toMatchObject({
      paperHash: 'hash', pdfSource: null, backlinksMap: { 'fig-2': [{ rawText: 'Fig. 2a' }] },
    });
    store.resetPaper();
    expect(doc.destroy).toHaveBeenCalledOnce();
    expect(useReaderStore.getState()).toMatchObject({ paperHash: null, pdfSource: null, backlinksMap: {} });
  });

  it('flags a document with pages but no extracted lines, including an empty page in the cache', async () => {
    vi.mocked(extractPageLines).mockResolvedValue([]);
    const doc = annotationDoc();
    expect((await parsePaper(doc)).isImageOnly).toBe(true);
    expect(getCachedPageLines(doc)).toEqual({ 1: [] });
    expect((await parsePaper({ ...doc, numPages: 0 } as PDFDocumentProxy)).isImageOnly).toBe(false);
  });

  it('publishes and clears glossary entries and resolved author-year mentions with the document', async () => {
    vi.mocked(extractPageLines)
      .mockResolvedValueOnce([textLine('Multi-Head Attention (MHA).')])
      .mockResolvedValueOnce([textLine('MHA follows Smith and Lee (2022).', { pageNumber: 2 })])
      .mockResolvedValueOnce([textLine('References', { pageNumber: 3 }),
        textLine('Smith & Lee (2022). Attention.', { pageNumber: 3, y: 0.4 })]);
    const doc = { ...annotationDoc(), numPages: 3 } as PDFDocumentProxy;
    const store = useReaderStore.getState();
    store.setParseResult(await parsePaper(doc));
    expect(useReaderStore.getState()).toMatchObject({
      glossaryMap: { MHA: { definedPage: 1 } }, glossaryMentionsByPage: { 2: [{ term: 'MHA' }] },
      citationsByPage: { 2: [{ targetKeys: ['ref-ay-smith-2022'] }] },
    });
    store.resetPaper();
    expect(useReaderStore.getState()).toMatchObject({ glossaryMap: {}, glossaryMentionsByPage: {} });
  });

  it('defaults auto-sync on and restores a disabled preference after reopening the reader', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    } });
    try {
      vi.resetModules();
      const { useReaderStore: first } = await import('../../store/useReaderStore');
      expect(first.getState().autoSyncEnabled).toBe(true);
      first.getState().setAutoSyncEnabled(false);
      first.getState().resetPaper();
      expect(first.getState().autoSyncEnabled).toBe(false);
      vi.resetModules();
      const { useReaderStore: reopened } = await import('../../store/useReaderStore');
      expect(reopened.getState().autoSyncEnabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops after an in-flight text extraction and never publishes partial lines or completion progress', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const doc = { ...annotationDoc(), numPages: 5 } as PDFDocumentProxy;
    vi.mocked(extractPageLines).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('document destroyed');
    });
    await expect(parsePaper(doc, progress, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(extractPageLines).toHaveBeenCalledTimes(1);
    expect(getCachedPageLines(doc)).toBeUndefined();
    expect(progress).not.toHaveBeenCalledWith(100);
  });

  it('propagates aborts from the native citation pass', async () => {
    const controller = new AbortController();
    const getPage = vi.fn(async () => {
      controller.abort();
      throw new Error('document destroyed');
    });
    const doc = { getPage } as unknown as PDFDocumentProxy;
    await expect(detectCitations(doc, { 1: [], 2: [] }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(getPage).toHaveBeenCalledTimes(1);
  });
});
