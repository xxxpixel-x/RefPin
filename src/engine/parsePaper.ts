import { buildBacklinksMap } from './backlinks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InlineCitation, OutlineItem, PaperAsset, ReferenceEntry } from '../types/paper';
import { extractPageLines } from './pdfLoader';
import { detectCitations, type DetectCitationsOptions } from './citationDetector';
import { extractAssets, resetAssetCache } from './assetExtractor';
import { parseReferences } from './referenceParser';
import { parseGlossary, type GlossaryResult } from './glossaryParser';
import type { LinesByPage } from './types';
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
  onProgress(1);

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    signal?.throwIfAborted();
    try {
      const page = await doc.getPage(pageNumber);
      signal?.throwIfAborted();
      linesByPage[pageNumber] = await extractPageLines(page, pageNumber);
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
  return { linesByPage, referencesMap, refRange, citationsByPage };
}

export async function parsePaper(
  doc: PDFDocumentProxy,
  onProgress: ProgressHandler = () => {},
  signal?: AbortSignal,
): Promise<ParsePaperResult> {
  signal?.throwIfAborted();
  resetAssetCache(doc);
  const { linesByPage, referencesMap, refRange, citationsByPage } = await parsePaperCitations(doc, {
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

  return {
    backlinksMap: buildBacklinksMap(citationsByPage, glossary.glossaryMentionsByPage),
    outline,
    assetsMap,
    referencesMap,
    citationsByPage,
    isImageOnly,
    ...glossary,
  };
}
