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

interface ZoomOverlayState {
  id: string;
  rect: CardRectSnapshot;
  phase: 'entering' | 'open' | 'leaving';
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
  const [zoomOverlay, setZoomOverlay] = useState<ZoomOverlayState | null>(null);
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

  const enterTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  const raf1Ref = useRef<number | null>(null);
  const raf2Ref = useRef<number | null>(null);

  const isHorizontal = position === 'top' || position === 'bottom';

  const clearZoomTimers = useCallback(() => {
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
    if (raf1Ref.current !== null) {
      window.cancelAnimationFrame(raf1Ref.current);
      raf1Ref.current = null;
    }
    if (raf2Ref.current !== null) {
      window.cancelAnimationFrame(raf2Ref.current);
      raf2Ref.current = null;
    }
  }, []);

  const dismissZoomImmediately = useCallback(() => {
    clearZoomTimers();
    setZoomOverlay(null);
  }, [clearZoomTimers]);

  useEffect(() => () => clearZoomTimers(), [clearZoomTimers]);


  // 当前放大的卡片被移除或折叠时立即收起
  useEffect(() => {
    if (!zoomOverlay) return;
    const target = items.find((entry) => entry.id === zoomOverlay.id);
    if (!target || target.collapsed) {
      dismissZoomImmediately();
    }
  }, [items, zoomOverlay, dismissZoomImmediately]);

  // 切换停靠方向时收起悬浮放大
  useEffect(() => {
    dismissZoomImmediately();
  }, [position, dismissZoomImmediately]);

  // 监听窗口大小变化以动态夹紧宽度/高度
  useEffect(() => {
    const onResize = () => {
      setViewportTick((v) => v + 1);
      dismissZoomImmediately();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dismissZoomImmediately]);

  // 按 Esc 取消拖动停靠或关闭放大卡片
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dockDragRef.current) {
        dockDragRef.current = null;
        setDragDropPreview(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      dismissZoomImmediately();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismissZoomImmediately]);

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
          dismissZoomImmediately();
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
    dismissZoomImmediately,
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


  const handleCardHoverStart = useCallback(
    (id: string, el: HTMLElement) => {
      if (resizingRef.current || dockDragRef.current?.active) return;
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }

      if (zoomOverlay?.id === id) {
        setZoomOverlay((prev) => (prev ? { ...prev, phase: 'open' } : prev));
        return;
      }

      if (enterTimerRef.current !== null) {
        window.clearTimeout(enterTimerRef.current);
      }

      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null;
        if (!el.isConnected || resizingRef.current || dockDragRef.current?.active) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;

        setZoomOverlay({
          id,
          rect: {
            top: r.top,
            left: r.left,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          },
          phase: 'entering',
        });

        raf1Ref.current = window.requestAnimationFrame(() => {
          raf2Ref.current = window.requestAnimationFrame(() => {
            setZoomOverlay((prev) =>
              prev && prev.id === id && prev.phase === 'entering'
                ? { ...prev, phase: 'open' }
                : prev,
            );
          });
        });
      }, 130);
    },
    [zoomOverlay?.id],
  );

  const scheduleZoomLeave = useCallback(() => {
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
    }
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setZoomOverlay((prev) => (prev ? { ...prev, phase: 'leaving' } : null));
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
      }
      unmountTimerRef.current = window.setTimeout(() => {
        unmountTimerRef.current = null;
        setZoomOverlay(null);
      }, 210);
    }, 75);
  }, []);

  const handleCardHoverEnd = useCallback(
    (id: string) => {
      if (enterTimerRef.current !== null) {
        window.clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
      if (zoomOverlay?.id === id) {
        scheduleZoomLeave();
      }
    },
    [scheduleZoomLeave, zoomOverlay?.id],
  );

  const zoomedItem = useMemo(
    () => (zoomOverlay ? items.find((entry) => entry.id === zoomOverlay.id) ?? null : null),
    [items, zoomOverlay],
  );

  const zoomedOverlayStyle = useMemo<CSSProperties | null>(() => {
    if (!zoomOverlay || !zoomedItem || typeof window === 'undefined') return null;
    const { rect, phase } = zoomOverlay;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isRef = zoomedItem.kind === 'reference';

    const maxAllowedW = Math.max(360, vw - 28);
    const preferredW = Math.max(rect.width * 1.44, isRef ? 440 : 520);
    const capW = Math.min(maxAllowedW, isRef ? 580 : 760);
    const targetWidth = Math.round(
      rect.width >= capW
        ? Math.min(maxAllowedW, rect.width * 1.15)
        : Math.min(capW, preferredW),
    );
    const startScale = Number(Math.min(0.95, Math.max(0.62, rect.width / targetWidth)).toFixed(3));
    const isOpen = phase === 'open';

    const style: CSSProperties = {
      position: 'fixed',
      width: targetWidth,
      zIndex: 45,
      opacity: isOpen ? 1 : 0,
      transform: isOpen ? 'scale(1) translate3d(0, 0, 0)' : `scale(${startScale}) translate3d(0, 0, 0)`,
      boxShadow: isOpen
        ? '0 24px 64px -8px rgba(28, 25, 23, 0.22), 0 8px 20px -4px rgba(28, 25, 23, 0.10)'
        : '0 4px 12px rgba(28, 25, 23, 0.06)',
      borderRadius: 12,
      pointerEvents: phase === 'leaving' ? 'none' : 'auto',
      transition:
        phase === 'leaving'
          ? 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease-out, box-shadow 200ms ease-out'
          : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out, box-shadow 300ms cubic-bezier(0.22, 1, 0.36, 1)',
      willChange: 'transform, opacity',
    };

    if (position === 'right') {
      style.right = Math.max(10, vw - rect.right);
      const anchorBottom = rect.top + rect.height / 2 > vh * 0.54;
      if (anchorBottom) {
        style.bottom = Math.max(14, vh - rect.bottom - 10);
        style.transformOrigin = 'right bottom';
      } else {
        style.top = Math.max(58, rect.top - 10);
        style.transformOrigin = 'right top';
      }
    } else if (position === 'left') {
      style.left = Math.max(10, rect.left);
      const anchorBottom = rect.top + rect.height / 2 > vh * 0.54;
      if (anchorBottom) {
        style.bottom = Math.max(14, vh - rect.bottom - 10);
        style.transformOrigin = 'left bottom';
      } else {
        style.top = Math.max(58, rect.top - 10);
        style.transformOrigin = 'left top';
      }
    } else if (position === 'top') {
      const cx = rect.left + rect.width / 2;
      const left = Math.min(Math.max(12, cx - targetWidth / 2), vw - targetWidth - 12);
      const originX = Math.round(Math.min(targetWidth - 20, Math.max(20, cx - left)));
      style.top = Math.max(56, rect.top);
      style.left = left;
      style.transformOrigin = `${originX}px top`;
    } else {
      const cx = rect.left + rect.width / 2;
      const left = Math.min(Math.max(12, cx - targetWidth / 2), vw - targetWidth - 12);
      const originX = Math.round(Math.min(targetWidth - 20, Math.max(20, cx - left)));
      style.bottom = Math.max(12, vh - rect.bottom);
      style.left = left;
      style.transformOrigin = `${originX}px bottom`;
    }

    return style;
  }, [position, zoomOverlay, zoomedItem]);

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
    dismissZoomImmediately();
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
            <span className="ml-1 font-mono text-[10px] text-paper-muted">({items.length})</span>
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onExport && <div ref={exportRef} className="relative">
              <button type="button" title={t('notes.export')} aria-label={t('notes.export')} aria-expanded={exportMenu}
                disabled={exporting} onClick={() => setExportMenu(!exportMenu)}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-paper-ink hover:bg-paper-card">
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {(isHorizontal || clampedWidth >= 360) && t('notes.export')}
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
                onClick={() => {
                  dismissZoomImmediately();
                  onClear();
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-paper-muted transition hover:bg-paper-card hover:text-paper-gold"
                title={t('dock.clearAll')}
              >
                <Eraser className="h-3 w-3" />
                {(isHorizontal || clampedWidth >= 320) && <span>{t('common.clear')}</span>}
              </button>
            )}
          </div>
        </div>

        <section aria-label={t('dock.autoSync')} className={clsx(
          'flex shrink-0 flex-col border-b border-paper-border bg-paper-bg',
          showSynced && synced.length > 0 && (isHorizontal ? 'max-h-[46%]' : 'max-h-44'),
        )}>
          <div className="flex h-8 shrink-0 items-center gap-2 px-3">
            <button type="button" aria-expanded={showSynced} disabled={!enabled}
              onClick={() => setSyncCollapsed(value => !value)}
              className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-paper-ink disabled:text-paper-muted">
              <ChevronDown className={clsx('h-3 w-3 shrink-0 transition-transform', !(showSynced && synced.length > 0) && '-rotate-90')} />
              <span className="truncate">{t('dock.autoSyncTitle')}</span>
              <span className="rounded border border-paper-border bg-paper-card px-1 font-mono text-[10px]">{synced.length}</span>
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
                    : <span className="text-[10px] text-paper-muted">{t('asset.noThumbnail')}</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-paper-ink">{asset.label}</p>
                  <button type="button" aria-label={t('asset.jumpTo', { name: asset.label, page: asset.pageNumber })}
                    onClick={() => onJump(asset.pageNumber, asset.cropRect)}
                    className="flex items-center gap-0.5 font-mono text-[10px] text-paper-muted hover:text-paper-gold">
                    <span className="mr-1 rounded bg-paper-goldbg px-1 text-paper-goldtext">{t(`kind.${asset.kind}`)}</span>{t('reader.page', { page: asset.pageNumber })}<ArrowUpRight size={11} />
                  </button>
                </div>
                <button type="button" onClick={() => onPinAsset(asset)} aria-label={t('asset.pinName', { name: asset.label })}
                  className="flex shrink-0 items-center gap-1 rounded bg-paper-gold px-2 py-1 text-[11px] font-medium text-paper-card">
                  <Pin size={11} />{t('common.pin')}
                </button>
              </article>
            ))}
          </div>}
        </section>

        {/* 卡片列表 */}
        <div
          ref={listRef}
          onScroll={dismissZoomImmediately}
          onWheel={(event) => {
            if (!isHorizontal || !listRef.current) return;
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
              listRef.current.scrollLeft += event.deltaY;
              dismissZoomImmediately();
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
              <p className={clsx('text-[11px] text-paper-muted', !isHorizontal && 'mt-2.5')}>{t('dock.empty')}</p>
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
                isLifted={zoomOverlay?.id === item.id && zoomOverlay.phase !== 'leaving'}
                onUnpin={onUnpin}
                onToggleCollapse={onToggleCollapse}
                onJump={onJump}
                onExpandCrop={onExpandCrop}
                onResetCrop={onResetCrop}
                onOpenLightbox={onOpenLightbox}
                onRename={onRename}
                onMove={move}
                onHoverStart={handleCardHoverStart}
                onHoverEnd={handleCardHoverEnd}
              />
            ))
          )}
        </div>
      </aside>

      {/* 卡片悬停自动放大浮层（平滑优雅动效，支持全部卡片操作） */}
      {zoomOverlay &&
        zoomedItem &&
        zoomedOverlayStyle &&
        createPortal(
          <div
            style={zoomedOverlayStyle}
            onMouseEnter={() => {
              if (leaveTimerRef.current !== null) {
                window.clearTimeout(leaveTimerRef.current);
                leaveTimerRef.current = null;
              }
              if (unmountTimerRef.current !== null) {
                window.clearTimeout(unmountTimerRef.current);
                unmountTimerRef.current = null;
              }
              setZoomOverlay((prev) =>
                prev && prev.id === zoomedItem.id ? { ...prev, phase: 'open' } : prev,
              );
            }}
            onMouseLeave={scheduleZoomLeave}
          >
            <PinnedCard
              item={zoomedItem}
              backlinks={backlinksMap[zoomedItem.id]}
              onJumpToBacklink={onJumpToBacklink}
              dockPosition={position}
              dockWidth={clampedWidth}
              dockHeight={clampedHeight}
              isZoomedOverlay
              onUnpin={onUnpin}
              onToggleCollapse={onToggleCollapse}
              onJump={onJump}
              onExpandCrop={onExpandCrop}
              onResetCrop={onResetCrop}
              onOpenLightbox={onOpenLightbox}
              onRename={onRename}
              onMove={move}
              onRequestCloseZoom={dismissZoomImmediately}
            />
          </div>,
          document.body,
        )}

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
