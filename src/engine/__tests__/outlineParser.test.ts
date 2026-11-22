import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { extractPdfOutline } from '../outlineParser';

describe('PDF outline', () => {
  it('preserves nested groups and resolves names, object references, indices and coordinates', async () => {
    const doc = {
      numPages: 5,
      getOutline: async () => [
        { title: 'Part I', dest: null, items: [
          { title: 'Overview', dest: 'chapter', items: [] },
          { title: 'Details', dest: [3, { name: 'FitH' }, 400], items: [] },
        ] },
        { title: 'Broken name', dest: 'missing', items: [] },
        { title: 'Out of bounds', dest: [9, { name: 'Fit' }], items: [] },
      ],
      getDestination: async (name: string) => {
        if (name === 'missing') throw Error('Invalid destination');
        return [{ num: 3, gen: 0 }, { name: 'XYZ' }, 20, 600];
      },
      getPageIndex: vi.fn(async () => 1),
      getPage: async () => ({ getViewport: () => ({ height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] }) }),
    };
    const items = await extractPdfOutline(doc as unknown as PDFDocumentProxy);
    expect(items.map(i => i.pageNumber)).toEqual([null, null, null]);
    expect(items[0].children.map(i => [i.title, i.pageNumber, i.destY])).toEqual([['Overview', 2, 0.25], ['Details', 4, 0.5]]);
    expect(items[0].children[0].id).not.toBe(items[0].children[1].id);
    expect(doc.getPageIndex).toHaveBeenCalledWith({ num: 3, gen: 0 });
  });

  it('handles missing outlines and propagates cancellation during resolution', async () => {
    expect(await extractPdfOutline({ getOutline: async () => null } as unknown as PDFDocumentProxy)).toEqual([]);
    const controller = new AbortController();
    const doc = {
      getOutline: async () => [{ title: 'Chapter', dest: 'chapter', items: [] }],
      getDestination: async () => { controller.abort(); throw Error(); },
    };
    await expect(extractPdfOutline(doc as unknown as PDFDocumentProxy, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
