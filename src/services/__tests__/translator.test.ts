import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, DEFAULT_TRANSLATE_CONFIG, sanitizeSourceText, WEB_TRANSLATE_CONFIG, type TranslateConfig } from '../translator';

function storage() {
  let saved: TranslateConfig | undefined;
  return {
    read: async () => saved,
    write: async (config: TranslateConfig) => { saved = config; },
  };
}
const local = { ...WEB_TRANSLATE_CONFIG, model: 'local-paper', apiBaseUrl: 'http://localhost:11434/v1/' };
afterEach(() => vi.unstubAllGlobals());

describe('shared translator', () => {
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
    await expect(createTranslator(storage()).translateTexts(['private'])).rejects.toThrow('配置');
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
});
