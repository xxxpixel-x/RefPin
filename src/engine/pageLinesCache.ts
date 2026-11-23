import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { NormalizedRect } from '../types/paper';
import type { LinesByPage, TextLine } from './types';
import { readingOrder } from './utils';

export interface CompactTextLine extends Pick<TextLine, 'text' | 'rect' | 'pageNumber'> {
  // Variable-width lines need two 16-bit coordinates per character.
  xEdges?: Uint16Array;
}

export interface SearchMatch {
  id: string;
  pageNumber: number;
  rect: NormalizedRect;
}

const cache = new WeakMap<PDFDocumentProxy, Record<number, CompactTextLine[]>>();

function compactLine({ text, rect, pageNumber, chars }: TextLine): CompactTextLine {
  const line: CompactTextLine = { text, rect, pageNumber };
  const step = rect.width / text.length;
  if (chars.length === text.length && chars.some(({ rect: r }, i) =>
    Math.abs(r.x - (rect.x + i * step)) > 0.0001 || Math.abs(r.width - step) > 0.0001)) {
    const edges = new Uint16Array(chars.length * 2);
    const pack = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 65535);
    chars.forEach(({ rect: r }, i) => {
      edges[2 * i] = pack(r.x);
      edges[2 * i + 1] = pack(r.x + r.width);
    });
    line.xEdges = edges;
  }
  return line;
}

export function cachePageLines(doc: PDFDocumentProxy, linesByPage: LinesByPage, merge = false): void {
  const pages: Record<number, CompactTextLine[]> = merge ? { ...cache.get(doc) } : {};
  for (const [page, lines] of Object.entries(linesByPage)) {
    pages[Number(page)] = readingOrder(lines).map(compactLine);
  }
  cache.set(doc, pages);
}

export function getCachedPageLines(doc: PDFDocumentProxy) {
  return cache.get(doc);
}

export function searchPageLines(pages: Record<number, CompactTextLine[]> | undefined, query: string): SearchMatch[] {
  if (!pages || !query.trim()) return [];
  const pattern = new RegExp(query.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'), 'giu');
  const matches: SearchMatch[] = [];
  for (const lines of Object.values(pages)) {
    for (const [i, { text, rect, pageNumber, xEdges }] of lines.entries()) {
      for (const hit of text.matchAll(pattern)) {
        const start = hit.index!;
        const end = start + hit[0].length;
        const x = xEdges ? xEdges[start * 2] / 65535 : rect.x + rect.width * start / text.length;
        const right = xEdges ? xEdges[end * 2 - 1] / 65535 : rect.x + rect.width * end / text.length;
        matches.push({ id: [pageNumber, i, start].join('-'), pageNumber,
          rect: { ...rect, x, width: Math.max(0, right - x) } });
      }
    }
  }
  return matches;
}

export function nearestLineIndex(lines: CompactTextLine[], x: number, y: number): number {
  let best = -1;
  let distance = Infinity;
  lines.forEach(({ rect }, index) => {
    const dx = Math.max(0, rect.x - x, x - rect.x - rect.width);
    const dy = Math.abs(y - rect.y - rect.height / 2);
    const score = Math.hypot(dx, dy);
    if (score < distance) { distance = score; best = index; }
  });
  return best;
}
