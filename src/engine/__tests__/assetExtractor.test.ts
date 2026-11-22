import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAssets, recropPageRegion } from '../assetExtractor';
import { textLine } from './fixtures';

const rect = { x: 0, y: 0, width: 0.5, height: 0.25 };

function setupCanvas() {
  const toDataURL = vi.fn((type: string, _quality?: number) => `data:${type};base64,AA==`);
  const drawImage = vi.fn();
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0, height: 0, toDataURL,
      getContext: () => ({ getImageData: vi.fn(), drawImage }),
    }),
  });
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: scale * 100, height: scale * 200 }));
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const doc = { getPage: async () => ({ getViewport, render }) } as unknown as PDFDocumentProxy;
  return { doc, render, getViewport, toDataURL, drawImage };
}

afterEach(() => vi.unstubAllGlobals());

describe('PDF crops', () => {
  it('encodes WebP at quality 0.9 and respects a custom scale after caching the default bitmap', async () => {
    const { doc, getViewport, toDataURL, drawImage } = setupCanvas();
    await recropPageRegion(doc, 1, rect);
    expect(await recropPageRegion(doc, 1, rect, 4)).toMatch(/^data:image\/webp/);
    expect(getViewport.mock.calls).toEqual([[{ scale: 2 }], [{ scale: 4 }]]);
    expect(drawImage.mock.lastCall?.slice(-2)).toEqual([200, 200]);
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.9);
  });

  it('falls back to PNG when WebP is unavailable', async () => {
    const { doc, toDataURL } = setupCanvas();
    toDataURL.mockReturnValueOnce('data:,');
    expect(await recropPageRegion(doc, 1, rect)).toMatch(/^data:image\/png/);
    expect(toDataURL).toHaveBeenLastCalledWith('image/png');
  });

  it('cancels an active render and does not report a completed asset', async () => {
    const { doc, render } = setupCanvas();
    const controller = new AbortController();
    const onProgress = vi.fn();
    let rejectRender: (reason: Error) => void;
    const promise = new Promise<void>((_, reject) => { rejectRender = reject; });
    const cancel = vi.fn(() => rejectRender(new Error('Rendering cancelled')));
    render.mockImplementationOnce(() => {
      queueMicrotask(() => controller.abort());
      return { cancel, promise };
    });
    const lines = { 1: [textLine('Figure 1: Overview.')] };
    await expect(extractAssets(doc, lines, { signal: controller.signal, onProgress }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(onProgress).not.toHaveBeenCalled();
  });
});
