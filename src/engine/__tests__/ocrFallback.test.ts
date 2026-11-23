import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadOcrModels, ocrLinesToTextLines, recognizeScannedPages } from '../ocrFallback';
import { detectCitations } from '../citationDetector';
import { annotationDoc } from './fixtures';

const word = (text: string, x0: number, x1: number, y0 = 100, y1 = 120) =>
  ({ text, bbox: { x0, x1, y0, y1 } });

describe('OCR 单词和引擎坐标', () => {
  it('保留基线、分栏、UTF-16 字符位置，过滤空框并裁到页内', () => {
    const lines = ocrLinesToTextLines([
      { words: [word('右栏', 650, 720)] },
      { words: [word('通栏', -10, 1020, 170, 190)] },
      { baseline: { x0: 0, x1: 200, y0: 116, y1: 120 },
        words: [word('𠮷图', 80, 160), word('注', 165, 180), word(' ', 190, 195), word('坏框', 200, 198)] },
      { words: [] },
    ], 1000, 500, 2);
    expect(lines.map(line => line.column)).toEqual(['left', 'right', 'full']);
    const [line] = lines;
    expect(line).toMatchObject({ text: '𠮷图注', baseline: 0.2, pageNumber: 2 });
    expect(line.chars.map(c => c.ch).join('')).toBe(line.text);
    expect(line.chars).toHaveLength(line.text.length);
    expect(line.chars[0].rect).toEqual(line.chars[1].rect);
    expect(line.chars[2].rect.x).toBeCloseTo(0.12);
    expect(line.chars[0].baselineY).toBeCloseTo(118.4 / 500);
    expect(lines[2].rect.width).toBe(1);
  });

  it('现有引用检测器直接识别图、表、英文图号和方括号文献', async () => {
    const words = [word('见', 10, 30), word('图', 32, 50), word('1', 55, 65),
      word('表', 74, 92), word('2', 98, 109), word('Fig.', 125, 160), word('3', 169, 180),
      word('[', 196, 200), word('4', 204, 216), word(']', 218, 223)];
    const lines = ocrLinesToTextLines([{ words }], 1000, 500, 1);
    const hits = (await detectCitations(annotationDoc(), { 1: lines }))[1];
    expect(hits.map(h => h.rawText)).toEqual(['图 1', '表 2', 'Fig. 3', '[4]']);
    expect(hits.map(h => h.targetKeys[0])).toEqual(['fig-1', 'tab-2', 'fig-3', 'ref-4']);
    expect(hits[0].rect.x).toBeCloseTo(0.032);
    expect(hits[0].rect.width).toBeCloseTo(0.033);
  });

  it('识别器把左右栏归入同一行时，正文中的两个引用仍各在所属栏', () => {
    const rows = [{ words: [word('见图 1', 50, 210), word('见表 2', 520, 650)] }];
    const lines = ocrLinesToTextLines(rows, 1000, 500, 1);
    expect(lines.map(line => [line.text, line.column])).toEqual([['见图 1', 'left'], ['见表 2', 'right']]);
  });
});

const MODEL_HASHES: Record<number, string> = {
  1730011: '3aa140069a09796b8cb8d3ccd0c052e8ed67f20cddb24b70ffa3344b3b94346b',
  1984273: '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',
};
const hexBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map(pair => parseInt(pair, 16)));

describe('OCR 缓存与调度', () => {
  afterEach(() => vi.unstubAllGlobals());
  /** 测试用的假模型只有长度正确；按长度返回固定版本的 SHA-256，tampered 时返回错误摘要。 */
  function stubDigest(tampered = false) {
    vi.stubGlobal('crypto', { subtle: { digest: async (_: string, data: Uint8Array) =>
      tampered ? new Uint8Array(32).buffer : hexBytes(MODEL_HASHES[data.byteLength] ?? '00'.repeat(32)).buffer } });
  }
  function setup() {
    stubDigest();
    const saved = new Map<string, Response>();
    vi.stubGlobal('caches', { open: async () => ({
      match: async (url: string) => saved.get(url)?.clone(),
      put: async (url: string, value: Response) => { saved.set(url, value); },
    }) });
    const fetchModel = vi.fn(async (url: string) => {
      const data = new Uint8Array(url.includes('chi_sim') ? 1730011 : 1984273);
      data.set([31, 139]);
      return new Response(data);
    });
    vi.stubGlobal('fetch', fetchModel);
    return { fetchModel, saved };
  }

  it('报告下载进度，第二次断网时直接使用两个缓存条目', async () => {
    const { fetchModel } = setup();
    const signal = new AbortController().signal;
    const progress = vi.fn();
    await loadOcrModels(signal, progress);
    expect(fetchModel).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(100);
    fetchModel.mockRejectedValue(new Error('offline'));
    expect((await loadOcrModels(signal, progress)).map(x => x.code)).toEqual(['chi_sim', 'eng']);
    expect(fetchModel).toHaveBeenCalledTimes(2);
  });

  it('内容被替换的模型即使长度一致也会被拒绝，且不写入缓存', async () => {
    const { saved } = setup();
    stubDigest(true);
    await expect(loadOcrModels(new AbortController().signal, () => {})).rejects.toThrow('Unexpected OCR model');
    expect(saved.size).toBe(0);
  });

  it('取消下载时不缓存不完整的文件', async () => {
    const { saved, fetchModel } = setup();
    const controller = new AbortController();
    await expect(loadOcrModels(controller.signal, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved.size).toBe(0);
    expect(fetchModel).toHaveBeenCalledTimes(1);
  });

  function setupRecognition(recognize: () => Promise<unknown>) {
    setup();
    vi.stubGlobal('document', { baseURI: 'http://localhost/',
      createElement: () => ({ getContext: () => ({}), toBlob: (cb: (blob: Blob) => void) => cb(new Blob()) }) });
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class {
      terminate = terminate;
      onmessage?: (event: unknown) => void;
      async postMessage({ action, jobId, payload }: { action: string; jobId: string; payload: { langs: unknown } }) {
        if (action === 'initialize') expect(payload.langs).toBe('chi_sim+eng');
        const data = action === 'recognize' ? await recognize() : undefined;
        this.onmessage?.({ data: { jobId, status: 'resolve', data } });
      }
    });
    const doc = { getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 100, height: 200 }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    })) } as unknown as PDFDocumentProxy;
    return { doc, terminate };
  }

  it('逐页发布空页在内的结果，翻页后优先处理新的邻近页', async () => {
    const { doc, terminate } = setupRecognition(async () => ({ blocks: [] }));
    const order: number[] = [];
    await recognizeScannedPages(doc, { signal: new AbortController().signal, pages: [1, 3, 5, 7],
      currentPage: () => order.length ? 7 : 3, onProgress: vi.fn(),
      onPage: async (page, lines) => { expect(lines).toEqual([]); order.push(page); },
    });
    expect(order).toEqual([3, 7, 5, 1]);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('识别中的页可立即取消，终止 worker 且不发布部分结果', async () => {
    const controller = new AbortController();
    const { doc, terminate } = setupRecognition(() => {
      controller.abort();
      return new Promise(() => {});
    });
    const onPage = vi.fn();
    await expect(recognizeScannedPages(doc, { signal: controller.signal, pages: [1, 2],
      currentPage: () => 1, onProgress: vi.fn(), onPage,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalledOnce();
    expect(doc.getPage).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });
});
