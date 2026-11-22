import { describe, expect, it, vi } from 'vitest';
import { computeLruEvictions, listRecentPapers, loadPaperArchive, loadPdfBlob, MAX_PDF_BYTES, savePdfBlob, stripPinnedItemForStorage } from '../paperDb';

describe('paper archives', () => {
  it('stores only pin metadata, preserving both crop rectangles and the reference', () => {
    const cropRect = { x: 0, y: 0.1, width: 1, height: 0.3 };
    const originalCropRect = { ...cropRect, height: 0.2 };
    const metadata = {
      id: 'fig1', kind: 'figure' as const, title: 'Figure 1', subtitle: 'Overview', pageNumber: 2,
      cropRect, originalCropRect, collapsed: true, createdAt: 43,
      reference: { key: 'ref1', index: 1, rawText: 'Author 2000', pageNumber: 7 },
    };
    expect(stripPinnedItemForStorage({
      ...metadata, imageUrl: 'data:image/png;base64,xxx', originalImageUrl: 'data:image/webp;base64,yyy',
      previewStatus: 'restoring',
    })).toStrictEqual(metadata);
  });

  it('evicts only the least recently used keys without sorting the input in place', () => {
    const rows = [6, 2, 1, 5, 3, 4].map(n => ({ paperHash: String(n), lastOpenedAt: n }));
    expect(computeLruEvictions(rows, 5)).toEqual(['1']);
    expect(computeLruEvictions(rows, 3)).toEqual(['1', '2', '3']);
    expect(computeLruEvictions(rows, 6)).toEqual([]);
    expect(computeLruEvictions(rows, 0)).toHaveLength(6);
    expect(rows[0].paperHash).toBe('6');
  });

  it('keeps the reader usable when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      expect(await listRecentPapers()).toEqual([]);
      expect(await loadPaperArchive('missing')).toBeUndefined();
      expect(await loadPdfBlob('missing')).toBeUndefined();
      expect(await savePdfBlob('local', new Blob(['pdf']))).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it('skips samples and files over 15 MiB before opening storage', async () => {
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    try {
      expect(await savePdfBlob('sample', new Blob(['pdf']), 'attention')).toBe(false);
      const large = new Blob([new Uint8Array(MAX_PDF_BYTES + 1)]);
      expect(await savePdfBlob('large', large)).toBe(false);
      expect(open).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
