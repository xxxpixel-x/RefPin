import enChrome from '../../extension/_locales/en/messages.json';
import zhChrome from '../../extension/_locales/zh_CN/messages.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../locales/en';
import { zh } from '../locales/zh';
import type { MessageKey } from '../types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('RefPin interface language', () => {
  it('ships exactly the same keys and interpolation parameters in both catalogs', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    const tokens = (value: string) => value.match(/\{\w+\}/g)?.sort() ?? [];
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(zh[key].trim(), key).not.toBe('');
      expect(tokens(zh[key]), key).toEqual(tokens(en[key]));
    }
  });

  it('ships matching native extension messages, including the full reader context menu', () => {
    expect(Object.keys(zhChrome).sort()).toEqual(Object.keys(enChrome).sort());
    for (const catalog of [enChrome, zhChrome]) {
      expect(catalog.menuOpenFullReader.message.trim()).toBeTruthy();
      for (const item of Object.values(catalog)) expect(item.message.trim()).toBeTruthy();
    }
  });

  it.each([
    ['zh-CN', 'zh-CN'], ['zh-TW', 'zh-CN'], ['ZH-hk', 'zh-CN'],
    ['en-US', 'en'], ['fr-FR', 'en'], ['ja-JP', 'en'],
  ])('opens the website in English for browser language %s (would map to %s)', async (language) => {
    vi.stubGlobal('navigator', { language });
    const { detectInitialLocale } = await import('../index');
    expect(await detectInitialLocale()).toBe('en');
  });

  it('keeps a saved Chinese choice on the website', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'zh-CN'), setItem: vi.fn() });
    const { detectInitialLocale } = await import('../index');
    expect(await detectInitialLocale()).toBe('zh-CN');
  });

  it('prefers the saved web choice and formats names and multiple numbers literally', async () => {
    vi.stubGlobal('navigator', { language: 'zh-TW' });
    const localStorage = { getItem: vi.fn(() => 'en'), setItem: vi.fn() };
    vi.stubGlobal('localStorage', localStorage);
    const { LOCALE_KEY, localeReady, getLocale, setLocale, t } = await import('../index');
    await localeReady;
    expect(getLocale()).toBe('en');
    expect(t('reader.pageOf', { page: 2, total: 14 })).toBe('p. 2 / 14');
    expect(t('dock.pinnedName', { name: '$& {name}' })).toBe('Pinned $& {name}');
    setLocale('zh-CN');
    expect(localStorage.setItem).toHaveBeenCalledWith(LOCALE_KEY, 'zh-CN');
    expect(t('reader.pageOf', { page: 2, total: 14 })).toBe('第 2 / 14 页');
  });

  it('uses the extension UI language and shares changes without reading the host website’s storage', async () => {
    const key = 'refpin.locale.v1';
    const hostStorage = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal('localStorage', hostStorage);
    vi.stubGlobal('navigator', { language: 'en-US' });
    const get = vi.fn(async (): Promise<Record<string, unknown>> => ({ [key]: 'en' }));
    const set = vi.fn(async () => {});
    const addListener = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { id: 'refpin' }, i18n: { getUILanguage: () => 'zh-TW' },
      storage: { local: { get, set }, onChanged: { addListener } },
    });
    const { getLocale, setLocale, subscribeLocale, detectInitialLocale, localeReady } = await import('../core');
    await localeReady;
    expect(getLocale()).toBe('en');
    get.mockResolvedValue({ [key]: 'unsupported' });
    expect(await detectInitialLocale()).toBe('zh-CN');
    const changed = vi.fn();
    const unsubscribe = subscribeLocale(changed);
    const notify = addListener.mock.calls[0][0];
    notify({ [key]: { newValue: 'zh-CN' } }, 'session');
    expect(changed).not.toHaveBeenCalled();
    notify({ [key]: { newValue: 'zh-CN' } }, 'local');
    expect(getLocale()).toBe('zh-CN');
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLocale('en');
    expect(set).toHaveBeenCalledWith({ [key]: 'en' });
    expect(hostStorage.getItem).not.toHaveBeenCalled();
    expect(hostStorage.setItem).not.toHaveBeenCalled();
  });

  it('relabels open notices, sample metadata, and generated pins without changing saved titles', async () => {
    const { formatMessage, message, setLocale } = await import('../core');
    const { pinTitle } = await import('../pinTitle');
    const { getSampleById } = await import('../../config/samples');
    const { inspectTabUrl } = await import('../../extension/urlRules');
    const sample = getSampleById('sample-zh')!;
    const pin = { id: 'snip-1', kind: 'snip' as const, pageNumber: 3, title: 'Custom name', createdAt: 0 };
    const savedNotice = JSON.parse(JSON.stringify(message('reader.httpError', { status: 404 })));
    setLocale('en');
    expect(sample.title).toBe(en['sample.chineseTitle']);
    expect(formatMessage(savedNotice)).toContain('Couldn’t load');
    setLocale('zh-CN');
    expect(sample.title).toBe(zh['sample.chineseTitle']);
    expect(formatMessage(savedNotice)).toBe('PDF 加载失败（HTTP 404）');
    expect(inspectTabUrl('file:///paper.pdf').siteLabel).toBe('本地 PDF');
    expect(pinTitle({ ...pin, automaticTitle: true })).toBe('自由框选 · 第 3 页');
    expect(pinTitle(pin)).toBe('Custom name');
  });

  it('keeps a new selection when an older extension preference finishes loading', async () => {
    let finishRead!: (value: Record<string, unknown>) => void;
    vi.stubGlobal('chrome', {
      runtime: { id: 'refpin' }, i18n: { getUILanguage: () => 'en' },
      storage: { local: {
        get: () => new Promise(resolve => { finishRead = resolve; }),
        set: async () => {},
      }, onChanged: { addListener: vi.fn() } },
    });
    const { LOCALE_KEY, setLocale, getLocale, localeReady } = await import('../core');
    setLocale('zh-CN');
    finishRead({ [LOCALE_KEY]: 'en' });
    await localeReady;
    expect(getLocale()).toBe('zh-CN');
  });
});
