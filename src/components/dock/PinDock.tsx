import type { MessageKey } from '../../i18n/types';
import { t } from '../../i18n/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Eraser,
  Download,
  Loader2,
  ArrowUpRight,
  ChevronDown,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  GripVertical,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Pin,
} from 'lucide-react';
import clsx from 'clsx';
import type { CitationBacklink, DockPosition, InlineCitation, NormalizedRect, PaperAsset, PinnedItem } from '../../types/paper';
import { currentPageAssets } from '../../engine/backlinks';
import { useReaderStore } from '../../store/useReaderStore';
import { PinnedCard } from './PinnedCard';

interface PinDockProps {
  currentPage: number;
  citations: InlineCitation[];
  assetsMap: Record<string, PaperAsset>;
  onPreviewAsset: (asset: PaperAsset) => void;
  onPinAsset: (asset: PaperAsset) => void;
  items: PinnedItem[];
  backlinksMap: Record<string, CitationBacklink[]>;
  onJumpToBacklink: (pageNumber: number, rect: NormalizedRect) => void;
  highlightedId?: string | null;
  position: DockPosition;
  width: number;
  height: number;
  dockCollapsed?: boolean;
  onDockCollapsedChange?: (collapsed: boolean) => void;
  workspaceRef?: RefObject<HTMLDivElement>;
  onPositionChange: (position: DockPosition) => void;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onUnpin: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onJump: (pageNumber: number, cropRect?: PinnedItem['cropRect']) => void;
  onExpandCrop: (id: string, direction: 'up' | 'down') => void;
  onResetCrop?: (id: string) => void;
  onOpenLightbox: (item: PinnedItem) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onExport?: (mode: 'copy' | 'zip') => void;
  exporting?: boolean;
  onClear: () => void;
}

interface CardRectSnapshot {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const MIN_DOCK_WIDTH = 220;
const MIN_DOCK_HEIGHT = 148;
const MIN_MAIN_WIDTH = 220;
const MIN_MAIN_HEIGHT = 180;

const POSITION_OPTIONS = [
  { key: 'left', hint: 'dock.moveLeft', Icon: PanelLeft },
  { key: 'right', hint: 'dock.moveRight', Icon: PanelRight },
  { key: 'top', hint: 'dock.moveTop', Icon: PanelTop },
  { key: 'bottom', hint: 'dock.moveBottom', Icon: PanelBottom },
] as const satisfies ReadonlyArray<{
  key: DockPosition;
  hint: MessageKey;
  Icon: typeof PanelRight;
}>;

const DROP_LABEL = {
  left: 'dock.dropLeft',
  right: 'dock.dropRight',
  top: 'dock.dropTop',
  bottom: 'dock.dropBottom',
} as const satisfies Record<DockPosition, MessageKey>;

function computeNearestEdge(clientX: number, clientY: number, rect: DOMRect): DockPosition {
  const nx = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  const ny = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
  const candidates: Array<{ pos: DockPosition; dist: number }> = [
    { pos: 'left', dist: nx },
    { pos: 'right', dist: 1 - nx },
    { pos: 'top', dist: ny },
    { pos: 'bottom', dist: 1 - ny },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].pos;
}

export function PinDock({
  currentPage, citations, assetsMap, onPreviewAsset, onPinAsset,
  items,
  backlinksMap,
  onJumpToBacklink,
  highlightedId,
  position,
  width,
  height,
  dockCollapsed: dockCollapsedProp,
  onDockCollapsedChange,
  workspaceRef,
  onPositionChange,
  onWidthChange,
  onHeightChange,
  onUnpin,
  onToggleCollapse,
  onJump,
  onExpandCrop,
  onResetCrop,
  onOpenLightbox,
  onRename,
  onMove: move, onExport, exporting,
  onClear,
}: PinDockProps) {
  const enabled = useReaderStore(state => state.autoSyncEnabled);
  const setEnabled = useReaderStore(state => state.setAutoSyncEnabled);
  const storeDockCollapsed = useReaderStore(state => state.dockCollapsed);
  const setStoreDockCollapsed = useReaderStore(state => state.setDockCollapsed);
  const isDockCollapsed = dockCollapsedProp ?? storeDockCollapsed;
  const setDockCollapsed = useCallback(
    (next: boolean) => {
      if (onDockCollapsedChange) onDockCollapsedChange(next);
      else setStoreDockCollapsed(next);
    },
    [onDockCollapsedChange, setStoreDockCollapsed],
  );
  const [syncCollapsed, setSyncCollapsed] = useState(false);
  const synced = useMemo(() => enabled ? currentPageAssets(currentPage, citations, assetsMap, items) : [],
    [enabled, currentPage, citations, assetsMap, items]);
  const showSynced = enabled && !syncCollapsed;
  const [exportMenu, setExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportMenu) return;
    const outside = (event: PointerEvent) => { if (!exportRef.current?.contains(event.target as Node)) setExportMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExportMenu(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [exportMenu]);
  const [isResizing, setIsResizing] = useState(false);
  const [dragDropPreview, setDragDropPreview] = useState<{
    target: DockPosition;
    bounds: CardRectSnapshot;
  } | null>(null);
  const [viewportTick, setViewportTick] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{
    axis: 'x' | 'y';
    pos: DockPosition;
    startPointer: number;
    startSize: number;
  } | null>(null);
  const dockDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    target: DockPosition;
  } | null>(null);

  const isHorizontal = position === 'top' || position === 'bottom';

  // 监听窗口大小变化以动态夹紧宽度/高度
  useEffect(() => {
    const onResize = () => {
      setViewportTick((v) => v + 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 按 Esc 取消拖动停靠
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dockDragRef.current) return;
      dockDragRef.current = null;
      setDragDropPreview(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const getWorkspaceRect = useCallback((): DOMRect => {
    if (workspaceRef?.current) {
      return workspaceRef.current.getBoundingClientRect();
    }
    return new DOMRect(0, 52, window.innerWidth, Math.max(300, window.innerHeight - 52));
  }, [workspaceRef]);

  // 拖拽调整钉板宽/高
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (resizingRef.current) {
        const { axis, pos, startPointer, startSize } = resizingRef.current;
        const wsRect = getWorkspaceRect();
        if (axis === 'x') {
          const delta =
            pos === 'right' ? startPointer - event.clientX : event.clientX - startPointer;
          const maxWidth = Math.max(MIN_DOCK_WIDTH + 80, wsRect.width - MIN_MAIN_WIDTH);
          const next = Math.min(maxWidth, Math.max(MIN_DOCK_WIDTH, startSize + delta));
          onWidthChange(next);
        } else {
          const delta =
            pos === 'bottom' ? startPointer - event.clientY : event.clientY - startPointer;
          const maxHeight = Math.max(MIN_DOCK_HEIGHT + 80, wsRect.height - MIN_MAIN_HEIGHT);
          const next = Math.min(maxHeight, Math.max(MIN_DOCK_HEIGHT, startSize + delta));
          onHeightChange(next);
        }
        return;
      }

      if (dockDragRef.current) {
        const drag = dockDragRef.current;
        const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.active && dist < 6) return;

        if (!drag.active) {
          drag.active = true;
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
        }

        const wsRect = getWorkspaceRect();
        const target = computeNearestEdge(event.clientX, event.clientY, wsRect);
        drag.target = target;
        setDragDropPreview({
          target,
          bounds: {
            top: wsRect.top,
            left: wsRect.left,
            right: wsRect.right,
            bottom: wsRect.bottom,
            width: wsRect.width,
            height: wsRect.height,
          },
        });
      }
    };

    const onUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (dockDragRef.current) {
        const { active, target } = dockDragRef.current;
        dockDragRef.current = null;
        setDragDropPreview(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (active && target !== position) {
          onPositionChange(target);
        }
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [
    getWorkspaceRect,
    onHeightChange,
    onPositionChange,
    onWidthChange,
    position,
  ]);

  const clampedWidth = useMemo(() => {
    void viewportTick;
    const maxW =
      typeof window === 'undefined'
        ? 960
        : Math.max(MIN_DOCK_WIDTH + 80, (workspaceRef?.current?.clientWidth ?? window.innerWidth) - MIN_MAIN_WIDTH);
    return Math.min(maxW, Math.max(MIN_DOCK_WIDTH, width));
  }, [width, viewportTick, workspaceRef]);

  const clampedHeight = useMemo(() => {
    void viewportTick;
    const maxH =
      typeof window === 'undefined'
        ? 600
        : Math.max(
            MIN_DOCK_HEIGHT + 80,
            (workspaceRef?.current?.clientHeight ?? window.innerHeight - 52) - MIN_MAIN_HEIGHT,
          );
    return Math.min(maxH, Math.max(MIN_DOCK_HEIGHT, height));
  }, [height, viewportTick, workspaceRef]);


  const allHorizontalCollapsed =
    isHorizontal && !showSynced && items.length > 0 && items.every((item) => Boolean(item.collapsed));

  const dockStyle: CSSProperties = isHorizontal
    ? allHorizontalCollapsed
      ? { height: 'auto' }
      : { height: clampedHeight }
    : { width: clampedWidth };

  const dockOrderClass = position === 'left' || position === 'top' ? 'order-first' : 'order-last';
  const dockBorderClass =
    position === 'right'
      ? 'border-l'
      : position === 'left'
        ? 'border-r'
        : position === 'top'
          ? 'border-b'
          : 'border-t';

  const resizeHandleClass =
    position === 'right'
      ? '-left-1.5 top-0 h-full w-3 cursor-col-resize'
      : position === 'left'
        ? '-right-1.5 top-0 h-full w-3 cursor-col-resize'
        : position === 'top'
          ? '-bottom-1.5 left-0 h-3 w-full cursor-row-resize'
          : '-top-1.5 left-0 h-3 w-full cursor-row-resize';

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    resizingRef.current = {
      axis: isHorizontal ? 'y' : 'x',
      pos: position,
      startPointer: isHorizontal ? event.clientY : event.clientX,
      startSize: isHorizontal ? clampedHeight : clampedWidth,
    };
    setIsResizing(true);
    document.body.style.cursor = isHorizontal ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startDockDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a')) return;
    dockDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: position,
    };
  };

  const CollapseIcon =
    position === 'right'
      ? ChevronsRight
      : position === 'left'
        ? ChevronsLeft
        : position === 'top'
          ? ChevronsUp
          : ChevronsDown;
  const ExpandIcon =
    position === 'right'
      ? ChevronsLeft
      : position === 'left'
        ? ChevronsRight
        : position === 'top'
          ? ChevronsDown
          : ChevronsUp;

  if (isDockCollapsed) {
    return (
      <aside
        className={clsx(
          'relative z-10 flex shrink-0 border-paper-border bg-paper-card/90',
          dockOrderClass,
          dockBorderClass,
          isHorizontal ? 'h-9 w-full flex-row items-center' : 'h-full w-9 flex-col items-center',
        )}
      >
        <button
          type="button"
          onClick={() => setDockCollapsed(false)}
          title={t('dock.expand')}
          aria-label={t('dock.expand')}
          aria-expanded={false}
          className={clsx(
            'group flex h-full w-full items-center gap-1.5 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink',
            isHorizontal ? 'flex-row px-3' : 'flex-col py-3',
          )}
        >
          <ExpandIcon className="h-3.5 w-3.5 shrink-0 transition group-hover:text-paper-gold" />
          <Pin className="h-3.5 w-3.5 shrink-0 text-paper-gold" />
          {isHorizontal ? (
            <span className="text-xs font-medium text-paper-ink">
              {t('dock.title')}
              <span className="ml-1 font-mono text-[11px] text-paper-muted">({items.length})</span>
            </span>
          ) : (
            <>
              <span className="rounded-full border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 font-mono text-[11px] font-medium text-paper-goldtext">
                {items.length}
              </span>
              <span className="mt-0.5 select-none text-[11px] font-medium tracking-widest text-paper-muted [writing-mode:vertical-rl] group-hover:text-paper-ink">
                {t('dock.title')}
              </span>
            </>
          )}
          {synced.length > 0 && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-paper-gold"
              title={`${t('dock.autoSyncTitle')}: ${synced.length}`}
            />
          )}
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside
        style={dockStyle}
        className={clsx(
          'relative z-10 flex min-h-0 min-w-0 shrink-0 flex-col border-paper-border bg-paper-bg',
          dockOrderClass,
          dockBorderClass,
        )}
      >
        {/* 自由拖拽宽/高手柄 */}
        {!allHorizontalCollapsed && (
          <div
            role="separator"
            aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
            aria-label={isHorizontal ? t('dock.resizeHeight') : t('dock.resizeWidth')}
            title={isHorizontal ? t('dock.dragVertical') : t('dock.dragHorizontal')}
            onMouseDown={startResize}
            className={clsx(
              'group/resize absolute z-20 flex items-center justify-center',
              resizeHandleClass,
            )}
          >
            <span
              className={clsx(
                'rounded-full transition-all duration-150',
                isHorizontal ? 'h-1 w-10' : 'h-10 w-1',
                isResizing
                  ? 'bg-paper-gold opacity-100'
                  : 'bg-paper-muted/60 opacity-0 group-hover/resize:bg-paper-gold group-hover/resize:opacity-100',
              )}
            />
          </div>
        )}

        {/* 标题栏：支持按住拖动停靠到页面上下左右 + 快捷切换按钮 */}
        <div
          onMouseDown={startDockDrag}
          title={t('dock.dragToEdge')}
          className="flex h-10 shrink-0 cursor-grab select-none items-center gap-1.5 border-b border-paper-border px-2.5 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-paper-muted/70" />
          <Pin className="h-3.5 w-3.5 shrink-0 text-paper-gold" />
          <span className="truncate text-xs font-medium text-paper-ink">
            {t('dock.title')}
            <span className="ml-1 font-mono text-[11px] text-paper-muted">({items.length})</span>
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onExport && <div ref={exportRef} className="relative">
              <button type="button" title={t('notes.export')} aria-label={t('notes.export')} aria-expanded={exportMenu}
                disabled={exporting} onClick={() => setExportMenu(!exportMenu)}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-paper-ink hover:bg-paper-card">
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {(isHorizontal || clampedWidth >= 410) && t('notes.export')}
              </button>
              {exportMenu && <div className={clsx('absolute z-30 w-max rounded-lg border border-paper-border bg-paper-card p-1 shadow-float',
                position === 'bottom' ? 'bottom-full mb-1' : 'top-full mt-1', position === 'left' ? 'left-0' : 'right-0')}>
                {(['copy', 'zip'] as const).map(mode => <button key={mode} type="button"
                  className="block w-full rounded px-3 py-2 text-left text-xs text-paper-ink hover:bg-paper-bg"
                  onClick={() => { setExportMenu(false); onExport(mode); }}>{t(mode === 'copy' ? 'notes.copy' : 'notes.zip')}</button>)}
              </div>}
            </div>}
            <div className="flex items-center rounded-md border border-paper-border/80 bg-paper-card/80 p-0.5">
              {POSITION_OPTIONS.map(({ key, hint, Icon }) => {
                const active = position === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onPositionChange(key)}
                    title={t(hint)}
                    aria-label={t(hint)}
                    className={clsx(
                      'rounded p-1 transition',
                      active
                        ? 'bg-paper-goldbg text-paper-goldtext shadow-sm'
                        : 'text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </button>
                );
              })}
            </div>

            {items.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-paper-muted transition hover:bg-paper-card hover:text-paper-gold"
                title={t('dock.clearAll')}
              >
                <Eraser className="h-3 w-3" />
                {(isHorizontal || clampedWidth >= 380) && <span>{t('common.clear')}</span>}
              </button>
            )}

            <button
              type="button"
              onClick={() => setDockCollapsed(true)}
              title={t('dock.collapse')}
              aria-label={t('dock.collapse')}
              aria-expanded
              className="flex items-center gap-0.5 rounded-md border border-paper-border bg-paper-card px-1.5 py-1 text-[11px] font-medium text-paper-ink transition hover:border-paper-goldborder hover:bg-paper-goldbg hover:text-paper-goldtext"
            >
              {(isHorizontal || clampedWidth >= 280) && <span>{t('common.collapse')}</span>}
              <CollapseIcon className="h-3 w-3" />
            </button>
          </div>
        </div>

        <section aria-label={t('dock.autoSync')} className={clsx(
          'flex shrink-0 flex-col border-b border-paper-border bg-paper-bg',
          showSynced && synced.length > 0 && (isHorizontal ? 'max-h-[46%]' : 'max-h-44'),
        )}>
          <div className="flex h-8 shrink-0 items-center gap-2 px-3">
            <button type="button" aria-expanded={showSynced} disabled={!enabled}
              onClick={() => setSyncCollapsed(value => !value)}
              className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-paper-ink disabled:text-paper-muted">
              <ChevronDown className={clsx('h-3 w-3 shrink-0 transition-transform', !(showSynced && synced.length > 0) && '-rotate-90')} />
              <span className="truncate">{t('dock.autoSyncTitle')}</span>
              <span className="rounded border border-paper-border bg-paper-card px-1 font-mono text-[11px]">{synced.length}</span>
            </button>
            <button type="button" role="switch" aria-checked={enabled} aria-label={t('dock.autoSync')}
              onClick={() => setEnabled(!enabled)}
              className={clsx('ml-auto flex h-4 w-7 shrink-0 items-center rounded-full px-0.5', enabled ? 'bg-paper-gold' : 'bg-paper-muted')}>
              <span className={clsx('h-3 w-3 rounded-full bg-paper-card transition-transform', enabled && 'translate-x-3')} />
            </button>
          </div>
          {showSynced && synced.length > 0 && <div className={clsx('min-h-0 overflow-auto px-2.5 pb-2',
            isHorizontal ? 'flex gap-2' : 'space-y-1.5')}>
            {synced.map(asset => (
              <article key={asset.key} className={clsx('flex items-center gap-2 rounded-md border border-paper-border bg-paper-card p-1.5',
                isHorizontal && 'w-56 shrink-0')}>
                <button type="button" disabled={!asset.imageUrl} aria-label={t('asset.enlarge', { name: asset.label })}
                  onClick={() => onPreviewAsset(asset)}
                  className="h-9 w-12 shrink-0 overflow-hidden rounded border border-paper-border bg-paper-bg">
                  {asset.imageUrl ? <img alt={asset.label} src={asset.imageUrl} className="pdf-image h-full w-full object-contain" />
                    : <span className="text-[11px] text-paper-muted">{t('asset.noThumbnail')}</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-paper-ink">{asset.label}</p>
                  <button type="button" aria-label={t('asset.jumpTo', { name: asset.label, page: asset.pageNumber })}
                    onClick={() => onJump(asset.pageNumber, asset.cropRect)}
                    className="flex items-center gap-0.5 font-mono text-[11px] text-paper-muted hover:text-paper-gold">
                    <span className="mr-1 rounded bg-paper-goldbg px-1 text-paper-goldtext">{t(`kind.${asset.kind}`)}</span>{t('reader.page', { page: asset.pageNumber })}<ArrowUpRight size={11} />
                  </button>
                </div>
                <button type="button" onClick={() => onPinAsset(asset)} aria-label={t('asset.pinName', { name: asset.label })}
                  className="flex shrink-0 items-center gap-1 rounded bg-paper-gold px-2 py-1 text-xs font-medium text-paper-card">
                  <Pin size={11} />{t('common.pin')}
                </button>
              </article>
            ))}
          </div>}
        </section>

        {/* 卡片列表 */}
        <div
          ref={listRef}
          onWheel={(event) => {
            if (!isHorizontal || !listRef.current) return;
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
              listRef.current.scrollLeft += event.deltaY;
            }
          }}
          className={clsx(
            'p-2.5',
            allHorizontalCollapsed ? 'shrink-0' : 'min-h-0 flex-1',
            isHorizontal
              ? 'flex flex-row items-stretch gap-2.5 overflow-x-auto overflow-y-hidden'
              : 'space-y-2.5 overflow-y-auto overflow-x-hidden',
          )}
        >
          {items.length === 0 ? (
            <div
              className={clsx(
                'flex h-full w-full items-center justify-center px-6 text-center',
                isHorizontal ? 'flex-row gap-4' : 'flex-col',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-paper-border bg-paper-card text-paper-muted">
                <Pin className="h-4 w-4" />
              </span>
              <div className={clsx('max-w-[260px]', isHorizontal ? 'text-left' : 'mt-2.5')}>
                <p className="text-xs font-medium text-paper-ink">{t('dock.empty')}</p>
                <p className="mt-1 text-xs leading-relaxed text-paper-muted">{t('dock.emptyHelp')}</p>
              </div>
            </div>
          ) : (
            items.map((item) => (
              <PinnedCard
                key={item.id}
                item={item}
                backlinks={backlinksMap[item.id]}
                onJumpToBacklink={onJumpToBacklink}
                highlighted={highlightedId === item.id}
                dockPosition={position}
                dockWidth={clampedWidth}
                dockHeight={clampedHeight}
                onUnpin={onUnpin}
                onToggleCollapse={onToggleCollapse}
                onJump={onJump}
                onExpandCrop={onExpandCrop}
                onResetCrop={onResetCrop}
                onOpenLightbox={onOpenLightbox}
                onRename={onRename}
                onMove={move}
              />
            ))
          )}
        </div>
      </aside>

      {/* 拖动钉板停靠时的目标区域预览浮层 */}
      {dragDropPreview &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50"
            style={{
              top: dragDropPreview.bounds.top,
              left: dragDropPreview.bounds.left,
              width: dragDropPreview.bounds.width,
              height: dragDropPreview.bounds.height,
            }}
          >
            <div
              className={clsx(
                'absolute flex items-center justify-center rounded-xl border-2 border-dashed border-paper-gold/80 bg-paper-gold/10 backdrop-blur-[2px] transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                dragDropPreview.target === 'right' && 'inset-y-2 right-2 w-[30%] min-w-[200px]',
                dragDropPreview.target === 'left' && 'inset-y-2 left-2 w-[30%] min-w-[200px]',
                dragDropPreview.target === 'top' && 'inset-x-2 top-2 h-[30%] min-h-[130px]',
                dragDropPreview.target === 'bottom' && 'inset-x-2 bottom-2 h-[30%] min-h-[130px]',
              )}
            >
              <span className="rounded-full border border-paper-goldborder bg-paper-card/95 px-3.5 py-1.5 text-xs font-medium text-paper-goldtext shadow-float">
                {t(DROP_LABEL[dragDropPreview.target])}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
