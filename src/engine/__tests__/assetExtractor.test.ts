import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAssets, recropPageRegion } from '../assetExtractor';
import { textLine } from './fixtures';

const rect = { x: 0, y: 0, width: 0.5, height: 0.25 };

function setupCanvas(ruleRows: number[] = []) {
  const toDataURL = vi.fn((type: string, _quality?: number) => `data:${type};base64,AA==`);
  const drawImage = vi.fn();
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0, height: 0, toDataURL,
      getContext: () => ({ getImageData: (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4).fill(255);
        for (const row of ruleRows) {
          const offset = Math.floor(row * height) * width;
          data.fill(0, 4 * (offset + Math.floor(width * 0.08)), 4 * (offset + Math.floor(width * 0.92)));
        }
        return { width, height, data };
      }, drawImage }),
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

describe('structured PDF assets', () => {
  it('crops statement lines up to proof or the next heading, inside their own column', async () => {
    const { doc } = setupCanvas();
    const lines = [
      textLine('Theorem 2 (Bound). Every sequence converges.', { y: 0.10, width: 0.39 }),
      textLine('under these conditions.', { y: 0.118, width: 0.39 }),
      textLine('Proof. First consider the limit.', { y: 0.137, width: 0.39 }),
      textLine('Lemma 1: The sequence is bounded.', { y: 0.31, width: 0.39 }),
      textLine('Proposition 3. The limit is unique.', { y: 0.328, width: 0.39 }),
      ...[0.10, 0.118, 0.31, 0.328].map(y => textLine('Text from the neighboring column.', { x: 0.52, y, width: 0.40 })),
    ];
    const assets = await extractAssets(doc, { 1: lines });
    expect(Object.keys(assets)).toEqual(['thm-2', 'lem-1', 'prop-3']);
    const { cropRect: crop, imageUrl } = assets['thm-2'];
    expect(imageUrl).toMatch(/^data:image/);
    expect(crop.x + crop.width).toBeLessThan(0.52);
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(0.13);
    expect(crop.y + crop.height).toBeLessThan(0.137);
    expect(assets['lem-1'].cropRect.height).toBeLessThan(0.03);
  });

  it('includes the enclosing rules and cuts off the following prose even without a blank line', async () => {
    const { doc } = setupCanvas([0.10, 0.13, 0.19]);
    const assets = await extractAssets(doc, { 1: [
      textLine('Algorithm 1: Sample', { y: 0.112 }),
      textLine('Input: a distribution', { y: 0.135 }),
      textLine('Draw a value', { y: 0.155 }),
      textLine('Return the value', { y: 0.175 }),
      textLine('The results are shown below.', { y: 0.198 }),
    ] });
    const { y, height } = assets['alg-1'].cropRect;
    expect(y).toBeLessThanOrEqual(0.10);
    expect(y + height).toBeGreaterThan(0.19);
    expect(y + height).toBeLessThan(0.198);
  });

  it('collects pseudocode and previews numbered English and Chinese section and appendix headings', async () => {
    const { doc } = setupCanvas();
    const lines = [
      textLine('Algorithm 9 runs in linear time.', { y: 0.05 }),
      textLine('Algorithm 1: Normalize scores', { y: 0.12 }),
      textLine('Input: scores', { y: 0.14, x: 0.10 }),
      textLine('1 Return the normalized scores', { y: 0.16, x: 0.12 }),
      textLine('We measure performance.', { y: 0.24 }),
      textLine('3.2 Multi-Head Attention', { y: 0.34 }),
      textLine('Appendix B.1', { y: 0.5 }), textLine('A Hyperparameters', { y: 0.6 }),
      textLine('4.1 多头注意力', { y: 0.75 }), textLine('算法 2：采样', { y: 0.82 }),
      textLine('定义 2：距离。', { y: 0.85 }), textLine('Theorem 8. In bibliography.', { y: 0.95 }),
    ];
    const assets = await extractAssets(doc, { 1: lines }, { refRange: { startPage: 1, endPage: 1, startY: 0.92, endY: 1 } });
    expect(Object.keys(assets)).toEqual(['alg-1', 'sec-3.2', 'app-b.1', 'app-a', 'sec-4.1', 'alg-2', 'def-2']);
    const { y, height } = assets['alg-1'].cropRect;
    expect(y).toBeLessThan(0.12);
    expect(y + height).toBeGreaterThanOrEqual(0.172);
    expect(y + height).toBeLessThan(0.24);
    expect(assets['sec-3.2'].cropRect.height).toBeCloseTo(0.25, 2);
  });
});
