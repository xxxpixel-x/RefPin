// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { extractDomPaper } from '../domPaperParser';
import { SidePanelApp } from '../sidepanel/SidePanelApp';
import { useReaderStore } from '../../store/useReaderStore';

vi.mock('../../engine/pdfLoader', () => ({ loadPdfDocument: vi.fn() }));

it('navigates and exports an HTML paper in the companion, with enrichment off by default', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = `<article class="ltx_document">
    <h2 id="intro">1 Introduction</h2><p id="def">Multi-Head Attention (MHA).</p>
    <figure id="alg"><figcaption>Algorithm 2: Rank candidates</figcaption></figure>
    <p><a href="#alg" id="cite">Algorithm 2</a></p>
    <ol id="references"><li id="r1">[1] A. Author. Model training. 2024.</li></ol></article>`;
  const payload = extractDomPaper().payload;
  const pdfUrl = 'https://arxiv.org/pdf/1706.03762';
  const tab = { id: 6, windowId: 1, active: true, url: 'https://arxiv.org/html/1706.03762', title: 'Paper' };
  const sendMessage = vi.fn(async (_id: number, request: { type: string }) =>
    request.type === 'REFPIN_EXTRACT_DOM' ? { ok: true, payload: { ...payload, title: 'Paper', pdfUrl } } : { ok: true });
  const create = vi.fn(), listeners = { addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal('chrome', {
    tabs: { query: async () => [tab], create, sendMessage, onActivated: listeners, onUpdated: listeners },
    runtime: { getURL: (path: string) => 'chrome-extension://refpin/' + path, onMessage: listeners },
    storage: { local: { get: async () => ({}) }, session: { get: async () => ({}) } },
  });
  const fetch = vi.fn(), writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetch);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  function button(label: string) {
    const match = [...container.querySelectorAll('button')].find(el => el.textContent?.trim() === label || el.title === label);
    expect(match, label).toBeDefined();
    return match!;
  }
  async function click(el: HTMLElement) { await act(async () => el.click()); }
  try {
    await act(async () => root.render(createElement(SidePanelApp)));
    await click(button('Full Reader'));
    const target = new URL(create.mock.calls[0][0].url);
    expect(target.searchParams.get('url')).toBe(pdfUrl);
    expect(target.searchParams.get('title')).toBe('Paper');
    await click(button('Mention 1, Algorithm 2'));
    expect(sendMessage).toHaveBeenCalledWith(6, { type: 'REFPIN_SCROLL_TO_ANCHOR', anchorId: 'cite' });
    const algorithmCard = [...container.querySelectorAll('button')].find(el => el.textContent?.trim() === 'Pin'
      && el.closest('div.shadow-paper')?.textContent?.includes('Rank candidates'));
    await click(algorithmCard!);
    await click(button('Pins1'));
    expect(container.textContent).toContain('Rank candidates');
    // Clearing is undoable from the toast.
    await click(button('Clear all pins'));
    expect(container.textContent).not.toContain('Rank candidates');
    await click(button('Undo'));
    expect(container.textContent).toContain('Rank candidates');
    await click(button('Mention 1, Algorithm 2'));
    await click(button('Outline1'));
    await click(button('1 Introduction'));
    expect(sendMessage).toHaveBeenCalledWith(6, { type: 'REFPIN_SCROLL_TO_ANCHOR', anchorId: 'intro' });
    await click(button('Glossary1'));
    await click(button('Go to definition ↗'));
    expect(sendMessage).toHaveBeenCalledWith(6, { type: 'REFPIN_SCROLL_TO_ANCHOR', anchorId: 'def' });
    await click(container.querySelector('summary')!);
    await click(button('Copy Markdown'));
    const markdown = writeText.mock.lastCall![0];
    expect(markdown).toContain('Algorithm 2');
    expect(markdown).toContain('Multi-Head Attention');
    expect(markdown).not.toContain('P.0');
    // The public translation channel asks once before any text is sent from the page.
    localStorage.removeItem('refpin.freeTranslateConsent.v1');
    await click(button('Translate'));
    expect(container.textContent).toContain('Use the public translation service?');
    expect(sendMessage).not.toHaveBeenCalledWith(6, expect.objectContaining({ type: 'REFPIN_PAGE_TRANSLATE_START' }));
    await click(button('Continue'));
    expect(sendMessage).toHaveBeenCalledWith(6, { type: 'REFPIN_PAGE_TRANSLATE_START', displayMode: 'translated' });
    expect(container.textContent).not.toContain('Use the public translation service?');
    // Theme lives in the overflow menu now.
    await click(button('Settings'));
    await click(button('Dark'));
    expect(localStorage.getItem('refpin.theme.v1')).toBe('dark');
    localStorage.setItem('refpin.theme.v1', 'sepia');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'refpin.theme.v1', storageArea: localStorage })); });
    expect(document.documentElement.dataset.theme).toBe('sepia');
    expect(useReaderStore.getState().scholarLookupEnabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    vi.unstubAllGlobals();
  }
});
