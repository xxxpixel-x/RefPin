import { useCallback, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { recropPageRegion } from '../../engine/assetExtractor';
import { useReaderStore } from '../../store/useReaderStore';

interface Props {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
}

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 自由框选钉住：拖拽一块区域，松手后高清截取并钉到右侧对照栏 */
export function FreeSnipOverlay({ pdfDoc, pageNumber, width, height }: Props) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // 同步保存选区，避免快速松手时 finishSelection 读到旧的 React state
  const selectionRef = useRef<Selection | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const setSnipMode = useReaderStore((state) => state.setSnipMode);
  const pinSnip = useReaderStore((state) => state.pinSnip);

  const applySelection = (next: Selection | null) => {
    selectionRef.current = next;
    setSelection(next);
  };

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    startRef.current = point;
    applySelection({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const point = pointFromEvent(event);
    applySelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const finishSelection = async () => {
    const current = selectionRef.current;
    startRef.current = null;
    if (!current || current.width < 20 || current.height < 20) {
      applySelection(null);
      return;
    }

    setBusy(true);
    try {
      const cropRect = {
        x: current.x / width,
        y: current.y / height,
        width: current.width / width,
        height: current.height / height,
      };
      const imageUrl = await recropPageRegion(pdfDoc, pageNumber, cropRect);
      if (useReaderStore.getState().pdfDoc !== pdfDoc) return;
      pinSnip({ pageNumber, cropRect, imageUrl });
      setSnipMode(false);
    } catch {
      // 截取失败时留在框选模式，避免未捕获的 Promise 拒绝
    } finally {
      setBusy(false);
      applySelection(null);
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 cursor-crosshair select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => void finishSelection()}
      onPointerCancel={() => {
        startRef.current = null;
        applySelection(null);
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-amber-500/[0.04]" />
      {selection && (
        <div
          className="pointer-events-none absolute border border-dashed border-amber-500 bg-amber-400/15"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        >
          <span className="absolute -top-6 left-0 rounded bg-paper-ink px-1.5 py-0.5 font-mono text-[10px] text-white">
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </span>
        </div>
      )}
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-paper-ink">
          正在生成高清截图…
        </div>
      )}
    </div>
  );
}
