import { en } from './locales/en';
import { zh } from './locales/zh';
import type { DisplayMessage, Locale, LocalizedMessage, MessageArgs, MessageKey } from './types';

export const LOCALE_KEY = 'refpin.locale.v1';
const catalogs = { en, 'zh-CN': zh };
const listeners = new Set<() => void>();

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh-CN';
}

function extensionStorage() {
  return typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.storage?.local : undefined;
}

function browserLocale(): Locale {
  const language = (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return /^zh/i.test(language) ? 'zh-CN' : 'en';
}

function webLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* Local storage may be disabled. */ }
  // The website opens in English until the reader picks a language; the extension follows the browser UI.
  return 'en';
}

export async function detectInitialLocale(): Promise<Locale> {
  const storage = extensionStorage();
  if (!storage) return webLocale();
  try {
    const saved = (await storage.get(LOCALE_KEY))[LOCALE_KEY];
    if (isLocale(saved)) return saved;
  } catch { /* The browser language still works without extension storage. */ }
  return browserLocale();
}

// Content scripts share the host's localStorage, so only use extension storage there.
let locale = extensionStorage() ? browserLocale() : webLocale();
let revision = 0;

function publish(next: Locale) {
  revision += 1;
  if (next === locale) return;
  locale = next;
  listeners.forEach(listener => listener());
}

export const getLocale = (): Locale => locale;

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setLocale(next: Locale): void {
  publish(next);
  const storage = extensionStorage();
  if (storage) {
    void storage.set({ [LOCALE_KEY]: next }).catch(() => {});
  } else {
    try { globalThis.localStorage?.setItem(LOCALE_KEY, next); } catch { /* In-memory preference remains usable. */ }
  }
}

if (extensionStorage()) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(LOCALE_KEY in changes)) return;
    const next = changes[LOCALE_KEY].newValue;
    publish(isLocale(next) ? next : browserLocale());
  });
} else if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', event => {
    if (event.storageArea === window.localStorage && (event.key === LOCALE_KEY || event.key === null)) {
      publish(webLocale());
    }
  });
}

// A late initial read must never undo a user action or a storage change.
export const localeReady = detectInitialLocale().then(initial => {
  if (revision === 0) publish(initial);
});

export function message<K extends MessageKey>(key: K, ...args: MessageArgs<K>): LocalizedMessage {
  return { key, params: args[0] };
}

export function formatMessage(value: DisplayMessage | null | undefined): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  const template: string = catalogs[locale][value.key];
  const { params } = value;
  const text = params ? template.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token) : template;
  return value.detail ? `${text} ${value.detail}` : text;
}

export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  return formatMessage(message(key, ...args));
}

export class LocalizedError extends Error {
  constructor(readonly uiMessage: LocalizedMessage) {
    super(formatMessage(uiMessage));
  }
}

export function describeError(error: unknown, fallback: LocalizedMessage): LocalizedMessage {
  if (error instanceof LocalizedError) return error.uiMessage;
  return error instanceof Error ? { ...fallback, detail: error.message } : fallback;
}
