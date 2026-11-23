import type { PDFDocumentProxy } from 'pdfjs-dist';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCitations } from '../citationDetector';
import { getCachedPageLines } from '../pageLinesCache';
import { parsePaper, parsePaperCitations, type ScannedPaper } from '../parsePaper';
import { extractPageLines } from '../pdfLoader';
import { useReaderStore } from '../../store/useReaderStore';
import { annotationDoc, textLine } from './fixtures';

vi.mock('../pdfLoader', () => ({ extractPageLines: vi.fn() }));
beforeEach(() => vi.mocked(extractPageLines).mockReset());

describe('reader parse lifecycle', () => {
  it('keeps the same merged citations and bibliography in the reader and the evaluation entry', async () => {
    const line = textLine('See Fig. 2 and [3].');
    const digit = line.chars[line.text.indexOf('2')].rect;
    const doc = { ...annotationDoc([{ subtype: 'Link', dest: [0, { name: 'Fit' }],
      rect: [digit.x, digit.y, digit.x + digit.width, digit.y + digit.height] }]), numPages: 2 } as PDFDocumentProxy;
    vi.mocked(extractPageLines).mockImplementation(async (_, page) => page === 1 ? [line] : [
      textLine('References', { pageNumber: 2 }), textLine('[3] A. Smith. 2020. Example.', { pageNumber: 2, y: 0.4 }),
    ]);
    const evaluation = await parsePaperCitations(doc);
    const reader = await parsePaper(doc);
    expect(reader.citationsByPage).toEqual(evaluation.citationsByPage);
    expect(reader.referencesMap).toEqual(evaluation.referencesMap);
    expect(reader.referencesMap['ref-3']).toBeDefined();
    expect(reader.citationsByPage[1].map(c => [c.id, c.rawText, c.targetKeys, c.nativeDest?.pageNumber])).toEqual([
      ['cite-1-0', 'Fig. 2', ['fig-2'], 1], ['cite-1-1', '[3]', ['ref-3'], undefined],
    ]);
  });

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

  it('混合文档只补扫描页，逐页刷新，支持取消重试及后出现的文献', async () => {
    const doc = { ...annotationDoc(), numPages: 3 } as PDFDocumentProxy;
    vi.mocked(extractPageLines).mockImplementation(async (_, page) => page === 1 ? [textLine('See Fig. 3.')] : []);
    let paper!: ScannedPaper;
    await parsePaper(doc, undefined, undefined, session => { paper = session; });
    expect([...paper.pending]).toEqual([2, 3]);
    const signal = new AbortController().signal;
    const first = await paper.applyPage(2, [textLine('见图 1 和 [4]。', { pageNumber: 2 })], signal);
    expect(first.backlinksMap['fig-1']).toHaveLength(1);
    expect(first.backlinksMap['fig-3']).toHaveLength(1);
    expect(getCachedPageLines(doc)?.[2][0].text).toBe('见图 1 和 [4]。');
    await expect(paper.applyPage(3, [], AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect([...paper.pending]).toEqual([3]);
    const last = await paper.applyPage(3, [textLine('参考文献', { pageNumber: 3 }),
      textLine('[4] Zhang. 2020. Title.', { pageNumber: 3, y: 0.4 })], signal);
    expect(last.referencesMap['ref-4']).toBeDefined();
    expect(last.backlinksMap['ref-4']).toHaveLength(1);
    expect(paper.pending.size).toBe(0);
    expect(extractPageLines).toHaveBeenCalledTimes(3);
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
