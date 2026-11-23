// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { expect, it, vi } from 'vitest';
import { PinnedCard } from '../../dock/PinnedCard';
import { HoverPeekCard } from '../HoverPeekCard';
import { ExplanationProvider } from '../ExplanationPanel';
import { cachePageLines } from '../../../engine/pageLinesCache';
import { t } from '../../../i18n/core';
import { DEFAULT_TRANSLATE_CONFIG, type TranslateConfig } from '../../../services/translator';
import { useReaderStore } from '../../../store/useReaderStore';
import type { InlineCitation, PaperAsset } from '../../../types/paper';

it('从预览卡跳转设置，征得同意后流式显示，钉板复用结果并跳到正文', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  const anchorEl = document.body.appendChild(document.createElement('button'));
  const doc = {} as PDFDocumentProxy;
  const rect = { x: 0.2, y: 0.5, width: 0.3, height: 0.02 };
  const asset: PaperAsset = { key: 'fig-1', kind: 'figure', label: 'Figure 1', caption: 'Figure 1. Model.', pageNumber: 1, cropRect: rect };
  const citation: InlineCitation = { kind: 'figure', id: 'c2', rawText: 'Fig. 1', rect, targetKeys: [asset.key], pageNumber: 2, lineY: 0.5 };
  const discussion = 'The authors compare both models in Fig. 1.';
  cachePageLines(doc, { 2: [{ text: discussion, pageNumber: 2, rect, baseline: 0.5, column: 'full', chars: [] }] });
  useReaderStore.setState({ pdfDoc: doc, paperHash: 'ui-paper', backlinksMap: {
    'fig-1': [{ citationId: 'c2', rawText: 'Fig. 1', rect, pageNumber: 2 }],
  } });
  const jump = vi.fn(), settings = vi.fn(), noop = () => {};
  const peek = createElement(HoverPeekCard, { trigger: { anchorEl, mention: citation, locked: true },
    assetsMap: { 'fig-1': asset }, referencesMap: {}, onPinAsset: noop, onPinReference: noop,
    onJump: jump, onOpenLightbox: noop, onPeek: noop });
  const pinned = createElement(PinnedCard, { item: { id: 'fig-1', kind: 'figure', title: asset.label, subtitle: asset.caption,
    pageNumber: 1, createdAt: 1 }, onJumpToBacklink: jump, onUnpin: noop, onToggleCollapse: noop, onJump: jump,
    onExpandCrop: noop, onOpenLightbox: noop, onRename: noop, onMove: noop });
  const render = async (config: TranslateConfig, pin = false) => act(async () => root.render(createElement(ExplanationProvider,
    { config, extensionSettings: null, onJump: jump, setSettingsOpen: settings, children: pin ? pinned : peek })));
  const click = async (label: string, within: ParentNode = document) => {
    const button = [...within.querySelectorAll('button')].find(b => b.textContent === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  };
  const remote: TranslateConfig = { ...DEFAULT_TRANSLATE_CONFIG, provider: 'openai', apiKey: 'test-secret',
    apiBaseUrl: 'https://test.example/v1' };
  try {
    await render(DEFAULT_TRANSLATE_CONFIG);
    await click(t('explain.configure'));
    expect(settings).toHaveBeenCalledWith(true);
    expect(document.body.textContent).not.toContain(t('explain.native'));
    await render(remote);
    await click(t('explain.action'));
    expect(document.querySelector('[role=dialog]')?.textContent).toContain(t('explain.consentBody'));
    await click(t('common.cancel'));
    expect(fetch).not.toHaveBeenCalled();
    await click(t('explain.action'));
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { writer = c; } })));
    await click(t('explain.allow'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content).toContain(discussion);
    const encoder = new TextEncoder();
    const send = async (data: string) => act(async () => writer.enqueue(encoder.encode(data)));
    await send('data: {"choices":[{"delta":{"content":"第一部分"}}]}\n\n');
    expect(document.querySelector('section p[lang]')?.textContent).toBe('第一部分');
    expect(document.body.textContent).toContain(t('explain.stop'));
    await send('data: {"choices":[{"delta":{"content":"和第二部分"}}]}\n\ndata: [DONE]\n\n');
    expect(document.body.textContent).toContain(t('explain.disclaimer'));
    await render(remote, true);
    await click(t('explain.action'));
    const section = document.querySelector('article section')!;
    expect(section.textContent).toContain('第一部分和第二部分');
    expect(fetch).toHaveBeenCalledOnce();
    await click(t('reader.page', { page: 2 }), section);
    expect(jump).toHaveBeenCalledWith(2, rect);
    // 切换目标语言会重新请求，并可在首个分片前停止。
    fetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));
    await render({ ...remote, targetLang: 'en' }, true);
    await click(t('explain.action'));
    await click(t('explain.stop'));
    expect(fetch.mock.lastCall?.[1].signal.aborted).toBe(true);
    expect(document.body.textContent).toContain(t('explain.stopped'));
  } finally {
    await act(async () => root.unmount());
    focus.mockRestore();
    vi.unstubAllGlobals();
    useReaderStore.setState({ pdfDoc: null, paperHash: null, backlinksMap: {} });
    document.body.replaceChildren();
  }
});
