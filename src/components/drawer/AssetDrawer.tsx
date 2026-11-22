import type { MessageKey } from '../../i18n/types';
import { t } from '../../i18n/core';
import { useEffect, useMemo, useState } from 'react';
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
import { glossaryPinId } from '../../engine/backlinks';
import type { DrawerSection } from '../../store/useReaderStore';
import type {
  CitationBacklink,
  CitationKind,
  GlossaryEntry,
  NormalizedRect,
  OutlineItem,
  PaperAsset,
  ReferenceEntry,
} from '../../types/paper';
import { BacklinkStrip } from '../BacklinkStrip';

type DrawerTab = 'all' | CitationKind | 'outline' | 'glossary';
type GlossaryFilter = 'all' | GlossaryEntry['kind'];

interface AssetDrawerProps {
  open: boolean;
  section?: DrawerSection;
  onSectionChange?: (section: DrawerSection) => void;
  assets: PaperAsset[];
  outline?: OutlineItem[];
  glossary?: GlossaryEntry[];
  references: ReferenceEntry[];
  backlinksMap: Record<string, CitationBacklink[]>;
  onJumpToBacklink: (pageNumber: number, rect: NormalizedRect) => void;
  pinnedIds: string[];
  isParsing: boolean;
  parseProgress: number;
  onClose: () => void;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (reference: ReferenceEntry) => void;
  onPinGlossary?: (entry: GlossaryEntry) => void;
  onLocate: (pageNumber: number, rect?: NormalizedRect, label?: string) => void;
  /** Wide screens show the drawer beside the page instead of over it (only with a side dock). */
  allowPush?: boolean;
}

// Matches Tailwind's `2xl` breakpoint used for the side-by-side layout below.
const PUSH_QUERY = '(min-width: 1536px)';
const isPushed = (allowPush: boolean) =>
  allowPush && typeof window !== 'undefined' && window.matchMedia?.(PUSH_QUERY).matches === true;

const TABS = [
  { key: 'all', label: 'filter.all' },
  { key: 'figure', label: 'filter.figures' },
  { key: 'table', label: 'filter.tables' },
  { key: 'equation', label: 'filter.equations' },
  { key: 'algorithm', label: 'filter.algorithms' },
  { key: 'theorem', label: 'filter.theorems' },
  { key: 'glossary', label: 'filter.glossary' },
  { key: 'reference', label: 'filter.references' },
] as const satisfies ReadonlyArray<{ key: Exclude<DrawerTab, 'outline' | 'section'>; label: MessageKey }>;

export function OutlineBranch({ item, onJump }: { item: OutlineItem; onJump: (item: OutlineItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <li>
    <div className="flex items-center gap-1 rounded-md hover:bg-paper-bg">
      {item.children.length > 0
        ? <button type="button" aria-expanded={expanded} aria-label={t(expanded ? 'outline.collapse' : 'outline.expand', { title: item.title })}
            onClick={() => setExpanded(!expanded)} className="shrink-0 rounded p-1 text-paper-muted">
            <ChevronRight size={13} className={expanded ? 'rotate-90' : ''} />
          </button>
        : <span className="w-5 shrink-0" />}
      <button type="button" disabled={item.pageNumber === null && !item.domAnchorId} onClick={() => onJump(item)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left text-xs text-paper-ink disabled:text-paper-muted">
        <span className="min-w-0 flex-1 break-words">{item.title}</span>
        {item.pageNumber !== null && <span className="rounded-full border border-paper-border px-1.5 font-mono text-[11px] text-paper-muted">{item.pageNumber}</span>}
      </button>
    </div>
    {expanded && <ul className="ml-2 border-l border-paper-border pl-2">
      {item.children.map(child => <OutlineBranch key={child.id} item={child} onJump={onJump} />)}
    </ul>}
  </li>;
}

export function AssetDrawer({
  open,
  section = 'assets',
  onSectionChange,
  assets,
  outline = [],
  glossary = [],
  references,
  backlinksMap,
  onJumpToBacklink,
  pinnedIds,
  isParsing,
  parseProgress,
  onClose,
  onPinAsset,
  onPinReference,
  onPinGlossary,
  onLocate,
  allowPush = false,
}: AssetDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>(() => (
    section === 'outline' ? 'outline' : section === 'glossary' ? 'glossary' : 'all'
  ));
  const [query, setQuery] = useState('');
  const [glossaryFilter, setGlossaryFilter] = useState<GlossaryFilter>('all');

  useEffect(() => {
    if (section === 'outline' && tab !== 'outline') setTab('outline');
    else if (section === 'glossary' && tab !== 'glossary') setTab('glossary');
    else if (section === 'assets' && tab === 'outline') setTab('all');
  }, [section]);

  const selectSection = (nextSection: DrawerSection, nextTab: DrawerTab) => {
    setTab(nextTab);
    onSectionChange?.(nextSection);
  };

  // Over the page the drawer gets out of the way after a jump; beside the page it stays open.
  const closeIfOverlay = () => { if (!isPushed(allowPush)) onClose(); };
  const locate = (pageNumber: number, rect?: NormalizedRect, label?: string) => {
    closeIfOverlay();
    onLocate(pageNumber, rect, label);
  };
  const jumpToCitation = (pageNumber: number, rect: NormalizedRect) => {
    closeIfOverlay();
    onJumpToBacklink(pageNumber, rect);
  };

  const visualAssets = useMemo(() => assets.filter(asset => asset.kind !== 'section'), [assets]);
  // PDFs without an embedded outline still get a table of contents from detected headings.
  const outlineItems = useMemo<OutlineItem[]>(() => outline.length ? outline : assets
    .filter(asset => asset.kind === 'section')
    .map(asset => ({ id: asset.key, title: asset.label, pageNumber: asset.pageNumber, destY: asset.cropRect.y, children: [] })),
  [outline, assets]);

  const filteredAssets = useMemo(() => {
    if (tab === 'outline' || tab === 'glossary' || tab === 'reference') return [];
    const keyword = query.trim().toLowerCase();
    return visualAssets.filter((asset) => {
      if (tab !== 'all' && tab !== asset.kind) return false;
      if (!keyword) return true;
      return (
        asset.label.toLowerCase().includes(keyword) ||
        asset.caption.toLowerCase().includes(keyword)
      );
    });
  }, [visualAssets, tab, query]);

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

  const filteredGlossary = useMemo(() => {
    if (tab !== 'all' && tab !== 'glossary') return [];
    const keyword = query.trim().toLowerCase();
    return glossary.filter((entry) => {
      if (tab === 'glossary' && glossaryFilter !== 'all' && entry.kind !== glossaryFilter) return false;
      if (!keyword) return true;
      return (
        entry.term.toLowerCase().includes(keyword) ||
        entry.expansion.toLowerCase().includes(keyword) ||
        entry.contextSentence.toLowerCase().includes(keyword)
      );
    });
  }, [glossary, tab, glossaryFilter, query]);

  const counts: Record<Exclude<DrawerTab, 'outline'>, number> = {
    all: visualAssets.length + glossary.length + references.length,
    glossary: glossary.length,
    reference: references.length,
    figure: 0, table: 0, equation: 0, algorithm: 0, theorem: 0, section: 0,
  };
  for (const asset of visualAssets) counts[asset.kind]++;
  const acronymCount = useMemo(() => glossary.filter((e) => e.kind === 'acronym').length, [glossary]);
  const symbolCount = glossary.length - acronymCount;

  const isAssetSection = tab !== 'outline';

  return (
    <aside
      className={clsx(
        'absolute inset-y-0 left-0 z-30 flex w-[288px] flex-col border-r border-paper-border bg-paper-card/95 shadow-float backdrop-blur transition-transform duration-200',
        open ? 'visible translate-x-0' : 'invisible -translate-x-full',
        allowPush && 'order-first 2xl:relative 2xl:shrink-0 2xl:bg-paper-card 2xl:shadow-none 2xl:backdrop-blur-none',
        allowPush && !open && '2xl:hidden',
      )}
      aria-hidden={!open}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-paper-border px-3">
        <button type="button" aria-pressed={isAssetSection} onClick={() => selectSection('assets', 'all')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-paper-muted aria-pressed:bg-paper-bg aria-pressed:font-medium aria-pressed:text-paper-ink">
          {t('assets.title')}<span className="font-mono text-[11px] text-paper-goldtext">{counts.all}</span>
        </button>
        <button type="button" aria-pressed={tab === 'outline'} onClick={() => selectSection('outline', 'outline')}
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

      {isAssetSection && <div className="shrink-0 px-2.5 pt-2.5">
        <label className="flex items-center gap-1.5 rounded-lg border border-paper-border bg-paper-bg px-2 py-1.5 focus-within:border-paper-gold">
          <Search className="h-3.5 w-3.5 text-paper-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('assets.search')}
            aria-label={t('assets.search')}
            className="w-full bg-transparent text-xs text-paper-ink outline-none placeholder:text-paper-muted"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-paper-muted hover:text-paper-ink">
              <X className="h-3 w-3" />
            </button>
          )}
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {TABS.filter((item) => item.key === 'all' || item.key === tab || counts[item.key] > 0).map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => selectSection(item.key === 'glossary' ? 'glossary' : 'assets', item.key)}
              className={clsx(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition',
                tab === item.key
                  ? 'bg-paper-ink text-paper-card'
                  : 'text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
              )}
            >
              {t(item.label)}
              <span
                className={clsx(
                  'font-mono text-[11px]',
                  tab === item.key ? 'text-paper-card/70' : 'text-paper-muted',
                )}
              >
                {counts[item.key]}
              </span>
            </button>
          ))}
        </div>

        {tab === 'glossary' && glossary.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-paper-border/60 pt-1.5">
            {(
              [
                { key: 'all', label: t('filter.all'), count: glossary.length },
                { key: 'acronym', label: t('glossary.acronyms'), count: acronymCount },
                { key: 'symbol', label: t('glossary.symbols'), count: symbolCount },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={glossaryFilter === item.key}
                onClick={() => setGlossaryFilter(item.key)}
                className={clsx(
                  'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition',
                  glossaryFilter === item.key
                    ? 'border border-paper-goldborder bg-paper-goldbg font-medium text-paper-goldtext'
                    : 'text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
                )}
              >
                {item.label}
                <span className="font-mono text-[11px]">{item.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
        {isParsing && (
          <div className="mb-2.5 rounded-lg border border-paper-goldborder bg-paper-goldbg px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px] text-paper-goldtext">
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
          {outlineItems.length ? <ul>{outlineItems.map(item => <OutlineBranch key={item.id} item={item} onJump={entry => {
            if (entry.pageNumber === null) return;
            const rect = entry.destY === undefined ? undefined : { x: 0.05, y: entry.destY, width: 0.9, height: 0.018 };
            locate(entry.pageNumber, rect, entry.title);
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
                    onClick={() => locate(asset.pageNumber, asset.cropRect, asset.label)}
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
                      <span className="truncate text-xs font-medium text-paper-ink">
                        {asset.label}
                      </span>
                      {pinned && (
                        <span className="rounded bg-paper-goldbg px-1 text-[11px] text-paper-goldtext">
                          {t('pin.pinned')}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-paper-muted"><span className="mr-1.5 rounded bg-paper-goldbg px-1 text-paper-goldtext">{t(`kind.${asset.kind}`)}</span>{t('reader.page', { page: asset.pageNumber })}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onPinAsset(asset)}
                      className="rounded p-1 text-paper-muted transition hover:bg-paper-goldbg hover:text-paper-gold"
                      title={t('assets.pin')}
                      aria-label={t('assets.pin')}
                    >
                      <Pin className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => locate(asset.pageNumber, asset.cropRect, asset.label)}
                      className="rounded p-1 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                      title={t('assets.source')}
                      aria-label={t('assets.source')}
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

        {(tab === 'all' || tab === 'glossary') && filteredGlossary.length > 0 && (
          <div className={clsx('space-y-1.5', tab === 'all' && filteredAssets.length > 0 && 'mt-2.5')}>
            {tab === 'all' && (
              <p className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-paper-muted">
                {t('glossary.title')}
              </p>
            )}
            {filteredGlossary.map((entry) => {
              const pinId = glossaryPinId(entry.term);
              const pinned = pinnedIds.includes(pinId);
              return (
                <article
                  key={entry.term}
                  className="group rounded-lg border border-paper-border bg-paper-card p-2 transition hover:border-paper-goldborder"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => locate(entry.definedPage, entry.definedRect, entry.term)}
                      className="shrink-0 rounded border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 font-mono text-[11px] font-semibold text-paper-goldtext transition hover:bg-paper-goldsoft"
                    >
                      {entry.term}
                    </button>
                    <span className="rounded bg-paper-bg px-1.5 py-0.5 text-[11px] text-paper-muted">
                      {t(entry.kind === 'acronym' ? 'glossary.acronyms' : 'glossary.symbols')}
                    </span>
                    {pinned && (
                      <span className="rounded bg-paper-goldbg px-1 text-[11px] text-paper-goldtext">
                        {t('pin.pinned')}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-paper-muted">
                      {t('reader.page', { page: entry.definedPage })}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {onPinGlossary && (
                        <button
                          type="button"
                          onClick={() => onPinGlossary(entry)}
                          className="rounded p-1 text-paper-muted transition hover:bg-paper-goldbg hover:text-paper-gold"
                          title={t('glossary.pin')}
                          aria-label={t('glossary.pin')}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => locate(entry.definedPage, entry.definedRect, entry.term)}
                        className="rounded p-1 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                        title={t('glossary.jump')}
                        aria-label={t('glossary.jump')}
                      >
                        <LocateFixed className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs font-medium leading-snug text-paper-ink">
                    {entry.expansion}
                  </p>
                  {entry.contextSentence && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-paper-muted">
                      {entry.contextSentence}
                    </p>
                  )}
                  <BacklinkStrip backlinks={backlinksMap[pinId]} onJumpToBacklink={jumpToCitation} />
                </article>
              );
            })}
          </div>
        )}

        {(tab === 'all' || tab === 'reference') && filteredReferences.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {(tab === 'all' || filteredAssets.length > 0 || filteredGlossary.length > 0) && (
              <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-paper-muted">
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
                  <span className="mt-0.5 w-8 shrink-0 font-mono text-[11px] text-paper-muted">
                    [{reference.index}]
                  </span>
                  <button
                    type="button"
                    onClick={() => locate(reference.pageNumber, undefined, `[${reference.index}]`)}
                    title={t('assets.source')}
                    className="min-w-0 flex-1 text-left hover:text-paper-gold"
                  >
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-paper-ink">
                      {reference.title || reference.rawText}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-paper-muted">
                      <FileText className="h-2.5 w-2.5" />
                      {[reference.authors, reference.year].filter(Boolean).join(' · ')}
                      {pinned && <span className="text-paper-goldtext">{t('pin.pinnedBadge')}</span>}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPinReference(reference)}
                    className="mt-0.5 rounded p-1 text-paper-muted transition hover:bg-paper-goldbg hover:text-paper-gold"
                    title={t('reference.pin')}
                    aria-label={t('reference.pin')}
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                  <BacklinkStrip backlinks={backlinksMap[reference.key]} onJumpToBacklink={jumpToCitation} />
                </div>
              );
            })}
          </div>
        )}

        {isAssetSection && !isParsing &&
          filteredAssets.length === 0 &&
          filteredGlossary.length === 0 &&
          filteredReferences.length === 0 && (
            <p className="px-2 py-8 text-center text-[11px] leading-relaxed text-paper-muted">
              {t(tab === 'glossary' ? 'panel.glossaryEmpty' : 'assets.noMatches')}
            </p>
          )}
      </div>
    </aside>
  );
}
