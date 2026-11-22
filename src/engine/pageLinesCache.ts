import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { LinesByPage, TextLine } from './types';

export type CompactTextLine = Pick<TextLine, 'text' | 'rect' | 'pageNumber'>;

const cache = new WeakMap<PDFDocumentProxy, Record<number, CompactTextLine[]>>();

export function cachePageLines(doc: PDFDocumentProxy, linesByPage: LinesByPage): void {
  const pages: Record<number, CompactTextLine[]> = {};
  for (const [page, lines] of Object.entries(linesByPage)) {
    pages[Number(page)] = lines.map(({ text, rect, pageNumber }) => ({ text, rect, pageNumber }));
  }
  cache.set(doc, pages);
}

export function getCachedPageLines(doc: PDFDocumentProxy) {
  return cache.get(doc);
}
