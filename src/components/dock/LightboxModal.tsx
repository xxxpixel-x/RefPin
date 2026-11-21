import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import clsx from 'clsx';
import type { PaperAsset } from '../../types/paper';

interface LightboxModalProps {
  asset: PaperAsset | null;
  onClose: () => void;
}

export function LightboxModal({ asset, onClose }: LightboxModalProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!asset) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asset, onClose]);

  if (!asset) return null;

  const changeZoom = (delta: number) =>
    setZoom((current) => Math.min(3, Math.max(0.5, Number((current + delta).toFixed(2)))));

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-stone-950/80 backdrop-blur-sm"
      onClick={onClose}
      onWheel={(event) => {
        event.preventDefault();
        changeZoom(event.deltaY > 0 ? -0.1 : 0.1);
      }}
    >
      <div
        className="flex h-12 shrink-0 items-center gap-3 px-4 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-paper-goldsoft">
          {asset.kind}
        </span>
        <span className="truncate text-sm">{asset.label}</span>
        <span className="font-mono text-[11px] text-white/50">P.{asset.pageNumber}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeZoom(-0.1)}
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="缩小"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs text-white/80">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => changeZoom(0.1)}
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="放大"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="重置视图"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className={clsx(
          'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-8 pb-8',
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
        )}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          if (zoom <= 1) return;
          dragging.current = {
            x: event.clientX,
            y: event.clientY,
            ox: offset.x,
            oy: offset.y,
          };
        }}
        onMouseMove={(event) => {
          if (!dragging.current) return;
          setOffset({
            x: dragging.current.ox + event.clientX - dragging.current.x,
            y: dragging.current.oy + event.clientY - dragging.current.y,
          });
        }}
        onMouseUp={() => {
          dragging.current = null;
        }}
        onMouseLeave={() => {
          dragging.current = null;
        }}
      >
        <img
          src={asset.imageUrl}
          alt={asset.label}
          draggable={false}
          className="max-h-full max-w-full select-none rounded-lg bg-white shadow-2xl transition-transform duration-150"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        />
      </div>

      <p className="shrink-0 px-6 pb-4 text-center text-[11px] text-white/50">
        滚轮缩放 50%–300% · 放大后拖拽查看细节 · Esc 或点击空白处关闭
      </p>
    </div>
  );
}
