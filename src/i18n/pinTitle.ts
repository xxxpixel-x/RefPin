import type { CompanionPinItem } from '../extension/protocol';
import type { PinnedItem } from '../types/paper';
import { getLocale, t } from './core';

export function timedSnipTitle(timestamp: number): string {
  const time = new Date(timestamp).toLocaleTimeString(getLocale(), {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return t('snip.timeTitle', { time });
}

export function pinTitle(pin: PinnedItem | CompanionPinItem): string {
  if (!pin.automaticTitle) return pin.title;
  if (pin.kind === 'reference' && pin.reference) return t('reference.number', { index: pin.reference.index });
  if (pin.kind === 'snip') {
    if ('pinnedAt' in pin) return timedSnipTitle(pin.pinnedAt);
    return t('snip.pageTitle', { page: pin.pageNumber });
  }
  return pin.title;
}
