import type { MessageKey } from '../../i18n/types';
import { t } from '../../i18n/core';
import { useMemo, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Image as ImageIcon,
  LocateFixed,
  Pin,
  Search,
  Table2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { CitationBacklink, CitationKind, NormalizedRect, OutlineItem, PaperAsset, ReferenceEntry } from '../../types/paper';
import { BacklinkStrip } from '../BacklinkStrip';

type DrawerTab = 'all' | CitationKind | 'outline';

interface AssetDrawerProps {
  open: boolean;
  assets: PaperAsset[];
  outline?: OutlineItem[];
  references: ReferenceEntry[];
  backlinksMap: Record<string, CitationBacklink[]>;
  onJumpToBacklink: (pageNumber: number, rect: NormalizedRect) => void;
  pinnedIds: string[];
  isParsing: boolean;
  parseProgress: number;
  onClose: () => void;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (reference: ReferenceEntry) => void;
  onLocate: (pageNumber: number, rect?: NormalizedRect, label?: string) => void;
}

const TABS = [
  { key: 'all', label: 'filter.all' },
  { key: 'figure', label: 'filter.figures' },
  { key: 'table', label: 'filter.tables' },
  { key: 'equation', label: 'filter.equations' },
  { key: 'algorithm', label: 'filter.algorithms' },
  { key: 'theorem', label: 'filter.theorems' },
  { key: 'section', label: 'filter.sections' },
  { key: 'reference', label: 'filter.references' },
] as const satisfies ReadonlyArray<{ key: DrawerTab; label: MessageKey }>;

function OutlineBranch({ item, onJump }: { item: OutlineItem; onJump: (item: OutlineItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <li>
    <div className="flex items-center gap-1 rounded-md hover:bg-paper-bg">
      {item.children.length > 0
        ? <button type="button" aria-expanded={expanded} aria-label={t(expanded ? 'outline.collapse' : 'outline.expand', { title: item.title })}
            onClick={() => setExpanded(!expanded)} className="shrink-0 rounded p-1 text-paper-muted">
            <ChevronRight size={13} className={expanded ? 'rotate-90' : ''} />
          </button>
        : <span className="w-5 shrink-0" />}
      <button type="button" disabled={item.pageNumber === null} onClick={() => onJump(item)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left text-xs text-paper-ink disabled:text-paper-muted">
        <span className="min-w-0 flex-1 break-words">{item.title}</span>
        {item.pageNumber !== null && <span className="rounded-full border border-paper-border px-1.5 font-mono text-[10px] text-paper-muted">{item.pageNumber}</span>}
      </button>
    </div>
    {expanded && <ul className="ml-2 border-l border-paper-border pl-2">
      {item.children.map(child => <OutlineBranch key={child.id} item={child} onJump={onJump} />)}
    </ul>}
  </li>;
}

export function AssetDrawer({
  open,
  assets,
  outline = [],
  references,
  backlinksMap,
  onJumpToBacklink,
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

  const jumpToCitation = (pageNumber: number, rect: NormalizedRect) => {
    onClose();
    onJumpToBacklink(pageNumber, rect);
  };

  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (tab !== 'all' && tab !== asset.kind) return false;
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

  const counts: Record<Exclude<DrawerTab, 'outline'>, number> = {
    all: assets.length + references.length, reference: references.length,
    figure: 0, table: 0, equation: 0, algorithm: 0, theorem: 0, section: 0,
  };
  for (const asset of assets) counts[asset.kind]++;

  return (
    <aside
      className={clsx(
        'absolute inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-paper-border bg-paper-card/95 shadow-float backdrop-blur transition-transform duration-200',
        open ? 'visible translate-x-0' : 'invisible -translate-x-full',
      )}
      aria-hidden={!open}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-paper-border px-3">
        <button type="button" aria-pressed={tab !== 'outline'} onClick={() => setTab('all')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-paper-muted aria-pressed:bg-paper-bg aria-pressed:font-medium aria-pressed:text-paper-ink">
          {t('assets.title')}<span className="font-mono text-[10px] text-paper-goldtext">{counts.all}</span>
        </button>
        <button type="button" aria-pressed={tab === 'outline'} onClick={() => setTab('outline')}
          className="rounded-md px-2 py-1 text-xs text-paper-muted aria-pressed:bg-paper-bg aria-pressed:font-medium aria-pressed:text-paper-ink">
          {t('outline.title')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
          aria-label={t('assets.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {tab !== 'outline' && <div className="shrink-0 px-2.5 pt-2.5">
        <label className="flex items-center gap-1.5 rounded-lg border border-paper-border bg-paper-bg px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-paper-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('assets.search')}
            className="w-full bg-transparent text-[11px] text-paper-ink outline-none placeholder:text-paper-muted"
          />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
              className={clsx(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition',
                tab === item.key
                  ? 'bg-paper-ink text-paper-card'
                  : 'text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
              )}
            >
              {t(item.label)}
              <span
                className={clsx(
                  'font-mono text-[9px]',
                  tab === item.key ? 'text-paper-card/70' : 'text-paper-muted',
                )}
              >
                {counts[item.key]}
              </span>
            </button>
          ))}
        </div>
      </div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
        {isParsing && (
          <div className="mb-2.5 rounded-lg border border-paper-goldborder bg-paper-goldbg px-2.5 py-2">
            <div className="flex items-center justify-between text-[10px] text-paper-goldtext">
              <span>{t('assets.parsing')}</span>
              <span className="font-mono">{Math.round(parseProgress)}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-card">
              <div
                className="h-full rounded-full bg-paper-gold transition-all duration-300"
                style={{ width: `${parseProgress}%` }}
              />
            </div>
            <div className="mt-2 space-y-1.5">
              {[0, 1].map((row) => (
                <div key={row} className="flex animate-pulse items-center gap-2">
                  <div className="h-8 w-12 rounded bg-paper-card/80" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2 w-2/3 rounded bg-paper-card/80" />
                    <div className="h-2 w-1/3 rounded bg-paper-card/60" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'outline' && <nav aria-label={t('outline.title')}>
          {outline.length ? <ul>{outline.map(item => <OutlineBranch key={item.id} item={item} onJump={entry => {
            if (entry.pageNumber === null) return;
            onClose();
            const rect = entry.destY === undefined ? undefined : { x: 0.05, y: entry.destY, width: 0.9, height: 0.018 };
            onLocate(entry.pageNumber, rect, entry.title);
          }} />)}</ul> : !isParsing && <p className="px-2 py-8 text-center text-xs text-paper-muted">{t('outline.empty')}</p>}
        </nav>}

        {filteredAssets.length > 0 && (
          <div className="space-y-1.5">
            {filteredAssets.map((asset) => {
              const pinned = pinnedIds.includes(asset.key);
              return (
                <div
                  key={asset.key}
                  className="group flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-paper-border bg-paper-card p-1.5 transition hover:border-paper-goldborder"
                >
                  <button
                    type="button"
                    onClick={() => onLocate(asset.pageNumber, asset.cropRect, asset.label)}
                    className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-paper-border bg-paper-bg"
                  >
                    {asset.imageUrl ? (
                      <img
                        src={asset.imageUrl}
                        alt={asset.label}
                        className="pdf-image h-full w-full object-cover"
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
                          {t('pin.pinned')}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[9px] text-paper-muted"><span className="mr-1.5 rounded bg-paper-goldbg px-1 text-paper-goldtext">{t(`kind.${asset.kind}`)}</span>{t('reader.page', { page: asset.pageNumber })}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onPinAsset(asset)}
                      className="rounded p-1 text-paper-muted transition hover:bg-paper-goldbg hover:text-paper-gold"
                      title={t('assets.pin')}
                    >
                      <Pin className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onLocate(asset.pageNumber, asset.cropRect, asset.label)}
                      className="rounded p-1 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                      title={t('assets.source')}
                    >
                      <LocateFixed className="h-3 w-3" />
                    </button>
                  </div>
                  <BacklinkStrip backlinks={backlinksMap[asset.key]} onJumpToBacklink={jumpToCitation} />
                </div>
              );
            })}
          </div>
        )}

        {(tab === 'all' || tab === 'reference') && filteredReferences.length > 0 && (
          <div className="mt-2 space-y-1">
            {(tab === 'all' || filteredAssets.length > 0) && (
              <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-wider text-paper-muted">
                {t('reference.title')}
              </p>
            )}
            {filteredReferences.map((reference) => {
              const pinned = pinnedIds.includes(reference.key);
              return (
                <div
                  key={reference.key}
                  className="group flex flex-wrap items-start gap-x-2 gap-y-1.5 rounded-lg border border-transparent px-1.5 py-1.5 transition hover:border-paper-border hover:bg-paper-card"
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
                      {pinned && <span className="text-paper-goldtext">{t('pin.pinnedBadge')}</span>}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPinReference(reference)}
                    className="mt-0.5 rounded p-1 text-paper-muted opacity-0 transition hover:bg-paper-goldbg hover:text-paper-gold group-hover:opacity-100"
                    title={t('reference.pin')}
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                  <BacklinkStrip backlinks={backlinksMap[reference.key]} onJumpToBacklink={jumpToCitation} />
                </div>
              );
            })}
          </div>
        )}

        {tab !== 'outline' && !isParsing &&
          filteredAssets.length === 0 &&
          filteredReferences.length === 0 && (
            <p className="px-2 py-8 text-center text-[10px] leading-relaxed text-paper-muted">
              {t('assets.noMatches')}
            </p>
          )}
      </div>
    </aside>
  );
}
