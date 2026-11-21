import { useState } from 'react';
import {
  FileUp,
  Minus,
  PanelLeft,
  Plus,
  Scissors,
} from 'lucide-react';
import clsx from 'clsx';
import type { ReadingStats } from '../../types/paper';

interface TopBarProps {
  fileName: string;
  numPages: number;
  currentPage: number;
  scale: number;
  snipMode: boolean;
  isParsing: boolean;
  parseProgress: number;
  assetCount: number;
  referenceCount: number;
  stats: ReadingStats;
  onJumpPage: (page: number) => void;
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
  referenceCount,
  stats,
  onJumpPage,
  onZoom,
  onToggleSnip,
  onToggleDrawer,
  onReset,
  onOpenFile,
}: TopBarProps) {
  const [pageInput, setPageInput] = useState('');

  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-2.5 border-b border-paper-border bg-white/85 px-3 backdrop-blur">
      <button
        type="button"
        onClick={onToggleDrawer}
        className="flex items-center gap-1 rounded-lg border border-paper-border px-2 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg"
        title="展开/收起资产墙（快捷键 [）"
      >
        <PanelLeft className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">资产</span>
        <span className="rounded bg-paper-goldbg px-1 font-mono text-[10px] text-paper-goldtext">
          {assetCount}
        </span>
      </button>

      <span className="hidden text-sm font-semibold tracking-tight text-paper-ink md:inline">
        RefPin
      </span>
      <span className="max-w-[180px] truncate text-xs text-paper-muted lg:max-w-[260px]">
        {fileName}
      </span>

      <span className="ml-1 flex items-center gap-1 rounded-lg border border-paper-border bg-white px-1 py-0.5">
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
          aria-label="跳转页码"
        />
        <span className="font-mono text-xs text-paper-muted">/ {numPages}</span>
      </span>

      <div className="flex items-center rounded-lg border border-paper-border bg-white">
        <button
          type="button"
          onClick={() => onZoom(scale - 0.15)}
          className="px-1.5 py-1.5 text-paper-muted transition hover:text-paper-ink"
          aria-label="缩小"
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
          aria-label="放大"
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
            ? 'bg-paper-gold text-white shadow-sm'
            : 'border border-paper-border text-paper-ink hover:bg-paper-bg',
        )}
        title="自由框选钉住（快捷键 S）"
      >
        <Scissors className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">框选钉住</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <div className="group relative hidden lg:block">
          <span className="flex items-center gap-1.5 rounded-full border border-paper-goldborder bg-paper-goldbg px-3 py-1 text-[11px] font-medium text-paper-goldtext transition group-hover:border-amber-400">
            已免去翻页
            <span className="font-mono text-xs font-semibold text-paper-goldtext">
              {stats.savedFlips}
            </span>
            次 · 少滚
            <span className="font-mono text-xs font-semibold text-paper-goldtext">
              {stats.savedScrollPx.toLocaleString()}
            </span>
            px
          </span>
          <div className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-44 translate-y-1 rounded-lg border border-paper-border bg-white p-2.5 text-[11px] text-paper-muted opacity-0 shadow-float transition group-hover:translate-y-0 group-hover:opacity-100">
            <div className="flex justify-between">
              <span>悬停速览</span>
              <span className="font-mono text-paper-ink">{stats.peekCount} 次</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>钉住对照</span>
              <span className="font-mono text-paper-ink">{stats.pinCount} 项</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>文献</span>
              <span className="font-mono text-paper-ink">{referenceCount} 条</span>
            </div>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-paper-border px-2 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg">
          <FileUp className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">换一篇</span>
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
          首页
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
