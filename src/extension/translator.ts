import {
  DEFAULT_TRANSLATE_CONFIG,
  STORAGE_KEY_TRANSLATE_CONFIG,
  type TranslateConfig,
  type TranslateTargetLang,
} from './protocol';

const translationCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 1500;

let cachedEdgeToken: { token: string; expiresAt: number } | null = null;

export async function loadTranslateConfig(): Promise<TranslateConfig> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_TRANSLATE_CONFIG);
    const saved = data[STORAGE_KEY_TRANSLATE_CONFIG] as Partial<TranslateConfig> | undefined;
    if (!saved) return { ...DEFAULT_TRANSLATE_CONFIG };
    return {
      provider: saved.provider === 'openai' ? 'openai' : 'free',
      targetLang: saved.targetLang === 'en' ? 'en' : 'zh-CN',
      apiBaseUrl: saved.apiBaseUrl?.trim() || DEFAULT_TRANSLATE_CONFIG.apiBaseUrl,
      apiKey: saved.apiKey?.trim() || '',
      model: saved.model?.trim() || DEFAULT_TRANSLATE_CONFIG.model,
    };
  } catch {
    return { ...DEFAULT_TRANSLATE_CONFIG };
  }
}

export async function saveTranslateConfig(config: TranslateConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_TRANSLATE_CONFIG]: config });
}

function getCacheKey(text: string, config: TranslateConfig): string {
  const modeTag =
    config.provider === 'openai' && config.apiKey
      ? `ai:${config.model}`
      : 'free-v2';
  return `${modeTag}|${config.targetLang}|${text}`;
}

function setCache(key: string, value: string): void {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = translationCache.keys().next().value;
    if (firstKey !== undefined) translationCache.delete(firstKey);
  }
  translationCache.set(key, value);
}

/**
 * 清洗 PDF 连字、私有区字体乱码字符与不可见控制符，避免送入翻译器后产出乱码。
 */
export function sanitizeSourceText(raw: string): string {
  return raw
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\u2212/g, '-')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

async function fetchWithTimeout(
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

async function getEdgeAuthToken(): Promise<string> {
  const now = Date.now();
  if (cachedEdgeToken && cachedEdgeToken.expiresAt > now) {
    return cachedEdgeToken.token;
  }
  const resp = await fetchWithTimeout('https://edge.microsoft.com/translate/auth', {}, 5000);
  if (!resp.ok) {
    throw new Error(`Edge auth HTTP ${resp.status}`);
  }
  const token = (await resp.text()).trim();
  if (!token || token.length < 20) {
    throw new Error('Invalid Edge auth token');
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
    throw new Error(`Edge translate HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as Array<{
    translations?: Array<{ text?: string }>;
  }>;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error('Edge translate length mismatch');
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
    throw new Error(`Google Translate HTTP ${response.status}`);
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
    throw new Error('Empty Google Translate response');
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
    throw new Error(`MyMemory HTTP ${response.status}`);
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
    throw new Error('MyMemory rate-limited or invalid');
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

async function translateBatchOpenAI(
  texts: string[],
  config: TranslateConfig,
): Promise<string[]> {
  if (!config.apiKey) {
    throw new Error('未填写 API Key');
  }

  const endpoint = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const targetName = config.targetLang === 'zh-CN' ? '简体中文' : 'English';

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
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

  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error('模型返回格式不匹配');
  }

  return parsed.map((entry) => String(entry ?? '').trim());
}

export async function translateTexts(
  texts: string[],
  overrideConfig?: Partial<TranslateConfig>,
): Promise<string[]> {
  const saved = await loadTranslateConfig();
  const config: TranslateConfig = {
    ...saved,
    ...overrideConfig,
  };

  const outputs = new Array<string>(texts.length).fill('');
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  texts.forEach((raw, idx) => {
    const text = sanitizeSourceText(raw);
    if (!text) {
      outputs[idx] = '';
      return;
    }
    const key = getCacheKey(text, config);
    const cached = translationCache.get(key);
    if (cached !== undefined) {
      outputs[idx] = cached;
    } else {
      uncachedIndices.push(idx);
      uncachedTexts.push(text);
    }
  });

  if (uncachedTexts.length === 0) {
    return outputs;
  }

  const useOpenAI = config.provider === 'openai' && Boolean(config.apiKey);
  const translated = useOpenAI
    ? await translateBatchOpenAI(uncachedTexts, config)
    : await translateBatchFree(uncachedTexts, config.targetLang);

  uncachedIndices.forEach((origIdx, pos) => {
    const value = translated[pos] || uncachedTexts[pos];
    outputs[origIdx] = value;
    setCache(getCacheKey(uncachedTexts[pos], config), value);
  });

  return outputs;
}
