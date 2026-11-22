import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribeLocale, t } from './core';

export * from './core';
export type { DisplayMessage, Locale, MessageKey } from './types';

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { locale, setLocale, t };
}
