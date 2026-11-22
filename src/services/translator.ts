import type { LocalizedMessage } from '../i18n/types';
import { IS_EXTENSION_PAGE } from '../config/runtime';
import { LocalizedError, message } from '../i18n/core';
import { normalizePdfGlyphs } from '../utils/textCleanup';

export type TranslateProvider = 'free' | 'openai';
export type TranslateTargetLang = 'zh-CN' | 'en';
export type TranslateDisplayMode = 'off' | 'bilingual' | 'translated';

export interface TranslateConfig {
  provider: TranslateProvider;
  targetLang: TranslateTargetLang;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

// The no-setup provider sends paragraphs to a third-party service, so readers acknowledge that once.
const FREE_CONSENT_KEY = 'refpin.freeTranslateConsent.v1';

/** A custom endpoint without a key falls back to the free channel unless it is a local model server. */
export function usesFreeTranslateChannel(config: Pick<TranslateConfig, 'provider' | 'apiKey' | 'apiBaseUrl'>): boolean {
  return config.provider === 'free' ||
    (!config.apiKey && !/^http:\/\/(?:localhost|127\.0\.0\.1)\b/i.test(config.apiBaseUrl));
}

export function needsFreeTranslateConsent(config: TranslateConfig): boolean {
  if (!usesFreeTranslateChannel(config)) return false;
  try { return localStorage.getItem(FREE_CONSENT_KEY) !== '1'; } catch { return true; }
}

export function grantFreeTranslateConsent(): void {
  try { localStorage.setItem(FREE_CONSENT_KEY, '1'); } catch { /* Ask again next session. */ }
}

export const DEFAULT_TRANSLATE_CONFIG: TranslateConfig = {
  provider: 'free',
  targetLang: 'zh-CN',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export const WEB_TRANSLATE_CONFIG: TranslateConfig = {
  ...DEFAULT_TRANSLATE_CONFIG,
  provider: 'openai',
  apiBaseUrl: '',
  model: '',
};

export const TRANSLATE_PRESETS = [
  { id: 'ollama', labelKey: 'translate.presetOllama', apiBaseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  { id: 'deepseek', labelKey: 'translate.presetDeepseek', apiBaseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'siliconflow', labelKey: 'translate.presetSiliconflow', apiBaseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'openai', labelKey: 'translate.presetOpenai', apiBaseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
] as const;

export interface TranslateConfigStorage {
  read(): Promise<Partial<TranslateConfig> | undefined>;
  write(config: TranslateConfig): Promise<void>;
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });
}

export function sanitizeSourceText(raw: string): string {
  return normalizePdfGlyphs(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitTextForFreeLimit(text: string, maxChars = 420): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!?。！？；;])\s+/u).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const pushOversized = (segment: string) => {
    let rest = segment.trim();
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut < Math.floor(maxChars * 0.4)) cut = maxChars;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) current = rest;
  };

  for (const sentence of sentences) {
    if (!current) {
      if (sentence.length <= maxChars) current = sentence;
      else pushOversized(sentence);
      continue;
    }
    const candidate = `${current} ${sentence}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      chunks.push(current);
      current = '';
      if (sentence.length <= maxChars) current = sentence;
      else pushOversized(sentence);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 7000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function translateBatchOpenAI(
  texts: string[],
  config: TranslateConfig,
  allowPlainText: boolean,
): Promise<string[]> {
  const base = new URL(config.apiBaseUrl);
  if (!['https:', 'http:'].includes(base.protocol)) throw new LocalizedError(message('translate.invalidProtocol'));
  const path = base.pathname.replace(/\/+$/, '');
  base.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
  const endpoint = base.toString();
  const targetName = config.targetLang === 'zh-CN' ? 'Simplified Chinese' : 'English';

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              `You are a precise academic paper translator. Translate each string in the JSON array into natural, scholarly ${targetName}. ` +
              'Keep placeholders like [[M0]], citation numbers like [14], and labels like Fig. 2 unchanged. ' +
              'Return ONLY a valid JSON array of strings with the exact same length and order.',
          },
          {
            role: 'user',
            content: JSON.stringify(texts),
          },
        ],
      }),
    },
    25_000,
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const reason = message('translate.httpError', { provider: 'API', status: response.status });
    throw new LocalizedError({ ...reason, detail: errText.slice(0, 120) });
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = data.choices?.[0]?.message?.content?.trim() || '';
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Small local models may return a single translation without the array wrapper.
  if (allowPlainText && texts.length === 1 && cleaned && !/^[\[{"`]/.test(cleaned)) return [cleaned];
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new LocalizedError(message('translate.invalidResponse'));
  }

  return parsed.map((entry) => String(entry ?? '').trim());
}

interface BrowserTranslatorInstance {
  translate(text: string): Promise<string>;
}
interface BrowserTranslatorStatic {
  availability?(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create?(options: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslatorInstance>;
}

let extBridgeUnavailableUntil = 0;
let googleGtxCooldownUntil = 0;

export function resetWebFreeState() {
  extBridgeUnavailableUntil = 0;
  googleGtxCooldownUntil = 0;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !IS_EXTENSION_PAGE) {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source === window && event.data?.source === 'refpin-extension' && event.data?.type === 'REFPIN_EXT_READY') {
      extBridgeUnavailableUntil = 0;
    }
  });
}

function requestExtensionBridge(
  payload: Record<string, unknown>,
  expectedType: string,
  timeoutMs: number,
): Promise<{ ok: boolean; translations?: string[] }> {
  return new Promise((resolve) => {
    if (
      IS_EXTENSION_PAGE ||
      typeof window === 'undefined' ||
      typeof window.postMessage !== 'function' ||
      typeof window.addEventListener !== 'function' ||
      typeof location === 'undefined'
    ) {
      resolve({ ok: false });
      return;
    }
    const origin = location.origin && location.origin !== 'null' ? location.origin : '*';
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || data?.source !== 'refpin-extension') return;
      if (data.type !== expectedType || data.requestId !== requestId) return;
      cleanup();
      resolve(data as { ok: boolean; translations?: string[] });
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false });
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ ...payload, source: 'refpin-web', type: expectedType, requestId }, origin);
  });
}

async function tryTranslateViaExtensionBridge(
  texts: string[],
  targetLang: TranslateTargetLang,
): Promise<string[] | null> {
  if (Date.now() < extBridgeUnavailableUntil) return null;
  const ping = await requestExtensionBridge({}, 'REFPIN_EXT_PING', 180);
  if (!ping.ok) {
    extBridgeUnavailableUntil = Date.now() + 30_000;
    return null;
  }
  const reply = await requestExtensionBridge({ texts, targetLang }, 'REFPIN_EXT_TRANSLATE', 12_000);
  if (reply.ok && Array.isArray(reply.translations) && reply.translations.length === texts.length) {
    return reply.translations;
  }
  return null;
}

async function tryTranslateViaBrowserNative(
  texts: string[],
  targetLang: TranslateTargetLang,
): Promise<string[] | null> {
  const api = (globalThis as { Translator?: BrowserTranslatorStatic }).Translator;
  if (!api?.availability || !api?.create) return null;
  const sourceLanguage = targetLang === 'zh-CN' ? 'en' : 'zh';
  const targetLanguage = targetLang === 'zh-CN' ? 'zh' : 'en';
  try {
    const status = await api.availability({ sourceLanguage, targetLanguage });
    if (status !== 'available') return null;
    const instance = await api.create({ sourceLanguage, targetLanguage });
    const results: string[] = [];
    for (const text of texts) {
      results.push((await instance.translate(text)).trim() || text);
    }
    return results;
  } catch {
    return null;
  }
}

export async function translateSingleViaGoogleGtx(
  text: string,
  targetLang: TranslateTargetLang,
  timeoutMs = 3800,
): Promise<string> {
  const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
    targetLang,
  )}&dt=t&ie=UTF-8&oe=UTF-8`;

  const body = new URLSearchParams();
  body.set('q', text);

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body.toString(),
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw new LocalizedError(message('translate.httpError', { provider: 'Google Translate', status: response.status }));
  }

  const buffer = await response.arrayBuffer();
  const decoded = new TextDecoder('utf-8').decode(buffer);
  const data = JSON.parse(decoded) as unknown[];
  const segments = Array.isArray(data?.[0]) ? (data[0] as unknown[]) : [];
  const translated = segments
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('')
    .trim();

  if (!translated) {
    throw new LocalizedError(message('translate.emptyResponse'));
  }
  return decodeHtmlEntities(translated);
}

function isAlreadyTargetLanguage(text: string, targetLang: TranslateTargetLang): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (targetLang === 'zh-CN') return cjk > 0 && cjk >= latin * 1.5;
  return cjk === 0 && latin > 0;
}

export async function translateSingleViaMyMemory(
  text: string,
  targetLang: TranslateTargetLang,
): Promise<string> {
  if (isAlreadyTargetLanguage(text, targetLang)) return text;
  const chunks = splitTextForFreeLimit(text, 420);
  if (!chunks.length) return '';

  const pair = targetLang === 'zh-CN' ? 'en|zh-CN' : 'zh-CN|en';
  const joiner = targetLang === 'zh-CN' ? '' : ' ';
  const outputs: string[] = [];

  for (const chunk of chunks) {
    if (isAlreadyTargetLanguage(chunk, targetLang)) {
      outputs.push(chunk);
      continue;
    }
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      chunk,
    )}&langpair=${encodeURIComponent(pair)}`;
    const response = await fetchWithTimeout(url, {}, 7000);
    if (!response.ok) {
      throw new LocalizedError(message('translate.httpError', { provider: 'MyMemory', status: response.status }));
    }
    const data = (await response.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    const translated = data?.responseData?.translatedText?.trim() || '';
    if (
      !translated ||
      /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE|PLEASE SELECT TWO DISTINCT/i.test(translated)
    ) {
      throw new LocalizedError(message('translate.freeLimit'));
    }
    outputs.push(decodeHtmlEntities(translated));
  }

  return outputs.join(joiner).trim();
}

export async function translateBatchWebFree(
  texts: string[],
  targetLang: TranslateTargetLang,
): Promise<string[]> {
  // 1) 若当前浏览器安装了 RefPin 扩展，优先通过安全桥接走无跨域限制的批量通道
  const bridged = await tryTranslateViaExtensionBridge(texts, targetLang);
  if (bridged) return bridged;

  // 2) 若浏览器内置本地离线 Translator AI 已就绪，直接本机离线翻译
  const localTranslated = await tryTranslateViaBrowserNative(texts, targetLang);
  if (localTranslated) return localTranslated;

  // 3) 纯网页 CORS 公共免费通道（Google GTX 优先，网络不可达时熔断切分句 MyMemory）
  return Promise.all(
    texts.map(async (item) => {
      if (Date.now() >= googleGtxCooldownUntil) {
        try {
          return await translateSingleViaGoogleGtx(item, targetLang, 3800);
        } catch {
          googleGtxCooldownUntil = Date.now() + 180_000;
        }
      }
      return translateSingleViaMyMemory(item, targetLang);
    }),
  );
}

type FreeProvider = (texts: string[], language: TranslateTargetLang) => Promise<string[]>;

export function createTranslator(
  storage: TranslateConfigStorage,
  defaults: TranslateConfig = WEB_TRANSLATE_CONFIG,
  freeProvider?: FreeProvider,
) {
  const cache = new Map<string, string>();
  const listeners = new Set<(config: TranslateConfig) => void>();

  async function loadTranslateConfig(): Promise<TranslateConfig> {
    try {
      const saved = await storage.read();
      if (!saved) return { ...defaults };
      return {
        provider: freeProvider && saved.provider !== 'openai' ? 'free' : 'openai',
        targetLang: saved.targetLang === 'en' ? 'en' : 'zh-CN',
        apiBaseUrl: saved.apiBaseUrl?.trim() || defaults.apiBaseUrl,
        apiKey: saved.apiKey?.trim() || '',
        model: saved.model?.trim() || defaults.model,
      };
    } catch {
      return { ...defaults };
    }
  }

  async function saveTranslateConfig(config: TranslateConfig): Promise<void> {
    await storage.write(config);
    for (const listener of listeners) listener(config);
  }

  function subscribeConfig(listener: (config: TranslateConfig) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function translateTexts(texts: string[], overrideConfig?: Partial<TranslateConfig>) {
    const config = { ...(await loadTranslateConfig()), ...overrideConfig };
    const useFree = Boolean(freeProvider && usesFreeTranslateChannel(config));
    const source = texts.map(sanitizeSourceText);
    const keys = source.map((text) =>
      JSON.stringify([
        useFree ? 'free' : config.apiBaseUrl,
        useFree ? '' : config.model,
        config.targetLang,
        text,
      ]),
    );
    const missing = source.map((_, i) => i).filter((i) => source[i] && !cache.has(keys[i]));
    const outputs = keys.map((key) => cache.get(key) ?? '');
    if (!missing.length) return outputs;

    const batch = missing.map((i) => source[i]);
    if (!freeProvider && (!config.apiBaseUrl || !config.model)) {
      throw new LocalizedError(message('translate.missingConfig'));
    }
    if (!useFree && (!config.apiBaseUrl || !config.model)) {
      throw new LocalizedError(message('translate.missingConfig'));
    }
    const translated = useFree
      ? await freeProvider!(batch, config.targetLang)
      : await translateBatchOpenAI(batch, config, true);
    missing.forEach((index, pos) => {
      outputs[index] = translated[pos] || source[index];
      cache.set(keys[index], outputs[index]);
      if (cache.size > 1500) cache.delete(cache.keys().next().value!);
    });
    return outputs;
  }

  return {
    loadTranslateConfig,
    saveTranslateConfig,
    subscribeConfig,
    translateTexts,
  };
}

export const STORAGE_KEY_TRANSLATE_CONFIG = 'refpin_translate_config';
export const extensionConfigStorage: TranslateConfigStorage = {
  async read() {
    return (await chrome.storage.local.get(STORAGE_KEY_TRANSLATE_CONFIG))[
      STORAGE_KEY_TRANSLATE_CONFIG
    ] as Partial<TranslateConfig> | undefined;
  },
  async write(config) {
    await chrome.storage.local.set({ [STORAGE_KEY_TRANSLATE_CONFIG]: config });
  },
};

const webConfigKey = 'refpin.web.translate.v1';
export const webTranslator = createTranslator(
  {
    async read() {
      return JSON.parse(localStorage.getItem(webConfigKey) ?? 'null');
    },
    async write(config) {
      localStorage.setItem(webConfigKey, JSON.stringify(config));
    },
  },
  DEFAULT_TRANSLATE_CONFIG,
  translateBatchWebFree,
);

export const selectionTranslator = IS_EXTENSION_PAGE
  ? createTranslator(extensionConfigStorage, DEFAULT_TRANSLATE_CONFIG, async (texts, targetLang) => {
      const reply = await chrome.runtime.sendMessage<{
        ok: boolean;
        translations?: string[];
        error?: LocalizedMessage;
      }>({
        type: 'REFPIN_TRANSLATE_BATCH',
        texts,
        config: { provider: 'free', targetLang },
      });
      if (!reply?.ok || reply.translations?.length !== texts.length) {
        throw new LocalizedError(reply?.error ?? message('translate.requestFailed'));
      }
      return reply.translations;
    })
  : webTranslator;

export const readerTranslator = selectionTranslator;
