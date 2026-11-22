import { afterEach, expect, it, vi } from 'vitest';
import { fetchPdfBytes, isBridgePdfUrl, MAX_REMOTE_PDF_BYTES, openRemotePdf, parsePaperLocation } from '../arxivFetch';
import { handleBridge } from '../../extension/pdfBridge';

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])('opens the requested paper with the extension available = %s', async available => {
  const origin = 'https://xxxpixel-x.github.io';
  const events = new EventTarget();
  const surface = Object.assign(events, {
    postMessage: vi.fn((request: { type: string; requestId: string }, target: string) => {
      expect(target).toBe(origin);
      queueMicrotask(() => {
        const data = { ...request, source: 'refpin-extension', ok: available, base64: btoa('%PDF-extension') };
        events.dispatchEvent(Object.assign(new Event('message'), { data, origin, source: surface }));
      });
    }),
  });
  vi.stubGlobal('window', surface);
  vi.stubGlobal('location', { origin });
  const fetch = vi.fn(async () => new Response('%PDF-direct'));
  vi.stubGlobal('fetch', fetch);
  const file = await openRemotePdf(parsePaperLocation('1706.03762')!, new AbortController().signal);
  expect(file.name).toBe('arXiv-1706.03762.pdf');
  expect(await file.text()).toBe(available ? '%PDF-extension' : '%PDF-direct');
  expect(fetch).toHaveBeenCalledTimes(available ? 0 : 1);
});

it.each([
  ['1706.03762', '1706.03762'], ['1706.03762v7', '1706.03762v7'], ['arXiv:2305.14314', '2305.14314'],
  ['cs/0112017', 'cs/0112017'], ['https://arxiv.org/abs/hep-th/9901001v2', 'hep-th/9901001v2'],
  ['https://arxiv.org/pdf/1706.03762.pdf#page=7', '1706.03762'],
])('normalizes %s', (input, id) => {
  expect(parsePaperLocation(input)).toEqual({ pdfUrl: 'https://arxiv.org/pdf/' + id, displayName: 'arXiv-' + id.replace('/', '-') + '.pdf',
    canonicalAbsUrl: 'https://arxiv.org/abs/' + id });
});

it('resolves OpenReview and ordinary public PDFs while limiting privileged downloads to academic hosts', () => {
  expect(parsePaperLocation('https://openreview.net/forum?id=A_1-x')).toMatchObject({ pdfUrl: 'https://openreview.net/pdf?id=A_1-x' });
  expect(parsePaperLocation('https://university.edu/My%20Paper.pdf?token=a')).toEqual({
    pdfUrl: 'https://university.edu/My%20Paper.pdf?token=a', displayName: 'My Paper.pdf',
  });
  expect(isBridgePdfUrl('https://university.edu/file.pdf')).toBe(false);
  expect(isBridgePdfUrl('https://aclanthology.org/paper.pdf')).toBe(true);
  expect(isBridgePdfUrl('https://arxiv.org/abs/1706.03762')).toBe(false);
});

it.each(['file:///paper.pdf', 'http://arxiv.org/pdf/1706.03762', 'https://localhost/a.pdf', 'https://10.0.0.1/a.pdf',
  'https://192.168.2.1/p.pdf', 'https://127.0.0.1/a.pdf', 'https://2130706433/a.pdf', 'https://[::1]/a.pdf',
  'https://arxiv.org@127.0.0.1/a.pdf', 'https://user@arxiv.org/pdf/1706.03762', 'https://printer.local/a.pdf',
  'https://arxiv.org:8080/pdf/1706.03762', 'javascript:alert(0)', 'arXiv:abc'])('rejects unsafe or malformed input %s', input => {
  expect(parsePaperLocation(input)).toBeNull();
  expect(isBridgePdfUrl(input)).toBe(false);
});

it('checks magic and size, including streaming responses without content-length', async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([37, 80])); controller.enqueue(new Uint8Array([68,70,45,49])); controller.close();
  } });
  const fetch = vi.fn().mockResolvedValueOnce(new Response(stream))
    .mockResolvedValueOnce(new Response('<html>'))
    .mockResolvedValueOnce(new Response('%PDF-', { headers: { 'content-length': String(MAX_REMOTE_PDF_BYTES + 1) } }));
  vi.stubGlobal('fetch', fetch);
  const url = 'https://arxiv.org/pdf/1706.03762', signal = new AbortController().signal;
  expect(new TextDecoder().decode(await fetchPdfBytes(url, signal))).toBe('%PDF-1');
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
  await expect(fetchPdfBytes(url, signal)).rejects.toThrow();
  await expect(fetchPdfBytes(url, signal)).rejects.toThrow();
});

it('revalidates origin, main frame and target in the worker before any privileged fetch', async () => {
  const sender = { id: 'test', url: 'https://xxxpixel-x.github.io/RefPin/', frameId: 0, tab: { id: 1 } };
  vi.stubGlobal('chrome', { runtime: { id: 'test' }, storage: { session: { get: async () => ({}) } } });
  const fetch = vi.fn(async () => new Response('%PDF-1'));
  vi.stubGlobal('fetch', fetch);
  const url = 'https://arxiv.org/pdf/1706.03762';
  expect(await handleBridge({ ...sender, frameId: 1 }, url)).toEqual({ ok: false });
  expect(await handleBridge({ ...sender, url: 'https://xxxpixel-x.github.io/Other/' }, url)).toEqual({ ok: false });
  expect(await handleBridge(sender, 'https://untrusted.example/a.pdf')).toEqual({ ok: false });
  expect(fetch).not.toHaveBeenCalled();
  expect(await handleBridge(sender, url)).toEqual({ ok: true, base64: btoa('%PDF-1') });
});
