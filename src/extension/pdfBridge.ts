import { fetchPdfBytes, isBridgePdfUrl } from '../services/arxivFetch';
import { MAX_BRIDGE_TEXT_LENGTH, MAX_BRIDGE_TEXTS, type TranslateBridgeReply } from '../services/translator';
import type { ExtensionMessage } from './protocol';
import { MAX_CONTEXT_LENGTH } from '../services/explainer';

export const grantKey = (tabId: number) => 'refpin.readerGrant.' + tabId;
export const dismissedKey = (tabId: number) => 'refpin.badgeDismissed.' + tabId;

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^https?:$/.test(url.protocol);
const isOfficialReader = (url: URL) => url.origin === 'https://xxxpixel-x.github.io' && /^\/RefPin(?:\/|$)/.test(url.pathname);

async function hasTabGrant(tabId: number, url: URL) {
  const key = grantKey(tabId);
  return (await chrome.storage.session.get(key))[key] === url.origin;
}

/** 右键菜单可授权的标签页：自托管 HTTPS 阅读器，以及本机开发服务器。 */
export function canGrantReader(tabUrl: string | undefined): boolean {
  if (!tabUrl) return false;
  try {
    const url = new URL(tabUrl);
    return url.protocol === 'https:' || isLoopback(url);
  } catch {
    return false;
  }
}

export async function trustedReader(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) return false;
  const url = new URL(sender.url);
  if (isOfficialReader(url) || isLoopback(url)) return true;
  return url.protocol === 'https:' && await hasTabGrant(sender.tab.id, url);
}

/**
 * 本机任意端口都被视为受信任阅读器，但本机上可能跑着别的程序。
 * 会消耗用户 API 密钥额度的请求只对官方阅读器和用户右键授权过的标签页开放。
 */
export async function canSpendSavedApiKey(sender: chrome.runtime.MessageSender) {
  if (!await trustedReader(sender)) return false;
  const url = new URL(sender.url!);
  return isOfficialReader(url) || await hasTabGrant(sender.tab!.id!, url);
}

const inFlight = new Set<number>();
export async function handleBridge(sender: chrome.runtime.MessageSender, url?: string) {
  if (!await trustedReader(sender)) return { ok: false };
  if (url === undefined) return { ok: true };
  const id = sender.tab!.id!;
  if (typeof url !== 'string' || !isBridgePdfUrl(url) || inFlight.has(id)) return { ok: false };
  inFlight.add(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const bytes = await fetchPdfBytes(url, controller.signal);
    const chunks: string[] = [];
    // Multiples of three keep base64 padding confined to the last chunk.
    for (let offset = 0; offset < bytes.length; offset += 24576) {
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
    }
    return { ok: true, base64: chunks.join('') };
  } finally { clearTimeout(timer); inFlight.delete(id); }
}

export function installWebBridge() {
  if (window !== window.top || !document.querySelector('meta[name="application-name"][content="RefPin"]')) return;
  const streams = new Map<string, chrome.runtime.Port>();
  window.addEventListener('pagehide', () => {
    for (const port of streams.values()) port.disconnect();
    streams.clear();
  });
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== 'refpin-web' || typeof data.requestId !== 'string' || data.requestId.length > 80) return;
    if (data.type === 'REFPIN_EXT_EXPLAIN_STOP') {
      streams.get(data.requestId)?.disconnect();
      streams.delete(data.requestId);
      return;
    }
    if (data.type === 'REFPIN_EXT_EXPLAIN') {
      if (streams.has(data.requestId) || typeof data.text !== 'string' || !data.text.trim() ||
          data.text.length > MAX_CONTEXT_LENGTH || !['en', 'zh-CN'].includes(data.targetLang)) return;
      const reply = (payload: unknown) => window.postMessage({
        source: 'refpin-extension', type: data.type, requestId: data.requestId, payload,
      }, location.origin);
      try {
        const port = chrome.runtime.connect({ name: 'REFPIN_WEB_EXPLAIN' });
        streams.set(data.requestId, port);
        port.onMessage.addListener(reply);
        port.onDisconnect.addListener(() => {
          streams.delete(data.requestId);
          reply({ disconnected: true });
        });
        port.postMessage({ type: 'REFPIN_WEB_EXPLAIN', text: data.text, targetLang: data.targetLang,
          allowRemote: data.allowRemote === true } satisfies ExtensionMessage);
      } catch { streams.delete(data.requestId); reply({ disconnected: true }); }
      return;
    }
    const ping = data.type === 'REFPIN_EXT_PING';
    const isConfig = data.type === 'REFPIN_EXT_TRANSLATE_CONFIG';
    const isPdf = data.type === 'REFPIN_EXT_FETCH_PDF' && typeof data.url === 'string' && isBridgePdfUrl(data.url);
    const isTranslate =
      data.type === 'REFPIN_EXT_TRANSLATE' &&
      Array.isArray(data.texts) &&
      (data.texts.length > 0 || data.connectionTest === true) &&
      data.texts.length <= MAX_BRIDGE_TEXTS &&
      data.texts.every((item: unknown) => typeof item === 'string' && item.length <= MAX_BRIDGE_TEXT_LENGTH);
    let messagePayload: ExtensionMessage;
    if (ping) messagePayload = { type: 'REFPIN_READER_PING' };
    else if (isPdf) messagePayload = { type: 'REFPIN_FETCH_REMOTE_PDF', url: data.url };
    else if (isConfig) messagePayload = { type: 'REFPIN_WEB_TRANSLATE_CONFIG' };
    else if (isTranslate) messagePayload = {
      type: 'REFPIN_WEB_TRANSLATE', texts: data.texts,
      connectionTest: data.connectionTest === true, allowFreeChannel: data.allowFreeChannel === true,
    };
    else return;
    type BridgeReply = TranslateBridgeReply & { base64?: string };
    const reply = await chrome.runtime.sendMessage<BridgeReply>(messagePayload)
      .catch((): BridgeReply => ({ ok: false }));
    const response: BridgeReply = { ok: reply.ok };
    if (!reply.ok) {
      response.error = reply.error;
    } else if (isConfig && reply.summary) {
      const { provider, model, targetLang, hasApiKey } = reply.summary;
      response.summary = { provider, model, targetLang, hasApiKey };
      response.usesFreeChannel = reply.usesFreeChannel;
      if (reply.explanationService) response.explanationService = reply.explanationService;
    } else if (isPdf) {
      response.base64 = reply.base64;
    } else if (isTranslate) {
      response.translations = reply.translations;
    }
    window.postMessage({ ...response, source: 'refpin-extension', type: data.type, requestId: data.requestId }, location.origin);
  });
  window.postMessage({ source: 'refpin-extension', type: 'REFPIN_EXT_READY' }, location.origin);
}
