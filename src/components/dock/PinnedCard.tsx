import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  Check,
  ChevronDown,
  Copy,
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
  const cardRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [copied, setCopied] = useState(false);

  useEffect(() => setDraft(item.title), [item.title]);
  useEffect(() => {
    if (highlighted && !isZoomedOverlay) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlighted, isZoomedOverlay]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const reference = item.reference;
  const isSnip = item.kind === 'snip';
  const isHorizontalDock = !isZoomedOverlay && (dockPosition === 'top' || dockPosition === 'bottom');
  const cropModified = hasCropChanged(item);

  const bibtex = reference
    ? `@inproceedings{${reference.key},\n  title={${reference.title ?? ''}},\n  author={${reference.authors ?? ''}},\n  year={${reference.year ?? ''}}\n}`
    : '';

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
        'group relative overflow-hidden rounded-xl border bg-white will-change-transform',
        isHorizontalDock
          ? item.collapsed
            ? 'flex h-auto w-[248px] shrink-0 self-start flex-col'
            : 'flex h-full w-[296px] shrink-0 flex-col'
          : 'w-full',
        !isZoomedOverlay &&
          'shadow-paper transition-[transform,box-shadow,border-color,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-paper-goldborder hover:shadow-float',
        isZoomedOverlay && 'border-paper-goldborder/90 ring-1 ring-amber-400/25',
        !isZoomedOverlay &&
          (highlighted
            ? 'border-paper-gold ring-2 ring-amber-400/50'
            : 'border-paper-border'),
        isLifted && !isZoomedOverlay && 'scale-[0.985] opacity-35',
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
        <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {item.kind === 'snip' ? 'Snip' : item.kind}
        </span>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              onRename(item.id, draft.trim() || item.title);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onRename(item.id, draft.trim() || item.title);
                setEditing(false);
              }
              if (event.key === 'Escape') {
                setDraft(item.title);
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
            title={isSnip ? '双击可重命名' : '点击跳回原页'}
          >
            {item.title}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onRequestCloseZoom?.();
            onJump(item.pageNumber, item.cropRect);
          }}
          className="shrink-0 rounded px-1 font-mono text-[10px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-gold"
          title="跳回原页"
        >
          P.{item.pageNumber}
        </button>

        {!isZoomedOverlay && (
          <>
            <button
              type="button"
              onClick={() => onMove(item.id, -1)}
              className="rounded p-0.5 text-paper-muted opacity-0 transition hover:text-paper-ink group-hover:opacity-100"
              aria-label={isHorizontalDock ? '左移' : '上移'}
              title={isHorizontalDock ? '左移' : '上移'}
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
              aria-label={isHorizontalDock ? '右移' : '下移'}
              title={isHorizontalDock ? '右移' : '下移'}
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
          aria-label={item.collapsed ? '展开' : '收起'}
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
          className="rounded p-0.5 text-paper-muted transition hover:text-red-500"
          aria-label="移除"
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
                alt={item.title}
                style={{ maxHeight: imageMaxHeight }}
                className={clsx(
                  'w-full cursor-zoom-in object-contain transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  isHorizontalDock && 'h-full',
                )}
                onClick={() => {
                  onRequestCloseZoom?.();
                  onOpenLightbox(item);
                }}
              />
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
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-white/95 px-1.5 py-1 text-[10px] text-paper-ink shadow-sm backdrop-blur-sm transition hover:border-paper-goldborder hover:bg-white"
                  title="向上扩展裁切区域"
                >
                  <ArrowUpToLine className="h-2.5 w-2.5" /> 扩上
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExpandCrop(item.id, 'down');
                  }}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-white/95 px-1.5 py-1 text-[10px] text-paper-ink shadow-sm backdrop-blur-sm transition hover:border-paper-goldborder hover:bg-white"
                  title="向下扩展裁切区域"
                >
                  <ArrowDownToLine className="h-2.5 w-2.5" /> 扩下
                </button>
                {cropModified && onResetCrop && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onResetCrop(item.id);
                    }}
                    className="flex items-center gap-0.5 rounded-md border border-paper-goldborder bg-paper-goldbg/95 px-1.5 py-1 text-[10px] font-medium text-paper-goldtext shadow-sm backdrop-blur-sm transition hover:bg-paper-goldsoft"
                    title="还原初始裁切范围"
                  >
                    <RotateCcw className="h-2.5 w-2.5" /> 还原
                  </button>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestCloseZoom?.();
                    onOpenLightbox(item);
                  }}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-white/95 px-1.5 py-1 text-[10px] text-paper-ink shadow-sm backdrop-blur-sm transition hover:border-paper-goldborder hover:bg-white"
                  title="全屏灯箱查看"
                >
                  <Maximize2 className="h-2.5 w-2.5" /> 灯箱
                </button>
              </div>
            </div>
          ) : reference ? (
            <div
              className={clsx(
                'rounded-lg bg-paper-bg px-2.5 py-2',
                isHorizontalDock && 'flex min-h-0 flex-1 flex-col overflow-hidden',
              )}
            >
              <p
                className={clsx(
                  'font-medium leading-snug text-paper-ink',
                  isZoomedOverlay ? 'text-xs' : 'text-[11px]',
                  isHorizontalDock && 'line-clamp-2',
                )}
              >
                {reference.title || `参考文献 [${reference.index}]`}
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
              <div className="mt-auto flex items-center gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(bibtex || reference.rawText);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                  className="flex items-center gap-1 rounded-md border border-paper-border bg-white px-1.5 py-1 text-[9px] text-paper-ink transition hover:bg-paper-goldbg"
                >
                  {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                  {copied ? '已复制' : '复制 BibTeX'}
                </button>
                <a
                  href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                    reference.title || reference.rawText,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md border border-paper-border bg-white px-1.5 py-1 text-[9px] text-paper-ink transition hover:bg-paper-goldbg"
                >
                  <Search className="h-2.5 w-2.5" /> Scholar
                  <ExternalLink className="h-2 w-2 text-paper-muted" />
                </a>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-paper-bg px-2.5 py-2 text-[10px] text-paper-muted">
              {item.previewStatus === 'restoring' ? '正在恢复裁切预览…' :
                item.previewStatus === 'unavailable' ? '预览恢复失败，可跳转至原页查看' : item.subtitle || '暂无预览图'}
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
