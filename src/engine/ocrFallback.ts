import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Bbox, Page } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import { textLinesFromRow, type TextBox } from './pdfLoader';
import type { TextLine } from './types';

const modelRoot = (import.meta.env.VITE_OCR_MODEL_BASE_URL ||
  'https://cdn.jsdelivr.net/gh/naptha/tessdata@806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_fast').replace(/\/$/, '');
// 固定版本 tessdata_fast 的压缩包。自托管时（VITE_OCR_MODEL_BASE_URL）须提供同样的文件。
const models = [
  { code: 'chi_sim', bytes: 1730011, sha256: '3aa140069a09796b8cb8d3ccd0c052e8ed67f20cddb24b70ffa3344b3b94346b' },
  { code: 'eng', bytes: 1984273, sha256: '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b' },
];
const modelBytes = models.reduce((sum, model) => sum + model.bytes, 0);

interface OcrLine {
  words: { text: string; bbox: Bbox }[];
  baseline?: Bbox;
}

export function ocrLinesToTextLines(rows: OcrLine[], width: number, height: number, page: number): TextLine[] {
  const lines: TextLine[] = [];
  if (!(width > 0 && height > 0)) return lines;
  for (const row of rows) {
    const boxes: TextBox[] = [];
    for (const word of row.words) {
      const text = word.text.trim();
      const { x0, x1, y0, y1 } = word.bbox;
      const left = Math.max(0, x0), right = Math.min(width, x1);
      const top = Math.max(0, y0), bottom = Math.min(height, y1);
      if (!text || !(right > left && bottom > top)) continue;
      const prev = boxes[boxes.length - 1]?.text ?? '';
      const base = row.baseline;
      const baseline = base && base.x1 > base.x0
        ? base.y0 + (base.y1 - base.y0) * ((left + right) / 2 - base.x0) / (base.x1 - base.x0)
        : bottom;
      boxes.push({
        text, x: left / width, y: top / height, width: (right - left) / width,
        height: (bottom - top) / height, baseline: Math.min(height, Math.max(0, baseline)) / height,
        joinPrevious: (/\p{Script=Han}$/u.test(prev) && /^\p{Script=Han}/u.test(text)) ||
          /[[(（]$/.test(prev) || /^[\])）]/.test(text),
      });
    }
    lines.push(...textLinesFromRow(boxes, page));
  }
  return lines.sort((a, b) => a.baseline - b.baseline || a.rect.x - b.rect.x);
}

export type OcrProgress =
  | { stage: 'models'; percent: number }
  | { stage: 'initializing' }
  | { stage: 'page'; page: number; percent: number };

async function sha256Hex(data: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 缓存固定版本的压缩文件。只在用户启动 OCR 后调用，下载中断时不会写入半个模型。 */
export async function loadOcrModels(signal: AbortSignal, report: (percent: number) => void) {
  signal.throwIfAborted();
  const cache = await caches.open('refpin-ocr-models');
  const langs = [];
  let received = 0;
  for (const { code, bytes, sha256 } of models) {
    const url = modelRoot + '/' + code + '.traineddata.gz';
    signal.throwIfAborted();
    const cached = await cache.match(url);
    const hit = cached && new Uint8Array(await cached.arrayBuffer());
    if (hit?.length === bytes && await sha256Hex(hit) === sha256) {
      received += bytes;
      report(Math.round(100 * received / modelBytes));
      langs.push({ code, data: hit });
      continue;
    }
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error('OCR model unavailable');
    const reader = response.body.getReader();
    const data = new Uint8Array(bytes);
    let offset = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        data.set(value, offset);
        offset += value.byteLength;
        report(Math.round(100 * (received + offset) / modelBytes));
      }
    } finally {
      reader.releaseLock();
    }
    signal.throwIfAborted();
    // 长度和 SHA-256 都必须与固定版本一致，被替换或截断的模型不会写入缓存。
    if (offset !== bytes || await sha256Hex(data) !== sha256) throw new Error('Unexpected OCR model');
    await cache.put(url, new Response(data));
    langs.push({ code, data });
    received += bytes;
  }
  signal.throwIfAborted();
  return langs;
}

// 使用锁定版本的 Tesseract Worker 协议。v7 的 createWorker 接收内存模型时会把
// data 当作语言名；分开传 loadLanguage 和 initialize 也能在初始化中直接终止线程。
function openOcrWorker(signal: AbortSignal, onPercent: (percent: number) => void) {
  const worker = new Worker(workerPath);
  let sequence = 0;
  let rejectJob: ((error: unknown) => void) | undefined;
  const abort = () => rejectJob?.(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  worker.onerror = e => rejectJob?.(new Error(e.message));
  worker.onmessageerror = () => rejectJob?.(new Error('Invalid OCR response'));
  function job<T = void>(action: string, payload: object, transfer: Transferable[] = []) {
    signal.throwIfAborted();
    const jobId = String(++sequence);
    return new Promise<T>((resolve, reject) => {
      rejectJob = reject;
      worker.onmessage = ({ data: response }) => {
        if (response.jobId !== jobId) return;
        if (response.status === 'resolve') resolve(response.data);
        if (response.status === 'reject') reject(new Error(String(response.data)));
        if (response.status === 'progress' && response.data.status === 'recognizing text')
          onPercent(Math.round(100 * response.data.progress));
      };
      worker.postMessage({ workerId: 'refpin', jobId, action, payload }, transfer);
    });
  }
  return {
    job,
    close() {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    },
  };
}

async function recognizePage(doc: PDFDocumentProxy, number: number, worker: ReturnType<typeof openOcrWorker>, signal: AbortSignal) {
  const page = await doc.getPage(number);
  signal.throwIfAborted();
  const size = page.getViewport({ scale: 1 });
  // 约 216 dpi，并限制异常大页面的像素数。
  const viewport = page.getViewport({ scale: Math.min(3, 3300 / Math.max(size.width, size.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // print 渲染不等待 requestAnimationFrame：标签页切到后台时识别也能继续，
  // 否则 pdf.js 会一直卡在渲染这一步。
  const render = page.render({ viewport, canvasContext: canvas.getContext('2d')!, background: 'white', intent: 'print' });
  const stopRender = () => render.cancel();
  signal.addEventListener('abort', stopRender, { once: true });
  try {
    await render.promise;
    signal.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(image =>
      image ? resolve(image) : reject(new Error('Could not render OCR image'))));
    const buffer = await blob.arrayBuffer();
    // PSM.SPARSE_TEXT 保留散布在插图旁的短图题、表题和独立编号。
    const data = await worker.job<Page>('recognize', { image: new Uint8Array(buffer),
      options: { tessedit_pageseg_mode: '11' }, output: { blocks: true, text: false } }, [buffer]);
    signal.throwIfAborted();
    const rows = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(para => para.lines));
    return ocrLinesToTextLines(rows, viewport.width, viewport.height, number);
  } finally {
    signal.removeEventListener('abort', stopRender);
    canvas.width = canvas.height = 0;
  }
}

interface OcrOptions {
  pages: readonly number[];
  currentPage: () => number;
  signal: AbortSignal;
  onProgress: (progress: OcrProgress) => void;
  onPage: (page: number, lines: TextLine[]) => Promise<void>;
}

export async function recognizeScannedPages(doc: PDFDocumentProxy, options: OcrOptions) {
  const { signal, onPage, onProgress } = options;
  const pending = [...options.pages];
  if (!pending.length) return;
  const langs = await loadOcrModels(signal, percent => onProgress({ stage: 'models', percent }));
  onProgress({ stage: 'initializing' });
  let page = 0;
  const worker = openOcrWorker(signal, percent => onProgress({ stage: 'page', page, percent }));
  try {
    signal.throwIfAborted();
    await worker.job('load', { options: { lstmOnly: true, corePath: new URL(corePath, document.baseURI).href } });
    await worker.job('loadLanguage', { langs, options: { lstmOnly: true, cacheMethod: 'none' } },
      langs.map(lang => lang.data.buffer));
    await worker.job('initialize', { langs: langs.map(lang => lang.code).join('+'), oem: 1 });
    while (pending.length) {
      signal.throwIfAborted();
      const current = options.currentPage();
      pending.sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
      page = pending.shift()!;
      onProgress({ stage: 'page', page, percent: 0 });
      const lines = await recognizePage(doc, page, worker, signal);
      signal.throwIfAborted();
      await onPage(page, lines);
    }
  } finally {
    worker.close();
  }
}
