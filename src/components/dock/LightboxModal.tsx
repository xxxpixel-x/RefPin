import { usePreviewColor } from '../peek/usePreviewColor';
import { t } from '../../i18n/core';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, Minus, Plus, RotateCcw, X } from 'lucide-react';
import clsx from 'clsx';
import type { PaperAsset } from '../../types/paper';

interface LightboxModalProps {
  asset: PaperAsset | null;
  hostWindow?: Window;
  onClose: () => void;
}

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;
const MARGIN = 8;
/** Keep at least this much of the title bar on screen so the window can always be dragged back. */
const VISIBLE_GRAB = 80;

// Remember where the reader last left the window during this session.
const lastFrames = new WeakMap<Window, Frame>();

function defaultFrame(host: Window): Frame {
  const vw = host.innerWidth;
  const vh = host.innerHeight;
  const width = Math.max(MIN_WIDTH, Math.min(880, Math.round(vw * 0.6)));
  const height = Math.max(MIN_HEIGHT, Math.min(680, Math.round(vh * 0.7)));
  return { left: Math.round((vw - width) / 2), top: Math.round((vh - height) / 2), width, height };
}

function clampFrame(frame: Frame, host: Window): Frame {
  const vw = host.innerWidth;
  const vh = host.innerHeight;
  const width = Math.min(Math.max(MIN_WIDTH, frame.width), vw - MARGIN * 2);
  const height = Math.min(Math.max(MIN_HEIGHT, frame.height), vh - MARGIN * 2);
  const left = Math.min(Math.max(frame.left, VISIBLE_GRAB - width), vw - VISIBLE_GRAB);
  const top = Math.min(Math.max(frame.top, MARGIN), vh - 48);
  return { left, top, width, height };
}

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
export function LightboxModal({ asset, onClose, hostWindow = window }: LightboxModalProps) {
  const { filter, colorToggle } = usePreviewColor(asset?.key);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState<Frame>(() => lastFrames.get(hostWindow) ?? defaultFrame(hostWindow));
  const [interacting, setInteracting] = useState(false);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const gesture = useRef<{ kind: 'move' | ResizeEdge; x: number; y: number; start: Frame } | null>(null);

  useLayoutEffect(() => {
    if (!asset) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setFrame(clampFrame(lastFrames.get(hostWindow) ?? defaultFrame(hostWindow), hostWindow));
  }, [asset, hostWindow]);

  useEffect(() => {
    if (!asset) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onResize = () => setFrame((current) => clampFrame(current, hostWindow));
    hostWindow.addEventListener('keydown', onKey);
    hostWindow.addEventListener('resize', onResize);
    return () => {
      hostWindow.removeEventListener('keydown', onKey);
      hostWindow.removeEventListener('resize', onResize);
    };
  }, [asset, onClose, hostWindow]);

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
    setFrame((current) => {
      lastFrames.set(hostWindow, current);
      return current;
    });
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
      style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
      className={clsx(
        'animate-fade-in-up fixed z-[60] flex flex-col rounded-xl border border-paper-border bg-paper-card text-paper-ink shadow-float',
        interacting && 'select-none',
      )}
    >
      <div
        className="flex h-10 shrink-0 cursor-move items-center gap-2 rounded-t-xl border-b border-paper-border bg-paper-bg/60 pl-3 pr-1.5"
        onPointerDown={startGesture('move')}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          const next = clampFrame(defaultFrame(hostWindow), hostWindow);
          lastFrames.set(hostWindow, next);
          setFrame(next);
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
