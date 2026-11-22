import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { t } from '../../i18n/core';
import type { MessageKey } from '../../i18n/types';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS = [
  { keys: [mod, 'K'], label: 'shortcuts.palette' },
  { keys: [mod, 'F'], label: 'shortcuts.search' },
  { keys: ['S'], label: 'shortcuts.snip' },
  { keys: ['['], label: 'shortcuts.assets' },
  { keys: [']'], label: 'shortcuts.dock' },
  { keys: ['G'], label: 'shortcuts.glossary' },
  { keys: ['T'], label: 'shortcuts.translate' },
  { keys: ['R'], label: 'shortcuts.ruler' },
  { keys: ['Alt', '↑ / ↓'], label: 'shortcuts.rulerStep' },
  { keys: ['Alt', '← / →'], label: 'shortcuts.history' },
  { keys: ['Esc'], label: 'shortcuts.close' },
  { keys: ['?'], label: 'shortcuts.help' },
] as const satisfies ReadonlyArray<{ keys: readonly string[]; label: MessageKey }>;

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-paper-ink/30 px-4" onPointerDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title"
        className="w-full max-w-sm rounded-xl border border-paper-border bg-paper-card p-4 text-paper-ink shadow-float">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="shortcut-help-title" className="text-sm font-semibold">{t('shortcuts.title')}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')}
            className="rounded-md p-1 text-paper-muted hover:bg-paper-bg hover:text-paper-ink">
            <X size={15} />
          </button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(({ keys, label }) => (
            <div key={label} className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-paper-muted">{t(label)}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {keys.map(key => (
                  <kbd key={key} className="rounded border border-paper-border bg-paper-bg px-1.5 py-0.5 font-mono text-xs text-paper-ink">{key}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
