import { t } from '../../i18n/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Scissors, X } from 'lucide-react';

interface ViewportSnipModalProps {
  screenshotUrl: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 原生 PDF 页无法注入 Content Script 遮罩时的无缝兜底：
 * 直接基于当前标签页可见画面的高清截图，在侧边栏内拖拽框选并裁切钉入对照板。
 */
export function ViewportSnipModal({
  screenshotUrl,
  onCancel,
  onConfirm,
}: ViewportSnipModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const startPtRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);

  const getRelativePoint = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y };
  }, []);

  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    if (!img || !selection || selection.width < 10 || selection.height < 10) return;

    const displayRect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / Math.max(1, displayRect.width);
    const scaleY = img.naturalHeight / Math.max(1, displayRect.height);

    const sx = Math.max(0, Math.round(selection.x * scaleX));
    const sy = Math.max(0, Math.round(selection.y * scaleY));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(selection.width * scaleX)));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(selection.height * scaleY)));

    const maxEdge = 1600;
    const ratio = Math.min(1, maxEdge / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * ratio));
    const outH = Math.max(1, Math.round(sh * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    const webp = canvas.toDataURL('image/webp', 0.92);
    onConfirm(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
  }, [onConfirm, selection]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const startPt = startPtRef.current;
      if (!startPt) return;
      const pt = getRelativePoint(event.clientX, event.clientY);
      if (!pt) return;
      setSelection({
        x: Math.min(startPt.x, pt.x),
        y: Math.min(startPt.y, pt.y),
        width: Math.abs(pt.x - startPt.x),
        height: Math.abs(pt.y - startPt.y),
      });
    };
    const onUp = () => {
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, getRelativePoint]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') handleConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleConfirm, onCancel]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pt = getRelativePoint(event.clientX, event.clientY);
    if (!pt) return;
    startPtRef.current = pt;
    setDragging(true);
    setSelection({ x: pt.x, y: pt.y, width: 0, height: 0 });
  };

  const canConfirm = Boolean(selection && selection.width >= 10 && selection.height >= 10);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper-ink/85 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 bg-paper-ink px-3 py-2.5 text-white">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Scissors className="h-3.5 w-3.5 text-amber-400" />
          {t('snip.selectRegion')}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-stone-300 transition hover:bg-white/10 hover:text-white"
          aria-label={t('snip.cancel')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        <div
          className="relative inline-block cursor-crosshair select-none overflow-hidden rounded-lg border border-white/15 bg-black shadow-float"
          onMouseDown={handleMouseDown}
        >
          <img
            ref={imgRef}
            src={screenshotUrl}
            alt={t('snip.currentView')}
            draggable={false}
            className="block max-h-[68vh] max-w-full object-contain"
          />
          {selection && selection.width > 2 && selection.height > 2 && (
            <div
              className="pointer-events-none absolute rounded border-2 border-paper-gold bg-amber-300/20"
              style={{
                left: `${selection.x}px`,
                top: `${selection.y}px`,
                width: `${selection.width}px`,
                height: `${selection.height}px`,
              }}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-paper-ink px-3 py-2.5">
        <span className="text-[11px] text-stone-400">
          {canConfirm ? t('snip.confirmEnter') : t('snip.drag')}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-stone-300 transition hover:bg-white/10"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1 rounded-lg bg-paper-gold px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            {t('snip.pin')}
          </button>
        </div>
      </div>
    </div>
  );
}
