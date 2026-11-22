import { normalizePdfGlyphs } from '../utils/textCleanup';

export type TranslateProvider = 'free' | 'openai';
export type TranslateTargetLang = 'zh-CN' | 'en';

export interface TranslateConfig {
  provider: TranslateProvider;
  targetLang: TranslateTargetLang;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
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

export interface TranslateConfigStorage {
  read(): Promise<Partial<TranslateConfig> | undefined>;
  write(config: TranslateConfig): Promise<void>;
}

export function sanitizeSourceText(raw: string): string {
  return normalizePdfGlyphs(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('端点需要使用 HTTP 或 HTTPS');
  const path = base.pathname.replace(/\/+$/, '');
  base.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
  const endpoint = base.toString();
  const targetName = config.targetLang === 'zh-CN' ? '简体中文' : 'English';

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
    throw new Error(`API HTTP ${response.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
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
    throw new Error('模型返回格式不匹配');
  }

  return parsed.map((entry) => String(entry ?? '').trim());
}

type FreeProvider = (texts: string[], language: TranslateTargetLang) => Promise<string[]>;

export function createTranslator(
  storage: TranslateConfigStorage,
  defaults: TranslateConfig = WEB_TRANSLATE_CONFIG,
  freeProvider?: FreeProvider,
) {
  const cache = new Map<string, string>();

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

  async function translateTexts(texts: string[], overrideConfig?: Partial<TranslateConfig>) {
    const config = { ...await loadTranslateConfig(), ...overrideConfig };
    const useFree = freeProvider && (config.provider === 'free' || !config.apiKey);
    const source = texts.map(sanitizeSourceText);
    const keys = source.map(text => JSON.stringify([
      useFree ? 'free' : config.apiBaseUrl, useFree ? '' : config.model, config.targetLang, text,
    ]));
    const missing = source.map((_, i) => i).filter(i => source[i] && !cache.has(keys[i]));
    const outputs = keys.map(key => cache.get(key) ?? '');
    if (!missing.length) return outputs;

    const batch = missing.map(i => source[i]);
    if (!freeProvider && (!config.apiBaseUrl || !config.model)) throw new Error('请先配置翻译端点和模型');
    const translated = useFree
      ? await freeProvider(batch, config.targetLang)
      : await translateBatchOpenAI(batch, config, !freeProvider);
    missing.forEach((index, pos) => {
      outputs[index] = translated[pos] || source[index];
      cache.set(keys[index], outputs[index]);
      if (cache.size > 1500) cache.delete(cache.keys().next().value!);
    });
    return outputs;
  }

  return {
    loadTranslateConfig,
    saveTranslateConfig: (config: TranslateConfig) => storage.write(config),
    translateTexts,
  };
}

const webConfigKey = 'refpin.web.translate.v1';
export const webTranslator = createTranslator({
  async read() {
    return JSON.parse(localStorage.getItem(webConfigKey) ?? 'null');
  },
  async write(config) {
    localStorage.setItem(webConfigKey, JSON.stringify(config));
  },
});
