import { IS_EXTENSION_PAGE } from '../config/runtime';
import { LocalizedError, message } from '../i18n/core';

export interface PaperLocation { pdfUrl: string; displayName: string; canonicalAbsUrl?: string }
const arxivId = /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7})(?:v[1-9]\d*)?$/i;
// Base64-encoded extension messages must also fit Chromium's 64 MiB message ceiling.
export const MAX_REMOTE_PDF_BYTES = 40 * 1024 * 1024;

export function publicHttpsUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(host) ||
        /(?:^|\.)(?:localhost|local|internal|lan|home|arpa|test|invalid)$/i.test(host)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

export function extensionPdfUrl(input: string) {
  try {
    const url = new URL(input);
    if (IS_EXTENSION_PAGE && url.protocol === 'blob:' && url.href.startsWith('blob:' + window.location.origin + '/')) return url;
    if (['http:', 'https:', 'file:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch { /* Not an absolute PDF address. */ }
  return null;
}

function fromId(id: string): PaperLocation | null {
  if (!arxivId.test(id)) return null;
  return { pdfUrl: 'https://arxiv.org/pdf/' + id, displayName: 'arXiv-' + id.replace('/', '-') + '.pdf',
    canonicalAbsUrl: 'https://arxiv.org/abs/' + id };
}

export function parsePaperLocation(input: string): PaperLocation | null {
  const text = input.trim().replace(/^arxiv:\s*/i, '');
  if (arxivId.test(text)) return fromId(text);
  const url = IS_EXTENSION_PAGE ? extensionPdfUrl(text) : publicHttpsUrl(text);
  if (!url) return null;
  if (/^(?:www\.|export\.)?arxiv\.org$/.test(url.hostname)) {
    const id = /^\/(?:abs|pdf)\/(.+?)\/?$/i.exec(url.pathname)?.[1].replace(/\.pdf$/i, '');
    return id ? fromId(id) : null;
  }
  if (url.hostname === 'openreview.net' && /^\/(forum|pdf)$/.test(url.pathname)) {
    const id = url.searchParams.get('id');
    if (!id || !/^[\w-]+$/.test(id)) return null;
    return { pdfUrl: 'https://openreview.net/pdf?id=' + id, displayName: 'OpenReview-' + id + '.pdf',
      canonicalAbsUrl: 'https://openreview.net/forum?id=' + id };
  }
  if (!IS_EXTENSION_PAGE && !/\.pdf$/i.test(url.pathname)) return null;
  let filename = url.pathname.split('/').pop()!;
  try { filename = decodeURIComponent(filename); } catch { /* Keep the encoded name. */ }
  const name = filename.replace(/[/\\]/g, '-') || 'Paper';
  return { pdfUrl: url.href, displayName: /\.pdf$/i.test(name) ? name : name + '.pdf' };
}

// Privileged cross-origin fetches only target fixed public scholarly hosts.
// Other HTTPS PDFs can be opened directly under the browser's ordinary CORS rules.
export function isBridgePdfUrl(input: string): boolean {
  const url = publicHttpsUrl(input);
  if (!url) return false;
  if (url.hostname === 'arxiv.org' || url.hostname === 'export.arxiv.org') {
    return url.pathname.startsWith('/pdf/') && !!parsePaperLocation(input);
  }
  if (url.hostname === 'openreview.net') return url.pathname === '/pdf' && !!parsePaperLocation(input);
  return ['aclanthology.org', 'proceedings.mlr.press', 'openaccess.thecvf.com', 'proceedings.neurips.cc',
    'www.nature.com', 'link.springer.com', 'dl.acm.org', 'ieeexplore.ieee.org'].includes(url.hostname) &&
    /\.pdf$/i.test(url.pathname);
}

export function isPdfBytes(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45;
}

export async function fetchPdfBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_REMOTE_PDF_BYTES) {
    await response.body?.cancel();
    throw new Error('PDF unavailable');
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(5);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length < 5) header.set(value.subarray(0, 5 - length), length);
      length += value.length;
      if (length > MAX_REMOTE_PDF_BYTES || (length >= 5 && !isPdfBytes(header))) {
        await reader.cancel();
        throw new Error('Invalid PDF');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!isPdfBytes(header)) throw new Error('Invalid PDF');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

type BridgeReply = { ok: boolean; base64?: string };
function requestBridge(type: 'REFPIN_EXT_PING' | 'REFPIN_EXT_FETCH_PDF', url: string, signal: AbortSignal, timeout: number) {
  return new Promise<BridgeReply>((resolve, reject) => {
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const send = () => window.postMessage({ source: 'refpin-web', type, url, requestId }, location.origin);
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => { finish(); reject(signal.reason); };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || data?.source !== 'refpin-extension') return;
      if (type === 'REFPIN_EXT_PING' && data.type === 'REFPIN_EXT_READY') { send(); return; }
      if (data.type !== type || data.requestId !== requestId) return;
      finish();
      resolve(data);
    };
    const timer = setTimeout(() => { finish(); resolve({ ok: false }); }, timeout);
    signal.addEventListener('abort', abort, { once: true });
    window.addEventListener('message', receive);
    send();
  });
}

async function hasNativePdfHeader(blob: Blob) {
  // Some publishers prepend a BOM or short preamble ahead of the PDF header.
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  return header.some((byte, index) => byte === 37 && isPdfBytes(header.subarray(index)));
}

export async function openRemotePdf(paper: PaperLocation, signal: AbortSignal, proxyPrefix = ''): Promise<File> {
  if (IS_EXTENSION_PAGE) {
    const url = extensionPdfUrl(paper.pdfUrl);
    if (!url) throw new LocalizedError(message('remote.extensionInvalid'));
    let response: Response;
    try {
      response = await fetch(url.href, { signal, credentials: url.protocol === 'http:' || url.protocol === 'https:' ? 'include' : 'omit' });
    } catch (error) {
      signal.throwIfAborted();
      if (url.protocol === 'file:') throw new LocalizedError(message('panel.fileAccess'));
      throw error;
    }
    if (!response.ok) throw new LocalizedError(message('panel.fetchHttp', { status: response.status }));
    const blob = await response.blob();
    if (!await hasNativePdfHeader(blob)) {
      throw new LocalizedError(message('panel.invalidPdf'));
    }
    return new File([blob], paper.displayName, { type: 'application/pdf' });
  }
  if (!parsePaperLocation(paper.pdfUrl)) throw new Error('Invalid PDF address');
  if (!proxyPrefix && isBridgePdfUrl(paper.pdfUrl)) {
    const pong = await requestBridge('REFPIN_EXT_PING', '', signal, 800);
    if (pong.ok) {
      const reply = await requestBridge('REFPIN_EXT_FETCH_PDF', paper.pdfUrl, signal, 32000);
      if (reply.ok && typeof reply.base64 === 'string' && reply.base64.length <= Math.ceil(MAX_REMOTE_PDF_BYTES / 3) * 4) {
        const bytes = Uint8Array.from(atob(reply.base64), ch => ch.charCodeAt(0));
        if (isPdfBytes(bytes) && bytes.length <= MAX_REMOTE_PDF_BYTES) return new File([bytes], paper.displayName, { type: 'application/pdf' });
      }
    }
  }
  const url = proxyPrefix ? proxyPrefix + encodeURIComponent(paper.pdfUrl) : paper.pdfUrl;
  if (!publicHttpsUrl(url)) throw new Error('Invalid PDF address');
  const bytes = await fetchPdfBytes(url, signal);
  return new File([bytes], paper.displayName, { type: 'application/pdf' });
}
