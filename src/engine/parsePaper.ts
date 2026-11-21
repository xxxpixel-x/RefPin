import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InlineCitation, PaperAsset, ReferenceEntry } from '../types/paper';
import { extractPageLines } from './pdfLoader';
import { detectCitations } from './citationDetector';
import { extractAssets, resetAssetCache } from './assetExtractor';
import { parseReferences } from './referenceParser';
import type { LinesByPage } from './types';

export interface ParsePaperResult {
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;
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
): Promise<ParsePaperResult> {
  resetAssetCache(doc);

  const linesByPage: LinesByPage = {};
  onProgress(1);

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    try {
      const page = await doc.getPage(pageNumber);
      linesByPage[pageNumber] = await extractPageLines(page, pageNumber);
    } catch {
      linesByPage[pageNumber] = [];
    }
    onProgress(1 + Math.round((pageNumber / doc.numPages) * 14));
  }

  const { referencesMap, refRange } = parseReferences(linesByPage);
  onProgress(20);

  const citationsByPage = await detectCitations(doc, linesByPage, { refRange });
  onProgress(38);

  const assetsMap = await extractAssets(doc, linesByPage, {
    refRange,
    onProgress: (percent) => onProgress(40 + Math.round(percent * 0.58)),
  });

  onProgress(100);

  return { assetsMap, referencesMap, citationsByPage };
}
