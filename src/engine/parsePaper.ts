import { buildBacklinksMap } from './backlinks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InlineCitation, OutlineItem, PaperAsset, ReferenceEntry } from '../types/paper';
import { extractPageLines } from './pdfLoader';
import { detectCitations, type DetectCitationsOptions } from './citationDetector';
import { extractAssets, resetAssetCache } from './assetExtractor';
import { parseReferences } from './referenceParser';
import { parseGlossary, type GlossaryResult } from './glossaryParser';
import type { LinesByPage, RefRange, TextLine } from './types';
import { extractPdfOutline } from './outlineParser';
import { cachePageLines } from './pageLinesCache';

export interface ParsePaperResult extends GlossaryResult {
  backlinksMap: ReturnType<typeof buildBacklinksMap>;
  outline: OutlineItem[];
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;
  isImageOnly: boolean;
}

export type ProgressHandler = (percent: number) => void;

export interface ScannedPaper {
  pending: ReadonlySet<number>;
  applyPage: (page: number, lines: TextLine[], signal: AbortSignal) => Promise<ParsePaperResult>;
}

function scannedPaper(doc: PDFDocumentProxy, pages: number[], linesByPage: LinesByPage,
  result: ParsePaperResult, refRange?: RefRange): ScannedPaper {
  const pending = new Set(pages);
  return {
    pending,
    async applyPage(page, lines, signal) {
      signal.throwIfAborted();
      if (!pending.has(page)) return result;
      if (lines.length) {
        const changed = { [page]: lines };
        const all = { ...linesByPage, ...changed };
        const refs = parseReferences(all);
        // 后识别的文献页可解析之前页上的引用，也可能改变参考文献区间。
        const rangeChanged = JSON.stringify(refRange) !== JSON.stringify(refs.refRange);
        const refsChanged = rangeChanged || JSON.stringify(result.referencesMap) !== JSON.stringify(refs.referencesMap);
        const citations = await detectCitations(doc, refsChanged ? all : changed, { ...refs, signal });
        const citationsByPage = refsChanged ? citations : { ...result.citationsByPage, [page]: citations[page] ?? [] };
        const glossary = parseGlossary(all, { refRange: refs.refRange, citationsByPage, signal });
        const assets = await extractAssets(doc, rangeChanged ? all : changed, { refRange: refs.refRange, signal });
        signal.throwIfAborted();
        const assetsMap = rangeChanged ? assets : { ...result.assetsMap };
        for (const [key, asset] of Object.entries(assets)) {
          if (!assetsMap[key] || asset.pageNumber < assetsMap[key].pageNumber) assetsMap[key] = asset;
        }
        refRange = refs.refRange;
        linesByPage = all;
        cachePageLines(doc, changed, true);
        result = { ...result, ...glossary, assetsMap, referencesMap: refs.referencesMap, citationsByPage,
          isImageOnly: false, backlinksMap: buildBacklinksMap(citationsByPage, glossary.glossaryMentionsByPage) };
      }
      pending.delete(page);
      return result;
    },
  };
}

interface CitationPassOptions extends Pick<DetectCitationsOptions, 'channel' | 'signal'> {
  onProgress?: ProgressHandler;
  onLines?: (lines: LinesByPage) => void;
}

/** 阅读器和评测共用的引用识别入口，截止到图表裁切之前。 */
export async function parsePaperCitations(
  doc: PDFDocumentProxy,
  { onProgress = () => {}, onLines, signal, channel }: CitationPassOptions = {},
) {
  signal?.throwIfAborted();

  const linesByPage: LinesByPage = {};
  const scannedPages: number[] = [];
  onProgress(1);

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    signal?.throwIfAborted();
    try {
      const page = await doc.getPage(pageNumber);
      signal?.throwIfAborted();
      linesByPage[pageNumber] = await extractPageLines(page, pageNumber);
      if (!linesByPage[pageNumber].length) scannedPages.push(pageNumber);
    } catch {
      linesByPage[pageNumber] = [];
    }
    signal?.throwIfAborted();
    onProgress(1 + Math.round((pageNumber / doc.numPages) * 14));
  }

  signal?.throwIfAborted();
  onLines?.(linesByPage);
  const { referencesMap, refRange } = parseReferences(linesByPage);
  onProgress(20);

  const citationsByPage = await detectCitations(doc, linesByPage, { refRange, referencesMap, signal, channel });
  signal?.throwIfAborted();
  onProgress(38);
  return { linesByPage, referencesMap, refRange, citationsByPage, scannedPages };
}

export async function parsePaper(
  doc: PDFDocumentProxy,
  onProgress: ProgressHandler = () => {},
  signal?: AbortSignal,
  onScannedPages?: (paper: ScannedPaper) => void,
): Promise<ParsePaperResult> {
  signal?.throwIfAborted();
  resetAssetCache(doc);
  const { linesByPage, referencesMap, refRange, citationsByPage, scannedPages } = await parsePaperCitations(doc, {
    onProgress, signal, onLines: lines => cachePageLines(doc, lines),
  });
  const glossary = parseGlossary(linesByPage, { refRange, citationsByPage, signal });

  const assetsMap = await extractAssets(doc, linesByPage, {
    refRange,
    signal,
    onProgress: (percent) => onProgress(40 + Math.round(percent * 0.58)),
  });

  signal?.throwIfAborted();
  const outline = await extractPdfOutline(doc, signal);
  signal?.throwIfAborted();
  const isImageOnly = doc.numPages > 0 && Object.values(linesByPage).every((lines) => !lines.length);
  onProgress(100);

  const result = {
    backlinksMap: buildBacklinksMap(citationsByPage, glossary.glossaryMentionsByPage),
    outline,
    assetsMap,
    referencesMap,
    citationsByPage,
    isImageOnly,
    ...glossary,
  };
  if (scannedPages.length) onScannedPages?.(scannedPaper(doc, scannedPages, linesByPage, result, refRange));
  return result;
}
