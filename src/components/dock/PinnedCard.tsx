import { ReferenceDetails } from '../peek/ReferenceDetails';
import { usePreviewColor } from '../peek/usePreviewColor';
import { pinTitle } from '../../i18n/pinTitle';
import { t } from '../../i18n/core';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ExternalLink,
  Maximize2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { CitationBacklink, DockPosition, NormalizedRect, PinnedItem } from '../../types/paper';
import { BacklinkStrip } from '../BacklinkStrip';

export function hasCropChanged(item: PinnedItem): boolean {
  if (!item.originalCropRect || !item.cropRect) return false;
  const eps = 1e-4;
  return (
    Math.abs(item.cropRect.x - item.originalCropRect.x) > eps ||
    Math.abs(item.cropRect.y - item.originalCropRect.y) > eps ||
    Math.abs(item.cropRect.width - item.originalCropRect.width) > eps ||
    Math.abs(item.cropRect.height - item.originalCropRect.height) > eps
  );
}

interface PinnedCardProps {
  item: PinnedItem;
  backlinks?: CitationBacklink[];
  onJumpToBacklink: (pageNumber: number, rect: NormalizedRect) => void;
  highlighted?: boolean;
  dockPosition?: DockPosition;
  dockWidth?: number;
  dockHeight?: number;
  isLifted?: boolean;
  isZoomedOverlay?: boolean;
  onUnpin: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onJump: (pageNumber: number, cropRect?: PinnedItem['cropRect']) => void;
  onExpandCrop: (id: string, direction: 'up' | 'down') => void;
  onResetCrop?: (id: string) => void;
  onOpenLightbox: (item: PinnedItem) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onHoverStart?: (id: string, el: HTMLElement) => void;
  onHoverEnd?: (id: string) => void;
  onRequestCloseZoom?: () => void;
}

export function PinnedCard({
  item,
  backlinks,
  onJumpToBacklink,
  highlighted,
  dockPosition = 'right',
  dockWidth = 388,
  dockHeight = 264,
  isLifted = false,
  isZoomedOverlay = false,
  onUnpin,
  onToggleCollapse,
  onJump,
  onExpandCrop,
  onResetCrop,
  onOpenLightbox,
  onRename,
  onMove,
  onHoverStart,
  onHoverEnd,
  onRequestCloseZoom,
}: PinnedCardProps) {
  const { filter, colorToggle } = usePreviewColor(item.id);
  const cardRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const displayTitle = pinTitle(item);
  const [draft, setDraft] = useState(displayTitle);

  useEffect(() => setDraft(displayTitle), [displayTitle]);
  useEffect(() => {
    if (highlighted && !isZoomedOverlay) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlighted, isZoomedOverlay]);

  const reference = item.reference;
  const isSnip = item.kind === 'snip';
  const isHorizontalDock = !isZoomedOverlay && (dockPosition === 'top' || dockPosition === 'bottom');
  const cropModified = hasCropChanged(item);

  const imageMaxHeight = isZoomedOverlay
    ? 'min(58vh, 520px)'
    : isHorizontalDock
      ? '100%'
      : `${Math.round(Math.min(460, Math.max(220, dockWidth * 0.62)))}px`;

  return (
    <article
      ref={cardRef}
      onMouseEnter={() => {
        if (isZoomedOverlay || item.collapsed || editing) return;
        if (cardRef.current) onHoverStart?.(item.id, cardRef.current);
      }}
      onMouseLeave={() => {
        if (isZoomedOverlay) return;
        onHoverEnd?.(item.id);
      }}
      className={clsx(
        'group relative overflow-hidden rounded-xl border bg-paper-card will-change-transform',
        isHorizontalDock
          ? item.collapsed
            ? 'flex h-auto w-[248px] shrink-0 self-start flex-col'
            : 'flex h-full w-[296px] shrink-0 flex-col'
          : 'w-full',
        !isZoomedOverlay &&
          'shadow-paper transition-[transform,box-shadow,border-color,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-paper-goldborder hover:shadow-float',
        isZoomedOverlay && 'border-paper-goldborder/90 ring-1 ring-paper-gold/25',
        !isZoomedOverlay &&
          (highlighted
            ? 'border-paper-gold ring-2 ring-paper-gold/50'
            : 'border-paper-border'),
        isLifted && !isZoomedOverlay && 'scale-[0.985] opacity-35',
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
        <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {t(`kind.${item.kind}`)}
        </span>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              onRename(item.id, draft.trim() || displayTitle);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onRename(item.id, draft.trim() || displayTitle);
                setEditing(false);
              }
              if (event.key === 'Escape') {
                setDraft(displayTitle);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 text-[11px] text-paper-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!isSnip) {
                onRequestCloseZoom?.();
                onJump(item.pageNumber, item.cropRect);
              }
            }}
            onDoubleClick={() => {
              if (isSnip) {
                setEditing(true);
              }
            }}
            className={clsx(
              'min-w-0 flex-1 truncate text-left font-medium text-paper-ink hover:text-paper-gold',
              isZoomedOverlay ? 'text-xs' : 'text-[11px]',
            )}
            title={isSnip ? t('pin.renameHint') : t('pin.jumpHint')}
          >
            {displayTitle}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onRequestCloseZoom?.();
            onJump(item.pageNumber, item.cropRect);
          }}
          className="shrink-0 rounded px-1 font-mono text-[10px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-gold"
          title={t('pin.jump')}
        >
          {t('reader.page', { page: item.pageNumber })}
        </button>

        {!isZoomedOverlay && (
          <>
            <button
              type="button"
              onClick={() => onMove(item.id, -1)}
              className="rounded p-0.5 text-paper-muted opacity-0 transition hover:text-paper-ink group-hover:opacity-100"
              aria-label={isHorizontalDock ? t('pin.moveLeft') : t('pin.moveUp')}
              title={isHorizontalDock ? t('pin.moveLeft') : t('pin.moveUp')}
            >
              {isHorizontalDock ? (
                <ArrowLeft className="h-3 w-3" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onMove(item.id, 1)}
              className="rounded p-0.5 text-paper-muted opacity-0 transition hover:text-paper-ink group-hover:opacity-100"
              aria-label={isHorizontalDock ? t('pin.moveRight') : t('pin.moveDown')}
              title={isHorizontalDock ? t('pin.moveRight') : t('pin.moveDown')}
            >
              {isHorizontalDock ? (
                <ArrowRight className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            onRequestCloseZoom?.();
            onToggleCollapse(item.id);
          }}
          className="rounded p-0.5 text-paper-muted transition hover:text-paper-ink"
          aria-label={item.collapsed ? t('common.expand') : t('common.collapse')}
        >
          <ChevronDown
            className={clsx('h-3.5 w-3.5 transition-transform', item.collapsed && '-rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            onRequestCloseZoom?.();
            onUnpin(item.id);
          }}
          className="rounded p-0.5 text-paper-muted transition hover:text-paper-gold"
          aria-label={t('common.remove')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!item.collapsed && (
        <div
          className={clsx(
            'px-2.5 pb-2.5',
            isHorizontalDock && 'flex min-h-0 flex-1 flex-col',
          )}
        >
          {item.imageUrl ? (
            <div
              className={clsx(
                'group/image relative overflow-hidden rounded-lg border border-paper-border bg-paper-bg',
                isHorizontalDock && 'flex min-h-0 flex-1 items-center justify-center',
              )}
            >
              <img
                src={item.imageUrl}
                alt={displayTitle}
                style={{ maxHeight: imageMaxHeight, filter }}
                className={clsx(
                  'w-full cursor-zoom-in object-contain transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  isHorizontalDock && 'h-full',
                )}
                onClick={() => {
                  onRequestCloseZoom?.();
                  onOpenLightbox(item);
                }}
              />
              <div className="absolute right-1.5 top-1.5">{colorToggle}</div>
              <div
                className={clsx(
                  'absolute inset-x-1.5 bottom-1.5 flex flex-wrap items-center justify-center gap-1 transition-opacity duration-200',
                  isZoomedOverlay
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/image:opacity-100',
                )}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExpandCrop(item.id, 'up');
                  }}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-paper-card/95 px-1.5 py-1 text-[10px] text-paper-ink shadow-sm backdrop-blur-sm transition hover:border-paper-goldborder hover:bg-paper-card"
                  title={t('crop.upHint')}
                >
                  <ArrowUpToLine className="h-2.5 w-2.5" /> {t('crop.up')}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExpandCrop(item.id, 'down');
                  }}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-paper-card/95 px-1.5 py-1 text-[10px] text-paper-ink shadow-sm backdrop-blur-sm transition hover:border-paper-goldborder hover:bg-paper-card"
                  title={t('crop.downHint')}
                >
                  <ArrowDownToLine className="h-2.5 w-2.5" /> {t('crop.down')}
                </button>
                {cropModified && onResetCrop && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onResetCrop(item.id);
                    }}
                    className="flex items-center gap-0.5 rounded-md border border-paper-goldborder bg-paper-goldbg/95 px-1.5 py-1 text-[10px] font-medium text-paper-goldtext shadow-sm backdrop-blur-sm transition hover:bg-paper-goldsoft"
                    title={t('crop.resetHint')}
                  >
                    <RotateCcw className="h-2.5 w-2.5" /> {t('crop.reset')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestCloseZoom?.();
                    onOpenLightbox(item);
                  }}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-paper-card/95 px-1.5 py-1 text-[10px] text-paper-ink shadow-sm backdrop-blur-sm transition hover:border-paper-goldborder hover:bg-paper-card"
                  title={t('lightbox.openHint')}
                >
                  <Maximize2 className="h-2.5 w-2.5" /> {t('lightbox.open')}
                </button>
              </div>
            </div>
          ) : reference ? (
            <div
              className={clsx(
                'rounded-lg bg-paper-bg px-2.5 py-2',
                isHorizontalDock && 'flex min-h-0 flex-1 flex-col overflow-y-auto',
              )}
            >
              <p
                className={clsx(
                  'font-medium leading-snug text-paper-ink',
                  isZoomedOverlay ? 'text-xs' : 'text-[11px]',
                  isHorizontalDock && 'line-clamp-2',
                )}
              >
                {reference.title || t('reference.number', { index: reference.index })}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                {reference.authors && (
                  <span
                    className={clsx(
                      'text-paper-muted',
                      isHorizontalDock && 'truncate',
                    )}
                  >
                    {reference.authors}
                  </span>
                )}
                {reference.year && (
                  <span className="rounded bg-paper-goldbg px-1 py-0.5 font-mono text-paper-goldtext">
                    {reference.year}
                  </span>
                )}
              </div>
              <p
                className={clsx(
                  'mt-2 leading-relaxed text-paper-muted',
                  isZoomedOverlay
                    ? 'max-h-[34vh] overflow-y-auto text-[11px]'
                    : isHorizontalDock
                      ? 'line-clamp-2 text-[10px]'
                      : 'line-clamp-3 text-[10px]',
                )}
              >
                {reference.rawText}
              </p>
              <ReferenceDetails key={reference.key} reference={reference} />
              <div className="mt-auto flex items-center gap-1.5 pt-2">
                <a
                  href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                    reference.title || reference.rawText,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md border border-paper-border bg-paper-card px-1.5 py-1 text-[9px] text-paper-ink transition hover:bg-paper-goldbg"
                >
                  <Search className="h-2.5 w-2.5" /> Scholar
                  <ExternalLink className="h-2 w-2 text-paper-muted" />
                </a>
              </div>
            </div>
          ) : item.kind === 'glossary' ? (
            <div
              className={clsx(
                'rounded-lg bg-paper-bg px-2.5 py-2',
                isHorizontalDock && 'flex min-h-0 flex-1 flex-col overflow-y-auto',
              )}
            >
              {item.subtitle && (
                <p
                  className={clsx(
                    'font-medium leading-snug text-paper-ink',
                    isZoomedOverlay ? 'text-xs' : 'text-[11px]',
                    isHorizontalDock && 'line-clamp-2',
                  )}
                >
                  {item.subtitle}
                </p>
              )}
              {item.textPreview && (
                <p
                  className={clsx(
                    'mt-1.5 leading-relaxed text-paper-muted',
                    isZoomedOverlay
                      ? 'max-h-[34vh] overflow-y-auto text-[11px]'
                      : isHorizontalDock
                        ? 'line-clamp-2 text-[10px]'
                        : 'line-clamp-3 text-[10px]',
                  )}
                >
                  {item.textPreview}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-paper-bg px-2.5 py-2 text-[10px] text-paper-muted">
              {item.previewStatus === 'restoring' ? t('pin.restoring') :
                item.previewStatus === 'unavailable' ? t('pin.unavailable') : item.subtitle || t('pin.noPreview')}
            </p>
          )}

          {item.imageUrl && item.subtitle && (
            <p
              className={clsx(
                'mt-1.5 shrink-0 leading-relaxed text-paper-muted',
                isZoomedOverlay
                  ? 'line-clamp-5 text-[11px]'
                  : isHorizontalDock
                    ? 'line-clamp-1 text-[10px]'
                    : 'line-clamp-2 text-[10px]',
              )}
            >
              {item.subtitle}
            </p>
          )}
          {!!backlinks?.length && (
            <div className="mt-1.5">
              <BacklinkStrip backlinks={backlinks} onJumpToBacklink={(pageNumber, rect) => {
                onRequestCloseZoom?.();
                onJumpToBacklink(pageNumber, rect);
              }} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}
