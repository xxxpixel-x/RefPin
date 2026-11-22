import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InlineCitation, PaperAsset, ReferenceEntry } from '../types/paper';
import { extractPageLines } from './pdfLoader';
import { detectCitations } from './citationDetector';
import { extractAssets, resetAssetCache } from './assetExtractor';
import { parseReferences } from './referenceParser';
import { parseGlossary, type GlossaryResult } from './glossaryParser';
import type { LinesByPage } from './types';
import { cachePageLines } from './pageLinesCache';

export interface ParsePaperResult extends GlossaryResult {
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;
  isImageOnly: boolean;
}

export type ProgressHandler = (percent: number) => void;

/**
 * 串联整篇解析：
 * 文本行 → 参考文献 → 双路引用识别 → 图表/公式裁切
 * 单页异常不会中断整篇。
 */
export async function parsePaper(
  doc: PDFDocumentProxy,
  onProgress: ProgressHandler = () => {},
  signal?: AbortSignal,
): Promise<ParsePaperResult> {
  signal?.throwIfAborted();
  resetAssetCache(doc);

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
  const { referencesMap, refRange } = parseReferences(linesByPage);
  onProgress(20);

  const citationsByPage = await detectCitations(doc, linesByPage, { refRange, referencesMap, signal });
  signal?.throwIfAborted();
  onProgress(38);
  const glossary = parseGlossary(linesByPage, { refRange, citationsByPage, signal });

  const assetsMap = await extractAssets(doc, linesByPage, {
    refRange,
    signal,
    onProgress: (percent) => onProgress(40 + Math.round(percent * 0.58)),
  });

  signal?.throwIfAborted();
  cachePageLines(doc, linesByPage);
  const isImageOnly = doc.numPages > 0 && Object.values(linesByPage).every((lines) => !lines.length);
  onProgress(100);

  return { assetsMap, referencesMap, citationsByPage, isImageOnly, ...glossary };
}
