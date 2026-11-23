// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TranslateControl } from '../../components/layout/TranslateControl';
import { t } from '../../i18n/core';
import { usePaperTranslation } from '../../services/usePaperTranslation';
import {
  DEFAULT_TRANSLATE_CONFIG, getExtensionTranslateSettings, resetWebFreeState, STORAGE_KEY_TRANSLATE_CONFIG,
  testExtensionTranslation, webTranslator, type TranslateConfig,
} from '../../services/translator';
import { installWebBridge } from '../pdfBridge';
import { streamExtensionExplanation } from '../../services/explanationBridge';
import type { ExtensionMessage } from '../protocol';

const extensionConfig: TranslateConfig = {
  provider: 'openai', targetLang: 'en', model: 'extension-model',
  apiBaseUrl: 'https://extension.example.test/v1', apiKey: 'private-extension-key',
};
const reader = { id: 'refpin', frameId: 0, tab: { id: 1 }, url: 'http://localhost:5173/' };
let sender: chrome.runtime.MessageSender;
let receive: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let receivePort: (port: chrome.runtime.Port) => void;

function connectPort({ name }: { name: string }): chrome.runtime.Port {
  let onRequest: (value: unknown) => void, onReply: (value: unknown) => void;
  const disconnects: Array<() => void> = [];
  const common = { name, sender, onDisconnect: { addListener: (callback: () => void) => disconnects.push(callback) },
    disconnect: () => disconnects.splice(0).forEach(fn => fn()) };
  receivePort({ ...common, onMessage: { addListener: cb => { onRequest = cb; } }, postMessage: value => onReply(value) });
  return { ...common, onMessage: { addListener: cb => { onReply = cb; } }, postMessage: value => onRequest(value) };
}
const sendMessage = vi.fn((request: ExtensionMessage) => new Promise(resolve => receive(request, sender, resolve)));
const readConfig = vi.fn(async () => ({ [STORAGE_KEY_TRANSLATE_CONFIG]: extensionConfig }));
const fetch = vi.fn<typeof globalThis.fetch>();
let grants: Record<string, string> = {};
const post = vi.spyOn(window, 'postMessage');

beforeAll(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetch);
  const listener = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    runtime: { id: reader.id, onInstalled: listener, sendMessage, connect: connectPort,
      onConnect: { addListener: (cb: typeof receivePort) => { receivePort = cb; } }, onMessage: {
      addListener: (callback: typeof receive) => { receive = callback; },
    } },
    storage: { local: { get: readConfig }, session: { get: async (key: string) => (key in grants ? { [key]: grants[key] } : {}) } },
    sidePanel: { setPanelBehavior: async () => {} },
    contextMenus: { removeAll: vi.fn(), onClicked: listener },
    tabs: { onRemoved: listener },
  });
  await import('../background');
  document.head.innerHTML = '<meta name="application-name" content="RefPin">';
  // 在 jsdom 中补齐浏览器为同窗口消息附带的来源信息。
  post.mockImplementation(data => queueMicrotask(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: window }));
  }));
  installWebBridge();
});

it('解释复用扩展配置，转发流式正文；停止时取消后台请求', async () => {
  const settings = await getExtensionTranslateSettings(await webTranslator.loadTranslateConfig());
  expect(settings?.explanationService).toBe('remote');
  const encoder = new TextEncoder();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  fetch.mockResolvedValue(new Response(new ReadableStream({ start(c) { writer = c; } })));
  const emit = vi.fn();
  const controller = new AbortController();
  const stream = streamExtensionExplanation('摘录', 'en', true, controller.signal, emit);
  writer.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"解释"}}]}\n\n'));
  await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('解释'));
  expect(fetch.mock.lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer ' + extensionConfig.apiKey });
  expect(JSON.stringify(post.mock.calls)).not.toContain(extensionConfig.apiKey);
  controller.abort();
  await expect(stream).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch.mock.lastCall?.[1]?.signal?.aborted).toBe(true);
  writer.close();
});

it('解释桥接拒绝未同意的远端请求、未经授权的密钥使用及非受信任来源', async () => {
  const request = (allowRemote = true) => streamExtensionExplanation('摘录', 'en', allowRemote,
    new AbortController().signal, vi.fn());
  await expect(request(false)).rejects.toMatchObject({ uiMessage: { key: 'explain.consentTitle' } });
  grants = {};
  await expect(request()).rejects.toMatchObject({ uiMessage: { key: 'explain.configure' } });
  sender = { ...reader, frameId: 1 };
  readConfig.mockClear();
  await expect(request()).rejects.toMatchObject({ uiMessage: { key: 'translate.requestFailed' } });
  expect(readConfig).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

beforeEach(() => {
  resetWebFreeState();
  vi.clearAllMocks();
  localStorage.clear();
  fetch.mockReset();
  sender = reader;
  grants = { 'refpin.readerGrant.1': 'http://localhost:5173' };
});
afterAll(() => { post.mockRestore(); vi.unstubAllGlobals(); });

it('网页默认配置沿用扩展端点、模型、密钥和目标语言，保存网页自定义配置后立即切换', async () => {
  const settings = await getExtensionTranslateSettings(await webTranslator.loadTranslateConfig());
  expect(settings?.summary).toEqual({
    provider: 'openai', targetLang: 'en', model: 'extension-model', hasApiKey: true,
  });
  fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Translated selection' } }] }));
  expect(await webTranslator.translateTexts(['选文'])).toEqual(['Translated selection']);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(extensionConfig.apiBaseUrl + '/chat/completions');
  expect(init?.headers).toMatchObject({ Authorization: 'Bearer ' + extensionConfig.apiKey });
  const body = JSON.parse(String(init?.body));
  expect(body.model).toBe('extension-model');
  expect(body.messages[0].content).toContain('English');
  expect(JSON.stringify(post.mock.calls)).not.toContain(extensionConfig.apiKey);
  expect(JSON.stringify(post.mock.calls)).not.toContain(extensionConfig.apiBaseUrl);
  expect(localStorage.getItem('refpin.web.translate.v1')).toBeNull();

  await webTranslator.saveTranslateConfig({
    ...DEFAULT_TRANSLATE_CONFIG, provider: 'openai', model: 'local-model', apiBaseUrl: 'http://localhost:11434/v1',
  });
  post.mockClear();
  fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '本机译文' } }] }));
  expect(await webTranslator.translateTexts(['选文'])).toEqual(['本机译文']);
  expect(fetch.mock.lastCall?.[0]).toBe('http://localhost:11434/v1/chat/completions');
  expect(post).not.toHaveBeenCalled();
});

it('非受信任网页和子框架都无法查询摘要或调用扩展翻译', async () => {
  for (sender of [{ ...reader, frameId: 1 }, { ...reader, url: 'https://other.example/' }]) {
    expect(await sendMessage({ type: 'REFPIN_WEB_TRANSLATE_CONFIG' })).toEqual({ ok: false });
    expect(await sendMessage({ type: 'REFPIN_WEB_TRANSLATE', texts: ['选文'], allowFreeChannel: true }))
      .toEqual({ ok: false });
  }
  expect(readConfig).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('继承模式下测试固定短句，不保存设置或返回上游错误正文', async () => {
  fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'A test sentence.' } }] }));
  await testExtensionTranslation();
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).messages[1].content).toBe('["这是一句测试文本。"]');
  fetch.mockResolvedValueOnce(new Response('Rejected ' + extensionConfig.apiKey, { status: 401 }));
  await expect(testExtensionTranslation()).rejects.toMatchObject({
    uiMessage: { key: 'translate.httpError', params: { provider: 'API', status: 401 } },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(post.mock.calls)).not.toContain(extensionConfig.apiKey);
});

it('上游把密钥回显在成功响应时拒绝译文，网页不会再向公共通道重发选文', async () => {
  fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: extensionConfig.apiKey } }] }));
  await expect(webTranslator.translateTexts(['敏感选文'])).rejects.toMatchObject({
    uiMessage: { key: 'translate.invalidResponse' },
  });
  expect(JSON.stringify(post.mock.calls)).not.toContain(extensionConfig.apiKey);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('设置面板展示继承摘要，允许独立编辑并在保存后采用网页配置', async () => {
  function Harness() {
    return createElement(TranslateControl, { translation: usePaperTranslation(null, 0, 0, new Set()), numPages: 0 });
  }
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(el => el.textContent === label || el.title === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () => root.render(createElement(Harness)));
    await click(t('translate.settings'));
    expect(container.textContent).toContain(t('translate.extensionSettings', {
      provider: t('translate.custom'), model: extensionConfig.model,
    }));
    expect(container.querySelector('input[type=password]')).toBeNull();
    fetch.mockResolvedValueOnce(new Response(extensionConfig.apiKey, { status: 403 }));
    await click(t('translate.testConnection'));
    expect(container.querySelector('[role=status]')?.textContent).toContain('403');
    expect(container.textContent).not.toContain(extensionConfig.apiKey);
    await click(t('translate.configureHere'));
    expect(container.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('');
    expect(localStorage.getItem('refpin.web.translate.v1')).toBeNull();
    await click(t('translate.presetOllama'));
    await click(t('settings.save'));
    await click(t('translate.settings'));
    expect(container.textContent).not.toContain(extensionConfig.model);
    expect(container.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe('http://localhost:11434/v1');
    expect((await webTranslator.loadTranslateConfig()).provider).toBe('openai');
  } finally {
    await act(async () => root.unmount());
  }
});

it('未经右键授权的本机页面不能花扩展里的密钥额度，只能走公共通道并先征得同意', async () => {
  grants = {};
  const settings = await getExtensionTranslateSettings(await webTranslator.loadTranslateConfig());
  expect(settings).toEqual({
    summary: { provider: 'free', targetLang: 'en', model: DEFAULT_TRANSLATE_CONFIG.model, hasApiKey: false },
    usesFreeChannel: true,
  });
  await expect(webTranslator.translateTexts(['选文'])).rejects.toMatchObject({
    uiMessage: { key: 'translate.freeConsentRequired' },
  });
  await testExtensionTranslation().catch(() => {});
  expect(fetch.mock.calls.some(([url]) => String(url).startsWith(extensionConfig.apiBaseUrl))).toBe(false);
  // 授权给别的来源不算数。
  grants = { 'refpin.readerGrant.1': 'http://localhost:8080' };
  resetWebFreeState();
  expect((await getExtensionTranslateSettings(await webTranslator.loadTranslateConfig()))?.summary.hasApiKey).toBe(false);
});
