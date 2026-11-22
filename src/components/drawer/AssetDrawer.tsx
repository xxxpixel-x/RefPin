import { useMemo, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  LocateFixed,
  Pin,
  Search,
  Table2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { PaperAsset, ReferenceEntry } from '../../types/paper';

type DrawerTab = 'all' | 'figure' | 'table' | 'reference';

interface AssetDrawerProps {
  open: boolean;
  assets: PaperAsset[];
  references: ReferenceEntry[];
  pinnedIds: string[];
  isParsing: boolean;
  parseProgress: number;
  onClose: () => void;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (reference: ReferenceEntry) => void;
  onLocate: (pageNumber: number, asset?: PaperAsset) => void;
}

const TABS: { key: DrawerTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'figure', label: '图' },
  { key: 'table', label: '表' },
  { key: 'reference', label: '文献' },
];

export function AssetDrawer({
  open,
  assets,
  references,
  pinnedIds,
  isParsing,
  parseProgress,
  onClose,
  onPinAsset,
  onPinReference,
  onLocate,
}: AssetDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('all');
  const [query, setQuery] = useState('');

  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const tabMatch =
        tab === 'all' ||
        (tab === 'figure' && asset.kind === 'figure') ||
        (tab === 'table' && asset.kind === 'table');
      if (!tabMatch) return false;
      if (!keyword) return true;
      return (
        asset.label.toLowerCase().includes(keyword) ||
        asset.caption.toLowerCase().includes(keyword)
      );
    });
  }, [assets, tab, query]);

  const filteredReferences = useMemo(() => {
    if (tab !== 'all' && tab !== 'reference') return [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return references;
    return references.filter((reference) =>
      [reference.title, reference.authors, reference.rawText]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [references, tab, query]);

  const figureCount = assets.filter((asset) => asset.kind === 'figure').length;
  const tableCount = assets.filter((asset) => asset.kind === 'table').length;

  const counts: Record<DrawerTab, number> = {
    all: assets.length + references.length,
    figure: figureCount,
    table: tableCount,
    reference: references.length,
  };

  return (
    <aside
      className={clsx(
        'absolute inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-paper-border bg-white/95 shadow-float backdrop-blur transition-transform duration-200',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
      aria-hidden={!open}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-paper-border px-3">
        <span className="text-xs font-medium text-paper-ink">全篇资产</span>
        <span className="rounded bg-paper-goldbg px-1.5 py-0.5 font-mono text-[10px] text-paper-goldtext">
          {counts.all}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
          aria-label="收起资产墙（快捷键 [）"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="shrink-0 px-2.5 pt-2.5">
        <label className="flex items-center gap-1.5 rounded-lg border border-paper-border bg-paper-bg px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-paper-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜图表标题 / 文献作者"
            className="w-full bg-transparent text-[11px] text-paper-ink outline-none placeholder:text-paper-muted"
          />
        </label>

        <div className="mt-2 flex items-center gap-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={clsx(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition',
                tab === item.key
                  ? 'bg-paper-ink text-white'
                  : 'text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
              )}
            >
              {item.label}
              <span
                className={clsx(
                  'font-mono text-[9px]',
                  tab === item.key ? 'text-white/70' : 'text-paper-muted',
                )}
              >
                {counts[item.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
        {isParsing && (
          <div className="mb-2.5 rounded-lg border border-paper-goldborder bg-paper-goldbg px-2.5 py-2">
            <div className="flex items-center justify-between text-[10px] text-paper-goldtext">
              <span>正在解析图表与文献…</span>
              <span className="font-mono">{Math.round(parseProgress)}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-paper-gold transition-all duration-300"
                style={{ width: `${parseProgress}%` }}
              />
            </div>
            <div className="mt-2 space-y-1.5">
              {[0, 1].map((row) => (
                <div key={row} className="flex animate-pulse items-center gap-2">
                  <div className="h-8 w-12 rounded bg-white/80" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2 w-2/3 rounded bg-white/80" />
                    <div className="h-2 w-1/3 rounded bg-white/60" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(tab === 'all' || tab === 'figure' || tab === 'table') && filteredAssets.length > 0 && (
          <div className="space-y-1.5">
            {filteredAssets.map((asset) => {
              const pinned = pinnedIds.includes(asset.key);
              return (
                <div
                  key={asset.key}
                  className="group flex items-center gap-2 rounded-lg border border-paper-border bg-white p-1.5 transition hover:border-amber-300"
                >
                  <button
                    type="button"
                    onClick={() => onLocate(asset.pageNumber, asset)}
                    className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-paper-border bg-paper-bg"
                  >
                    {asset.imageUrl ? (
                      <img
                        src={asset.imageUrl}
                        alt={asset.label}
                        className="h-full w-full object-cover"
                      />
                    ) : asset.kind === 'table' ? (
                      <Table2 className="h-4 w-4 text-paper-muted" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-paper-muted" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[11px] font-medium text-paper-ink">
                        {asset.label}
                      </span>
                      {pinned && (
                        <span className="rounded bg-paper-goldbg px-1 text-[8px] text-paper-goldtext">
                          已钉
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[9px] text-paper-muted">P.{asset.pageNumber}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onPinAsset(asset)}
                      className="rounded p-1 text-paper-muted transition hover:bg-paper-goldbg hover:text-paper-gold"
                      title="钉到对照钉板"
                    >
                      <Pin className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onLocate(asset.pageNumber, asset)}
                      className="rounded p-1 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                      title="定位原页"
                    >
                      <LocateFixed className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(tab === 'all' || tab === 'reference') && filteredReferences.length > 0 && (
          <div className="mt-2 space-y-1">
            {(tab === 'all' || filteredAssets.length > 0) && (
              <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-wider text-paper-muted">
                参考文献
              </p>
            )}
            {filteredReferences.map((reference) => {
              const pinned = pinnedIds.includes(reference.key);
              return (
                <div
                  key={reference.key}
                  className="group flex items-start gap-2 rounded-lg border border-transparent px-1.5 py-1.5 transition hover:border-paper-border hover:bg-white"
                >
                  <span className="mt-0.5 w-8 shrink-0 font-mono text-[10px] text-paper-muted">
                    [{reference.index}]
                  </span>
                  <button
                    type="button"
                    onClick={() => onPinReference(reference)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="line-clamp-2 text-[10px] leading-relaxed text-paper-ink">
                      {reference.title || reference.rawText}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[9px] text-paper-muted">
                      <FileText className="h-2.5 w-2.5" />
                      {[reference.authors, reference.year].filter(Boolean).join(' · ')}
                      {pinned && <span className="text-paper-goldtext">· 已钉</span>}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPinReference(reference)}
                    className="mt-0.5 rounded p-1 text-paper-muted opacity-0 transition hover:bg-paper-goldbg hover:text-paper-gold group-hover:opacity-100"
                    title="钉住文献"
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!isParsing &&
          filteredAssets.length === 0 &&
          filteredReferences.length === 0 && (
            <p className="px-2 py-8 text-center text-[10px] leading-relaxed text-paper-muted">
              没有匹配的图表或文献
            </p>
          )}
      </div>
    </aside>
  );
}
