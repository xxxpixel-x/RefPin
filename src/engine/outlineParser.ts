import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OutlineItem } from '../types/paper';
import { clamp } from './utils';

export interface NativeTarget {
  pageNumber: number;
  targetY?: number;
}

export async function resolveDestination(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<NativeTarget | null> {
  let resolved: unknown = dest;
  if (typeof dest === 'string') {
    resolved = await doc.getDestination(dest);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) return null;

  const pageRef = resolved[0] as unknown;
  let pageIndex: number | null = null;
  if (typeof pageRef === 'number') {
    pageIndex = pageRef;
  } else if (pageRef && typeof pageRef === 'object') {
    try {
      pageIndex = await doc.getPageIndex(
        pageRef as Parameters<PDFDocumentProxy['getPageIndex']>[0],
      );
    } catch {
      pageIndex = null;
    }
  }
  if (pageIndex === null || !Number.isInteger(pageIndex) || pageIndex < 0) return null;

  const pageNumber = pageIndex + 1;
  const fitName =
    resolved[1] && typeof resolved[1] === 'object'
      ? (resolved[1] as { name?: string }).name
      : undefined;

  let top: number | undefined;
  if (fitName === 'FitR') top = resolved[5];
  if (fitName === 'XYZ') top = (resolved[3] as number | undefined) ?? undefined;
  if (fitName === 'FitH' || fitName === 'FitBH') {
    top = (resolved[2] as number | undefined) ?? undefined;
  }

  if (typeof top !== 'number' || !Number.isFinite(top)) {
    return { pageNumber };
  }

  try {
    const targetPage = await doc.getPage(pageNumber);
    const viewport = targetPage.getViewport({ scale: 1 });
    const x = (fitName === 'XYZ' || fitName === 'FitR') && typeof resolved[2] === 'number' ? resolved[2] : 0;
    const y = viewport.convertToViewportPoint?.(x, top)[1] ?? viewport.height - top;
    return { pageNumber, targetY: clamp(y / viewport.height, 0, 1) };
  } catch {
    return { pageNumber };
  }
}

export async function extractPdfOutline(doc: PDFDocumentProxy, signal?: AbortSignal): Promise<OutlineItem[]> {
  type Entries = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>;
  async function visit(entries: Entries, parent: string): Promise<OutlineItem[]> {
    const items: OutlineItem[] = [];
    for (const [index, entry] of entries.entries()) {
      signal?.throwIfAborted();
      const id = parent + '-' + index;
      const target = await resolveDestination(doc, entry.dest).catch(() => null);
      signal?.throwIfAborted();
      const valid = target && target.pageNumber <= doc.numPages;
      items.push({ id, title: entry.title, pageNumber: valid ? target.pageNumber : null,
        destY: valid ? target.targetY : undefined, children: await visit(entry.items ?? [], id) });
    }
    return items;
  }
  signal?.throwIfAborted();
  try {
    const entries = await doc.getOutline();
    signal?.throwIfAborted();
    return await visit(entries ?? [], 'outline');
  } catch {
    signal?.throwIfAborted();
    return [];
  }
}
