import { usePreviewColor } from '../peek/usePreviewColor';
import { t } from '../../i18n/core';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, Minus, Plus, RotateCcw, X } from 'lucide-react';
import clsx from 'clsx';
import type { PaperAsset } from '../../types/paper';
import {
  PREVIEW_MARGIN as MARGIN,
  PREVIEW_MIN_HEIGHT as MIN_HEIGHT,
  PREVIEW_MIN_WIDTH as MIN_WIDTH,
  clampPreviewFrame,
  fitPreviewFrame,
  type ImageSize,
  type PreviewFrame as Frame,
} from './previewWindows';

interface LightboxModalProps {
  asset: PaperAsset | null;
  hostWindow?: Window;
  onClose: () => void;
  /** 打开时的位置和大小；省略时等图片加载后按截图比例自动计算。 */
  initialFrame?: Frame;
  zIndex?: number;
  /** 按下浮窗任意位置时调用，用于把它提到最前面。 */
  onFocus?: () => void;
  /** 是否由浮窗自己响应 Esc；多个浮窗时只让最前面的那个响应。 */
  closeOnEscape?: boolean;
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const clampFrame = (frame: Frame, host: Window) => clampPreviewFrame(frame, host);

const EDGE_CLASSES: Record<ResizeEdge, string> = {
  n: 'inset-x-3 -top-1 h-2 cursor-ns-resize',
  s: 'inset-x-3 -bottom-1 h-2 cursor-ns-resize',
  e: 'inset-y-3 -right-1 w-2 cursor-ew-resize',
  w: 'inset-y-3 -left-1 w-2 cursor-ew-resize',
  ne: '-right-1 -top-1 h-4 w-4 cursor-nesw-resize',
  sw: '-bottom-1 -left-1 h-4 w-4 cursor-nesw-resize',
  nw: '-left-1 -top-1 h-4 w-4 cursor-nwse-resize',
  se: '-bottom-1 -right-1 h-4 w-4 cursor-nwse-resize',
};

/**
 * Enlarged preview that floats above the reader like the hover card, but stays put:
 * drag the title bar to move it, drag any edge or corner to resize, scroll to zoom.
 */
export function LightboxModal({
  asset,
  onClose,
  hostWindow = window,
  initialFrame,
  zIndex = 60,
  onFocus,
  closeOnEscape = true,
}: LightboxModalProps) {
  const { filter, colorToggle } = usePreviewColor(asset?.key);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState<Frame>(() => clampFrame(initialFrame ?? fitPreviewFrame(null, hostWindow), hostWindow));
  const imageSize = useRef<ImageSize | null>(null);
  /** 用户拖动或缩放过之后，不再自动按图片比例调整。 */
  const adjusted = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const gesture = useRef<{ kind: 'move' | ResizeEdge; x: number; y: number; start: Frame } | null>(null);

  const assetKey = asset?.key;
  const assetUrl = asset?.imageUrl;
  useLayoutEffect(() => {
    if (!assetKey) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    imageSize.current = null;
    adjusted.current = Boolean(initialFrame);
    setFrame(clampFrame(initialFrame ?? fitPreviewFrame(null, hostWindow), hostWindow));
    // initialFrame 只在打开时生效，之后由用户拖动决定。
  }, [assetKey, assetUrl]);

  // 钉板小窗关闭后浮窗会回到主窗口，按新窗口尺寸重新夹紧。
  useLayoutEffect(() => {
    setFrame(current => clampFrame(current, hostWindow));
  }, [hostWindow]);

  useEffect(() => {
    if (!asset) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onResize = () => setFrame((current) => clampFrame(current, hostWindow));
    if (closeOnEscape) hostWindow.addEventListener('keydown', onKey);
    hostWindow.addEventListener('resize', onResize);
    return () => {
      hostWindow.removeEventListener('keydown', onKey);
      hostWindow.removeEventListener('resize', onResize);
    };
  }, [asset, onClose, hostWindow, closeOnEscape]);

  if (!asset) return null;

  const changeZoom = (delta: number) =>
    setZoom((current) => Math.min(3, Math.max(0.5, Number((current + delta).toFixed(2)))));

  const startGesture = (kind: 'move' | ResizeEdge) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Let buttons in the title bar keep working.
    if (kind === 'move' && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, start: frame };
    adjusted.current = true;
    setInteracting(true);
  };

  const onGestureMove = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    const s = g.start;
    if (g.kind === 'move') {
      setFrame(clampFrame({ ...s, left: s.left + dx, top: s.top + dy }, hostWindow));
      return;
    }
    let { left, top, width, height } = s;
    if (g.kind.includes('e')) width = s.width + dx;
    if (g.kind.includes('s')) height = s.height + dy;
    if (g.kind.includes('w')) {
      width = Math.max(MIN_WIDTH, s.width - dx);
      left = s.left + s.width - width;
    }
    if (g.kind.includes('n')) {
      height = Math.max(MIN_HEIGHT, s.height - dy);
      top = s.top + s.height - height;
    }
    width = Math.max(MIN_WIDTH, Math.min(width, hostWindow.innerWidth - MARGIN - Math.max(left, MARGIN)));
    height = Math.max(MIN_HEIGHT, Math.min(height, hostWindow.innerHeight - MARGIN - Math.max(top, MARGIN)));
    setFrame({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top), width, height });
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (!gesture.current) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setInteracting(false);
  };

  const gestureHandlers = {
    onPointerMove: onGestureMove,
    onPointerUp: endGesture,
    onPointerCancel: endGesture,
  };

  return createPortal(
    <div
      role="dialog"
      aria-label={asset.label}
      // Dragging inside the window must never start a text selection in the page behind it.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDownCapture={onFocus}
      style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height, zIndex }}
      className={clsx(
        'animate-fade-in-up fixed flex flex-col rounded-xl border border-paper-border bg-paper-card text-paper-ink shadow-float',
        interacting && 'select-none',
      )}
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center gap-2 rounded-t-xl border-b border-paper-border bg-paper-bg/60 pl-3 pr-1.5"
        onPointerDown={startGesture('move')}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          // 双击标题栏：恢复为贴合截图比例的默认大小。
          setFrame(fitPreviewFrame(imageSize.current, hostWindow));
        }}
        title={t('lightbox.help')}
        {...gestureHandlers}
      >
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-paper-muted" />
        <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {t(`kind.${asset.kind}`)}
        </span>
        <span className="min-w-0 truncate text-xs font-medium">{asset.label}</span>
        <span className="shrink-0 font-mono text-[11px] text-paper-muted">
          {t('reader.page', { page: asset.pageNumber })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {colorToggle}
          <button
            type="button"
            onClick={() => changeZoom(-0.1)}
            className="rounded-md p-1 text-paper-muted transition hover:bg-paper-card hover:text-paper-ink"
            aria-label={t('reader.zoomOut')}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-[11px]">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => changeZoom(0.1)}
            className="rounded-md p-1 text-paper-muted transition hover:bg-paper-card hover:text-paper-ink"
            aria-label={t('reader.zoomIn')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
            className="rounded-md p-1 text-paper-muted transition hover:bg-paper-card hover:text-paper-ink"
            aria-label={t('reader.resetView')}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 rounded-md p-1 text-paper-muted transition hover:bg-paper-card hover:text-paper-ink"
            aria-label={t('common.close')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        className={clsx(
          'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-b-xl bg-paper-bg p-3',
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        )}
        onWheel={(event) => changeZoom(event.deltaY > 0 ? -0.1 : 0.1)}
        onPointerDown={(event) => {
          if (zoom <= 1 || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          panning.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(event) => {
          if (!panning.current) return;
          setOffset({
            x: panning.current.ox + event.clientX - panning.current.x,
            y: panning.current.oy + event.clientY - panning.current.y,
          });
        }}
        onPointerUp={() => {
          panning.current = null;
        }}
        onPointerCancel={() => {
          panning.current = null;
        }}
      >
        <img
          src={asset.imageUrl}
          alt={asset.label}
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            if (!width || !height) return;
            imageSize.current = { width, height };
            // 没有预先算好尺寸时（如扩展侧栏），图片加载后按比例调整一次。
            if (!adjusted.current) {
              adjusted.current = true;
              setFrame(fitPreviewFrame(imageSize.current, hostWindow));
            }
          }}
          className="max-h-full max-w-full select-none rounded-md bg-paper-card shadow-paper transition-transform duration-150"
          style={{
            filter,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        />
      </div>

      {(Object.keys(EDGE_CLASSES) as ResizeEdge[]).map((edge) => (
        <div
          key={edge}
          aria-hidden
          className={clsx('absolute z-10 touch-none', EDGE_CLASSES[edge])}
          onPointerDown={startGesture(edge)}
          {...gestureHandlers}
        />
      ))}
    </div>,
    hostWindow.document.body,
  );
}
