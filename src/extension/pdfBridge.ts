import { fetchPdfBytes, isBridgePdfUrl } from '../services/arxivFetch';

export const grantKey = (tabId: number) => 'refpin.readerGrant.' + tabId;
export const dismissedKey = (tabId: number) => 'refpin.badgeDismissed.' + tabId;

export async function trustedReader(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) return false;
  const url = new URL(sender.url);
  if (url.origin === 'https://xxxpixel-x.github.io' && /^\/RefPin(?:\/|$)/.test(url.pathname)) return true;
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^https?:$/.test(url.protocol)) return true;
  const key = grantKey(sender.tab.id);
  return url.protocol === 'https:' && (await chrome.storage.session.get(key))[key] === url.origin;
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
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== 'refpin-web' || typeof data.requestId !== 'string' || data.requestId.length > 80) return;
    const ping = data.type === 'REFPIN_EXT_PING';
    const isPdf = data.type === 'REFPIN_EXT_FETCH_PDF' && typeof data.url === 'string' && isBridgePdfUrl(data.url);
    const isTranslate =
      data.type === 'REFPIN_EXT_TRANSLATE' &&
      Array.isArray(data.texts) &&
      data.texts.length > 0 &&
      data.texts.length <= 20 &&
      data.texts.every((item: unknown) => typeof item === 'string' && item.length <= 6000) &&
      (data.targetLang === 'zh-CN' || data.targetLang === 'en');
    if (!ping && !isPdf && !isTranslate) return;
    const messagePayload = ping
      ? { type: 'REFPIN_READER_PING' }
      : isPdf
        ? { type: 'REFPIN_FETCH_REMOTE_PDF', url: data.url }
        : { type: 'REFPIN_WEB_TRANSLATE', texts: data.texts, targetLang: data.targetLang };
    const reply = await chrome.runtime
      .sendMessage<{ ok: boolean; base64?: string; translations?: string[] }>(messagePayload)
      .catch(() => ({ ok: false }));
    window.postMessage({ ...reply, source: 'refpin-extension', type: data.type, requestId: data.requestId }, location.origin);
  });
  window.postMessage({ source: 'refpin-extension', type: 'REFPIN_EXT_READY' }, location.origin);
}
