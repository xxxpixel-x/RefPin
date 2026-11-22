import { useEffect, useRef, useState } from 'react';
import { Command, Keyboard, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { ThemeSwitcher } from './ThemeSwitcher';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { useI18n } from '../../i18n';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const iconButton = 'shrink-0 rounded-md p-1.5 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink';

interface SettingsMenuProps {
  onPalette?: () => void;
  onShowShortcuts?: () => void;
  /** Extra class for the trigger, e.g. a bordered style in the side panel header. */
  triggerClassName?: string;
}

/** Overflow menu for low-frequency preferences: theme, language, command palette, shortcuts. */
export function SettingsMenu({ onPalette, onShowShortcuts, triggerClassName }: SettingsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const menuItem = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-paper-ink hover:bg-paper-bg';

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('settings.menu')} title={t('settings.menu')}
        onClick={() => setOpen(value => !value)} className={clsx(iconButton, triggerClassName, open && 'bg-paper-bg text-paper-ink')}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-paper-border bg-paper-card p-2 shadow-float">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-xs text-paper-muted">{t('theme.choose')}</span>
            <ThemeSwitcher />
          </div>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-xs text-paper-muted">{t('language.label')}</span>
            <LanguageToggle />
          </div>
          <div className="my-1.5 border-t border-paper-border" />
          {onPalette && (
            <button type="button" role="menuitem" className={menuItem} onClick={() => { setOpen(false); onPalette(); }}>
              <Command size={14} className="text-paper-muted" />
              <span className="flex-1">{t('palette.title')}</span>
              <kbd className="font-mono text-xs text-paper-muted">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
            </button>
          )}
          {onShowShortcuts && (
            <button type="button" role="menuitem" className={menuItem} onClick={() => { setOpen(false); onShowShortcuts(); }}>
              <Keyboard size={14} className="text-paper-muted" />
              <span className="flex-1">{t('shortcuts.title')}</span>
              <kbd className="font-mono text-xs text-paper-muted">?</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
