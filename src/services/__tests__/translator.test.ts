import { t } from '../../i18n/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTranslator,
  canUseExtensionSettings,
  DEFAULT_TRANSLATE_CONFIG,
  exportBackupTranslateConfig,
  restoreBackupTranslateConfig,
  grantFreeTranslateConsent,
  needsFreeTranslateConsent,
  resetWebFreeState,
  sanitizeSourceText,
  splitTextForFreeLimit,
  summarizeTranslateConfig,
  translateBatchWebFree,
  webTranslator,
  WEB_TRANSLATE_CONFIG,
  type TranslateConfig,
} from '../translator';

function storage() {
  let saved: TranslateConfig | undefined;
  return {
    read: async () => saved,
    write: async (config: TranslateConfig) => { saved = config; },
  };
}
const local = { ...WEB_TRANSLATE_CONFIG, model: 'local-paper', apiBaseUrl: 'http://localhost:11434/v1/' };
afterEach(() => {
  resetWebFreeState();
  vi.unstubAllGlobals();
});

describe('shared translator', () => {
  it('网页独立配置默认脱敏，仅显式选择时写入密钥；旧版独立配置可迁移', async () => {
    let saved = { ...local, apiKey: 'private-test-key', webOnly: true as true | undefined };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) });
    expect(await exportBackupTranslateConfig()).toEqual({ ...local, apiKey: undefined, webOnly: true });
    expect(await exportBackupTranslateConfig()).not.toHaveProperty('apiKey');
    expect(await exportBackupTranslateConfig(true)).toEqual(saved);
    saved = { ...saved, webOnly: undefined };
    expect(await exportBackupTranslateConfig()).toMatchObject({ provider: 'openai', model: local.model });
    saved = { ...saved, model: saved.apiKey };
    expect(await exportBackupTranslateConfig()).toBeUndefined();
  });

  it('网页沿用扩展时即使选择包含密钥也省略配置，不请求扩展摘要或存储', async () => {
    const get = vi.fn(), postMessage = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { get } } });
    vi.stubGlobal('window', { postMessage });
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_TRANSLATE_CONFIG, apiKey: 'stale' }) });
    expect(await exportBackupTranslateConfig(true)).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('扩展阅读器也不会将扩展配置写入文件', async () => {
    vi.resetModules();
    vi.doMock('../../config/runtime', () => ({ IS_EXTENSION_PAGE: true }));
    const get = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { get } } });
    try {
      const service = await import('../translator');
      expect(await service.exportBackupTranslateConfig(true)).toBeUndefined();
      expect(get).not.toHaveBeenCalled();
    } finally { vi.doUnmock('../../config/runtime'); vi.resetModules(); }
  });

  it('导入无密钥配置只复用相同端点的密钥，新端点无法取得旧密钥', async () => {
    let saved = JSON.stringify({ ...local, apiKey: 'local-key' });
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, json: string) => { saved = json; } });
    const { apiKey: _key, ...config } = local;
    await restoreBackupTranslateConfig(config);
    expect(JSON.parse(saved).apiKey).toBe('local-key');
    await restoreBackupTranslateConfig({ ...config, apiBaseUrl: 'https://another.test' });
    expect(JSON.parse(saved).apiKey).toBe('');
    await restoreBackupTranslateConfig({ ...config, apiKey: 'imported' });
    expect(JSON.parse(saved).apiKey).toBe('imported');
  });

  it('网页默认服务商可以沿用扩展，保存过自定义服务商后使用网页配置', () => {
    expect(canUseExtensionSettings(DEFAULT_TRANSLATE_CONFIG)).toBe(true);
    expect(canUseExtensionSettings({ ...DEFAULT_TRANSLATE_CONFIG, targetLang: 'en' })).toBe(true);
    expect(canUseExtensionSettings({ ...DEFAULT_TRANSLATE_CONFIG, webOnly: true })).toBe(false);
    expect(canUseExtensionSettings(local)).toBe(false);
    expect(canUseExtensionSettings({ ...local, apiKey: 'saved-key' })).toBe(false);
  });

  it('配置摘要仅含四项公开字段，即使把密钥误填进模型名也不会回传', () => {
    const apiKey = 'private-test-credential';
    const config = { ...local, apiKey, apiBaseUrl: 'https://example.test/?token=' + apiKey };
    expect(summarizeTranslateConfig(config)).toEqual({
      provider: 'openai', model: 'local-paper', targetLang: 'zh-CN', hasApiKey: true,
    });
    expect(summarizeTranslateConfig({ ...config, model: 'model-' + apiKey }).model).toBe('');
    expect(summarizeTranslateConfig({ ...config, apiKey: '  ' }).hasApiKey).toBe(false);
  });

  it('连接测试用草稿配置实际请求端点，即使已有成功译文或没有密钥', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '测试成功' } }] }))
      .mockResolvedValueOnce(new Response('header: private-test-credential', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const free = vi.fn();
    const service = createTranslator(storage(), DEFAULT_TRANSLATE_CONFIG, free);
    const draft = { ...local, apiBaseUrl: 'https://example.test/v1' };
    await service.testConnection(draft);
    const failure = await service.testConnection({ ...draft, apiKey: 'private-test-credential' }).catch(error => error);
    expect(failure.uiMessage).toEqual({ key: 'translate.httpError', params: { provider: 'API', status: 401 } });
    expect(failure.message).not.toContain('private-test-credential');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(free).not.toHaveBeenCalled();
    expect(await service.loadTranslateConfig()).toEqual(DEFAULT_TRANSLATE_CONFIG);
  });

  it('未安装扩展时，网页沿用已有同意状态和浏览器内置翻译', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'refpin.freeTranslateConsent.v1' ? '1' : null });
    vi.stubGlobal('Translator', {
      availability: async () => 'available',
      create: async () => ({ translate: async () => '网页译文' }),
    });
    expect(await webTranslator.translateTexts(['Selection without extension'])).toEqual(['网页译文']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('round-trips settings and clears a key through the supplied adapter', async () => {
    const adapter = storage();
    const first = createTranslator(adapter);
    await first.saveTranslateConfig({ ...local, apiKey: ' test ', targetLang: 'en' });
    const second = createTranslator(adapter);
    expect(await second.loadTranslateConfig()).toMatchObject({ apiKey: 'test', targetLang: 'en', model: local.model });
    await second.saveTranslateConfig(local);
    expect((await first.loadTranslateConfig()).apiKey).toBe('');
  });

  it('sanitizes PDF glyphs, control characters and private-use glyphs', () => {
    expect(sanitizeSourceText(' \u0001ﬃ\n  ﬁ\uE000\uFFFD −2 ')).toBe('ffi fi -2');
  });

  it('requires explicit web configuration before any network request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(createTranslator(storage()).translateTexts(['private'])).rejects.toThrow(t('translate.missingConfig'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('parses fenced compatible responses, uses optional auth and isolates cached endpoints', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({
      choices: [{ message: { content: '```json\n["译文"]\n```' } }],
    }));
    vi.stubGlobal('fetch', fetch);
    const service = createTranslator(storage());
    expect(await service.translateTexts(['PDF'], local)).toEqual(['译文']);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(init.body).model).toBe(local.model);
    await service.translateTexts(['PDF'], local);
    expect(fetch).toHaveBeenCalledTimes(1);
    await service.translateTexts(['PDF'], { ...local, apiBaseUrl: 'https://example.test/v1', apiKey: 'key' });
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer key');
  });

  it('rejects a response with the wrong number of translations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '[]' } }] })));
    await expect(createTranslator(storage()).translateTexts(['one'], local)).rejects.toThrow();
  });

  it('also reads a plain single-selection translation from a local model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '译文' } }] })));
    expect(await createTranslator(storage()).translateTexts(['source'], local)).toEqual(['译文']);
  });

  it('retains the extension free-provider fallback when the key is empty', async () => {
    const free = vi.fn(async () => ['免费译文']);
    const service = createTranslator(storage(), DEFAULT_TRANSLATE_CONFIG, free);
    expect(await service.translateTexts(['text'], { provider: 'openai' })).toEqual(['免费译文']);
    expect(free).toHaveBeenCalledWith(['text'], 'zh-CN');
  });

  it('keeps local Ollama on OpenAI protocol even without an API key and notifies config subscribers', async () => {
    const free = vi.fn(async () => ['免费译文']);
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '["本地译文"]' } }] }));
    vi.stubGlobal('fetch', fetch);
    const service = createTranslator(storage(), DEFAULT_TRANSLATE_CONFIG, free);
    const onChange = vi.fn();
    const unsubscribe = service.subscribeConfig(onChange);
    await service.saveTranslateConfig({
      provider: 'openai',
      targetLang: 'zh-CN',
      apiBaseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5:7b',
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(await service.translateTexts(['Self-attention scales well.'])).toEqual(['本地译文']);
    expect(free).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('splits oversized paragraphs on sentence boundaries without dropping words', () => {
    const s1 = 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.';
    const s2 = 'Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable.';
    const s3 = 'Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over existing results.';
    const joined = `${s1} ${s2} ${s3}`;
    const chunks = splitTextForFreeLimit(joined, 180);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 180)).toBe(true);
    expect(chunks.join(' ')).toBe(joined);
  });

  it('uses on-device browser Translator API when available before hitting network endpoints', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Translator', {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => ({
        translate: async (input: string) => `本地:${input}`,
      })),
    });
    expect(await translateBatchWebFree(['Attention mechanism'], 'zh-CN')).toEqual(['本地:Attention mechanism']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses Google GTX and falls back to chunked MyMemory when Google is unreachable', async () => {
    const fetch = vi.fn()
      // First call: Google GTX succeeds
      .mockResolvedValueOnce(
        new Response(JSON.stringify([[['注意力机制', 'Attention mechanism']]]), { status: 200 }),
      )
      // Second call: Google GTX fails -> circuit breaker falls back to MyMemory
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        Response.json({ responseStatus: 200, responseData: { translatedText: '多头注意力&amp;编码器' } }),
      );
    vi.stubGlobal('fetch', fetch);

    expect(await translateBatchWebFree(['Attention mechanism'], 'zh-CN')).toEqual(['注意力机制']);
    expect(await translateBatchWebFree(['Multi-head attention & encoder'], 'zh-CN')).toEqual(['多头注意力&编码器']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('free translation consent', () => {
  it('asks before any route that reaches the public channel, and only once', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    const custom = { ...DEFAULT_TRANSLATE_CONFIG, provider: 'openai' as const, model: 'm' };
    expect(needsFreeTranslateConsent(DEFAULT_TRANSLATE_CONFIG)).toBe(true);
    // A keyless remote endpoint silently falls back to the free channel, so it needs consent too.
    expect(needsFreeTranslateConsent({ ...custom, apiBaseUrl: 'https://api.example.com/v1', apiKey: '' })).toBe(true);
    expect(needsFreeTranslateConsent({ ...custom, apiBaseUrl: 'https://api.example.com/v1', apiKey: 'k' })).toBe(false);
    expect(needsFreeTranslateConsent({ ...custom, apiBaseUrl: 'http://localhost:11434/v1', apiKey: '' })).toBe(false);
    grantFreeTranslateConsent();
    expect(needsFreeTranslateConsent(DEFAULT_TRANSLATE_CONFIG)).toBe(false);
  });
});
