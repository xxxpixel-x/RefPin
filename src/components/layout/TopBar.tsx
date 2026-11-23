import { SettingsMenu } from './SettingsMenu';
import { TranslateControl } from './TranslateControl';
import { useReaderStore } from '../../store/useReaderStore';
import type { PaperTranslationController } from '../../services/usePaperTranslation';
import { t } from '../../i18n/core';
import { useState } from 'react';
import {
  FileUp,
  Home,
  Minus,
  PanelLeft,
  PanelRight,
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
  pinCount?: number;
  drawerOpen?: boolean;
  dockCollapsed?: boolean;
  translation?: PaperTranslationController;
  onJumpPage: (page: number) => void;
  onSearch?: () => void;
  onPalette?: () => void;
  onShowShortcuts?: () => void;
  onReplayCoach?: () => void;
  onZoom: (nextScale: number) => void;
  onFitWidth?: () => void;
  onToggleSnip: () => void;
  onToggleDrawer: () => void;
  onToggleDock?: () => void;
  onReset: () => void;
  onOpenFile: (file: File) => void;
}

// Shared look for the bordered toolbar buttons; labels never wrap and hide on narrow windows.
const toolButton =
  'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-paper-border px-2 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg';
const toggledButton =
  'aria-pressed:border-paper-goldborder aria-pressed:bg-paper-goldbg aria-pressed:text-paper-goldtext';
const iconButton = 'shrink-0 rounded-md p-1.5 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink';

export function TopBar({
  fileName,
  numPages,
  currentPage,
  scale,
  snipMode,
  isParsing,
  parseProgress,
  assetCount,
  pinCount = 0,
  drawerOpen = false,
  dockCollapsed = false,
  translation,
  onJumpPage,
  onSearch,
  onPalette,
  onShowShortcuts,
  onReplayCoach,
  onZoom,
  onFitWidth,
  onToggleSnip,
  onToggleDrawer,
  onToggleDock,
  onReset,
  onOpenFile,
}: TopBarProps) {
  const ruler = useReaderStore(state => state.readingRulerEnabled);
  const [pageInput, setPageInput] = useState('');

  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-2 border-b border-paper-border bg-paper-card/85 px-3 backdrop-blur">
      <button type="button" aria-pressed={drawerOpen} onClick={onToggleDrawer}
        className={clsx(toolButton, toggledButton)} title={t('reader.toggleAssets')} aria-label={t('reader.toggleAssets')}>
        <PanelLeft className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{t('reader.assets')}</span>
        <span className="rounded bg-paper-goldbg px-1 font-mono text-xs text-paper-goldtext">{assetCount}</span>
      </button>

      <span className="hidden min-w-0 max-w-[260px] truncate text-xs text-paper-muted xl:inline" title={fileName}>
        {fileName}
      </span>

      <span className="flex shrink-0 items-center gap-1 rounded-lg border border-paper-border bg-paper-card px-1 py-0.5 focus-within:border-paper-gold">
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
        <span className="whitespace-nowrap font-mono text-xs text-paper-muted">/ {numPages}</span>
      </span>

      <div className="flex shrink-0 items-center rounded-lg border border-paper-border bg-paper-card">
        <button type="button" onClick={() => onZoom(scale - 0.15)} title={t('reader.zoomOut')}
          className="px-1.5 py-1.5 text-paper-muted transition hover:text-paper-ink" aria-label={t('reader.zoomOut')}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onFitWidth} disabled={!onFitWidth} title={t('reader.fitWidth')} aria-label={t('reader.fitWidth')}
          className="w-12 rounded py-1 text-center font-mono text-xs text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink disabled:hover:bg-transparent">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={() => onZoom(scale + 0.15)} title={t('reader.zoomIn')}
          className="px-1.5 py-1.5 text-paper-muted transition hover:text-paper-ink" aria-label={t('reader.zoomIn')}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        aria-pressed={snipMode}
        onClick={onToggleSnip}
        className={clsx(toolButton, snipMode && 'border-paper-gold bg-paper-gold text-paper-card shadow-sm hover:bg-paper-gold')}
        title={t('snip.shortcut')}
        aria-label={t('snip.shortcut')}
      >
        <Scissors className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">{t('snip.tool')}</span>
      </button>

      {translation && <TranslateControl translation={translation} numPages={numPages} />}

      {onSearch && <>
        <button type="button" title={t('search.find')} aria-label={t('search.find')} onClick={onSearch} className={iconButton}>
          <Search size={15} />
        </button>
        <button type="button" title={t('ruler.toggle')} aria-label={t('ruler.toggle')} aria-pressed={ruler}
          onClick={() => useReaderStore.getState().setReadingRulerEnabled(!ruler)}
          className={clsx(iconButton, 'aria-pressed:bg-paper-goldbg aria-pressed:text-paper-goldtext')}>
          <Ruler size={15} />
        </button>
      </>}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {onToggleDock && (
          <button type="button" aria-pressed={!dockCollapsed} onClick={onToggleDock}
            className={clsx(toolButton, toggledButton)} title={t('dock.toggle')} aria-label={t('dock.toggle')}>
            <PanelRight className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('panel.pins')}</span>
            <span className="rounded bg-paper-goldbg px-1 font-mono text-xs text-paper-goldtext">{pinCount}</span>
          </button>
        )}
        <label className={clsx(toolButton, 'cursor-pointer focus-within:border-paper-gold')} title={t('reader.switchFile')}>
          <FileUp className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t('reader.switchFile')}</span>
          <input
            type="file"
            accept="application/pdf"
            aria-label={t('reader.switchFile')}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onOpenFile(file);
              event.target.value = '';
            }}
          />
        </label>
        <SettingsMenu onPalette={onPalette} onShowShortcuts={onShowShortcuts} onReplayCoach={onReplayCoach} />
        <button type="button" onClick={onReset} title={t('reader.home')} aria-label={t('reader.home')} className={iconButton}>
          <Home size={15} />
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
