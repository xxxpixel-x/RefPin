import { LocalizedError, message } from '../i18n/core';
import { createTranslator, DEFAULT_TRANSLATE_CONFIG, fetchWithTimeout, type TranslateTargetLang } from '../services/translator';
import { STORAGE_KEY_TRANSLATE_CONFIG, type TranslateConfig } from './protocol';

export { sanitizeSourceText } from '../services/translator';

let cachedEdgeToken: { token: string; expiresAt: number } | null = null;

function decodeHtmlEntities(input: string): string {
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

async function getEdgeAuthToken(): Promise<string> {
  const now = Date.now();
  if (cachedEdgeToken && cachedEdgeToken.expiresAt > now) {
    return cachedEdgeToken.token;
  }
  const resp = await fetchWithTimeout('https://edge.microsoft.com/translate/auth', {}, 5000);
  if (!resp.ok) {
    throw new LocalizedError(message('translate.httpError', { provider: 'Edge auth', status: resp.status }));
  }
  const token = (await resp.text()).trim();
  if (!token || token.length < 20) {
    throw new LocalizedError(message('translate.invalidToken'));
  }
  cachedEdgeToken = { token, expiresAt: now + 7 * 60 * 1000 };
  return token;
}

/**
 * 主免费通道：Microsoft Edge 翻译（原生 JSON 批量数组、纯 UTF-8、无分隔符污染、国内外直连稳定）
 */
async function translateBatchViaEdge(
  texts: string[],
  targetLang: TranslateTargetLang,
): Promise<string[]> {
  const token = await getEdgeAuthToken();
  const toLang = targetLang === 'zh-CN' ? 'zh-Hans' : 'en';
  const endpoint = `https://api-edge.cognitive.microsofttranslator.com/translate?from=&to=${encodeURIComponent(
    toLang,
  )}&api-version=3.0`;

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(texts.map((text) => ({ Text: text }))),
    },
    9000,
  );

  if (resp.status === 401 || resp.status === 403) {
    cachedEdgeToken = null;
  }
  if (!resp.ok) {
    throw new LocalizedError(message('translate.httpError', { provider: 'Edge translate', status: resp.status }));
  }

  const data = (await resp.json()) as Array<{
    translations?: Array<{ text?: string }>;
  }>;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new LocalizedError(message('translate.invalidResponse'));
  }

  return data.map((item, idx) => {
    const out = item?.translations?.[0]?.text?.trim();
    return out ? decodeHtmlEntities(out) : texts[idx];
  });
}

/**
 * 备用通道 1：Google Translate（逐条并发 POST，避免超长 URL 截断与分隔符乱码）
 */
async function translateSingleViaGoogle(
  text: string,
  targetLang: TranslateTargetLang,
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
    7000,
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

/**
 * 备用通道 2：MyMemory（严格过滤错误提示与 HTML 实体）
 */
async function translateSingleViaMyMemory(
  text: string,
  targetLang: TranslateTargetLang,
): Promise<string> {
  const pair = targetLang === 'zh-CN' ? 'en|zh-CN' : 'zh-CN|en';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    text.slice(0, 450),
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
    /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE/i.test(translated)
  ) {
    throw new LocalizedError(message('translate.freeLimit'));
  }
  return decodeHtmlEntities(translated);
}

async function translateBatchFree(
  texts: string[],
  targetLang: TranslateTargetLang,
): Promise<string[]> {
  // 1) 优先走 Microsoft Edge 原生批量 JSON 接口（干净 UTF-8、无乱码、国内外直连）
  try {
    return await translateBatchViaEdge(texts, targetLang);
  } catch {
    // 降级到 Google / MyMemory
  }

  // 2) 逐条并发走 Google Translate POST（绝不用易乱码的文本分隔符）
  const results = await Promise.all(
    texts.map(async (item) => {
      try {
        return await translateSingleViaGoogle(item, targetLang);
      } catch {
        return await translateSingleViaMyMemory(item, targetLang);
      }
    }),
  );

  return results;
}

export const { loadTranslateConfig, saveTranslateConfig, translateTexts } = createTranslator({
  async read() {
    const data = await chrome.storage.local.get(STORAGE_KEY_TRANSLATE_CONFIG);
    return data[STORAGE_KEY_TRANSLATE_CONFIG] as Partial<TranslateConfig> | undefined;
  },
  async write(config) {
    await chrome.storage.local.set({ [STORAGE_KEY_TRANSLATE_CONFIG]: config });
  },
}, DEFAULT_TRANSLATE_CONFIG, translateBatchFree);
