import { ThemeSwitcher } from './ThemeSwitcher';
import { useReaderStore } from '../../store/useReaderStore';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { t } from '../../i18n/core';
import { useState } from 'react';
import {
  FileUp,
  Minus,
  PanelLeft,
  Plus,
  Scissors,
  Ruler,
  Search,
} from 'lucide-react';
import clsx from 'clsx';

interface TopBarProps {
  fileName: string;
  numPages: number;
  currentPage: number;
  scale: number;
  snipMode: boolean;
  isParsing: boolean;
  parseProgress: number;
  assetCount: number;
  onJumpPage: (page: number) => void;
  onSearch?: () => void;
  onZoom: (nextScale: number) => void;
  onToggleSnip: () => void;
  onToggleDrawer: () => void;
  onReset: () => void;
  onOpenFile: (file: File) => void;
}

export function TopBar({
  fileName,
  numPages,
  currentPage,
  scale,
  snipMode,
  isParsing,
  parseProgress,
  assetCount,
  onJumpPage,
  onSearch,
  onZoom,
  onToggleSnip,
  onToggleDrawer,
  onReset,
  onOpenFile,
}: TopBarProps) {
  const ruler = useReaderStore(state => state.readingRulerEnabled);
  const [pageInput, setPageInput] = useState('');

  return (
    <header className="relative z-30 flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 lg:flex-nowrap border-b border-paper-border bg-paper-card/85 px-3 backdrop-blur">
      <button
        type="button"
        onClick={onToggleDrawer}
        className="flex items-center gap-1 rounded-lg border border-paper-border px-2 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg"
        title={t('reader.toggleAssets')}
      >
        <PanelLeft className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('reader.assets')}</span>
        <span className="rounded bg-paper-goldbg px-1 font-mono text-[10px] text-paper-goldtext">
          {assetCount}
        </span>
      </button>

      <span className="hidden text-sm font-semibold tracking-tight text-paper-ink md:inline">
        RefPin
      </span>
      <span className="hidden max-w-[180px] truncate text-xs text-paper-muted md:inline lg:max-w-[260px]">
        {fileName}
      </span>

      <span className="ml-1 flex items-center gap-1 rounded-lg border border-paper-border bg-paper-card px-1 py-0.5">
        <input
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const value = Number(pageInput);
            if (Number.isFinite(value) && value >= 1 && value <= numPages) {
              onJumpPage(value);
              setPageInput('');
            }
          }}
          placeholder={String(currentPage)}
          className="w-9 bg-transparent text-center font-mono text-xs text-paper-ink outline-none placeholder:text-paper-ink"
          aria-label={t('reader.goToPage')}
        />
        <span className="font-mono text-xs text-paper-muted">/ {numPages}</span>
      </span>

      <div className="flex items-center rounded-lg border border-paper-border bg-paper-card">
        <button
          type="button"
          onClick={() => onZoom(scale - 0.15)}
          className="px-1.5 py-1.5 text-paper-muted transition hover:text-paper-ink"
          aria-label={t('reader.zoomOut')}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-11 text-center font-mono text-[11px] text-paper-muted">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => onZoom(scale + 0.15)}
          className="px-1.5 py-1.5 text-paper-muted transition hover:text-paper-ink"
          aria-label={t('reader.zoomIn')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={onToggleSnip}
        className={clsx(
          'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition',
          snipMode
            ? 'bg-paper-gold text-paper-card shadow-sm'
            : 'border border-paper-border text-paper-ink hover:bg-paper-bg',
        )}
        title={t('snip.shortcut')}
      >
        <Scissors className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('snip.tool')}</span>
      </button>

      {onSearch && <>
        <button type="button" title={t('search.find')} aria-label={t('search.find')} onClick={onSearch}
          className="rounded-md p-1.5 text-paper-muted hover:bg-paper-bg"><Search size={15} /></button>
        <button type="button" title={t('ruler.toggle')} aria-label={t('ruler.toggle')} aria-pressed={ruler}
          onClick={() => useReaderStore.getState().setReadingRulerEnabled(!ruler)}
          className="rounded-md p-1.5 text-paper-muted hover:bg-paper-bg aria-pressed:bg-paper-goldbg aria-pressed:text-paper-goldtext"><Ruler size={15} /></button>
      </>}

      <div className="ml-auto flex items-center gap-2">
        <ThemeSwitcher />
        <LanguageToggle />
        <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-paper-border px-2 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg">
          <FileUp className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t('reader.switchFile')}</span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onOpenFile(file);
              event.target.value = '';
            }}
          />
        </label>

        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-paper-muted transition hover:text-paper-ink"
        >
          {t('reader.home')}
        </button>
      </div>

      {isParsing && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-paper-goldsoft">
          <div
            className="h-full bg-paper-gold transition-all duration-300"
            style={{ width: `${parseProgress}%` }}
          />
        </div>
      )}
    </header>
  );
}
