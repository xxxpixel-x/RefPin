import { useState } from 'react';
import { t } from '../../i18n/core';

export function usePreviewColor(key?: string) {
  const [originalKey, setOriginalKey] = useState<string>();
  const original = !!key && key === originalKey;
  const colorToggle = <button type="button" aria-pressed={original}
    onClick={event => { event.stopPropagation(); setOriginalKey(original ? undefined : key); }}
    className="original-color-control rounded border border-paper-border bg-paper-card px-1.5 py-1 text-[11px] text-paper-muted hover:text-paper-ink aria-pressed:border-paper-goldborder aria-pressed:text-paper-goldtext">
    {t('theme.original')}
  </button>;
  return { filter: original ? 'none' : 'var(--pdf-filter)', colorToggle };
}
