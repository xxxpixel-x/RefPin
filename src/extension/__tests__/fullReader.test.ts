import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openFullReader } from '../fullReader';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { location: new URL('chrome-extension://refpin/reader.html') });
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each([
  ['https://library.example/view?token=a%2Bb&download=1', 'include'],
  ['http://localhost:8080/view', 'include'],
  ['file:///D:/papers/paper.pdf', 'omit'],
])('opens %s directly with native credentials and checks PDF bytes', async (url, credentials) => {
  const { openRemotePdf } = await import('../../services/arxivFetch');
  const fetch = vi.fn().mockResolvedValueOnce(new Response('%PDF-1.7')).mockResolvedValueOnce(new Response('<html>'));
  vi.stubGlobal('fetch', fetch);
  const paper = { pdfUrl: url, displayName: '论文.pdf' }, signal = new AbortController().signal;
  const file = await openRemotePdf(paper, signal, 'https://unused.example/');
  expect(fetch).toHaveBeenCalledWith(url, { credentials, signal });
  expect(file.name).toBe(paper.displayName);
  expect(await file.text()).toBe('%PDF-1.7');
  await expect(openRemotePdf(paper, signal)).rejects.toMatchObject({ uiMessage: { key: 'panel.invalidPdf' } });
});

it('gives the file-access hint and serves the remote sample on page four', async () => {
  const { openRemotePdf } = await import('../../services/arxivFetch');
  const { SAMPLES } = await import('../../config/samples');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(openRemotePdf({ pdfUrl: 'file:///p.pdf', displayName: 'P' }, new AbortController().signal))
    .rejects.toMatchObject({ uiMessage: { key: 'panel.fileAccess' } });
  expect(SAMPLES.map(({ url, demoStartPage }) => [url, demoStartPage])).toEqual([['https://arxiv.org/pdf/1706.03762.pdf', 4]]);
});

it('round-trips the original PDF address, title and page and supports opening home', async () => {
  const create = vi.fn();
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => 'chrome-extension://refpin/' + path }, tabs: { create } });
  const pdf = 'https://library.example/p?sig=a%2Bb&n=2#page=1';
  await openFullReader(pdf, 'Notes & 图表', 7);
  const url = new URL(create.mock.calls[0][0].url);
  expect(url.pathname).toBe('/reader.html');
  expect(Object.fromEntries(url.searchParams)).toEqual({ url: pdf, title: 'Notes & 图表', page: '7' });
  await openFullReader();
  expect(create).toHaveBeenLastCalledWith({ url: 'chrome-extension://refpin/reader.html' });
});

it('uses the background free translator only when translation is requested', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, translations: ['译文'] });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { local: { get: async () => ({}) } } });
  const { selectionTranslator } = await import('../../services/translator');
  expect((await selectionTranslator.loadTranslateConfig()).provider).toBe('free');
  expect(sendMessage).not.toHaveBeenCalled();
  expect(await selectionTranslator.translateTexts(['source'])).toEqual(['译文']);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'REFPIN_TRANSLATE_BATCH', texts: ['source'], config: { provider: 'free', targetLang: 'zh-CN' } });
});
