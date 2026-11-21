import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InlineCitation, NormalizedRect } from '../../types/paper';
import { FreeSnipOverlay } from './FreeSnipOverlay';

export interface FlashHighlight {
  pageNumber: number;
  rect: NormalizedRect;
  token: number;
}

interface Props {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** 由 PdfViewer 统一计算，保证滚动布局稳定 */
  pageWidth: number;
  pageHeight: number;
  citations: InlineCitation[];
  flash?: FlashHighlight | null;
  snipMode: boolean;
  onCitationHover?: (citation: InlineCitation, anchor: HTMLElement) => void;
  onCitationLeave?: () => void;
  onCitationClick?: (citation: InlineCitation) => void;
}

export function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  scale,
  pageWidth,
  pageHeight,
  citations,
  flash,
  snipMode,
  onCitationHover,
  onCitationLeave,
  onCitationClick,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  // 懒加载：可视区上下各预加载一页
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: '800px 0px 800px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const render = async () => {
      if (!visible) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;

      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * deviceScale });
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${viewport.width / deviceScale}px`;
      canvas.style.height = `${viewport.height / deviceScale}px`;

      const context = canvas.getContext('2d');
      if (!context) return;

      task = page.render({ canvasContext: context, viewport });
      try {
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // 快速滚动/缩放时 render 被取消属于正常情况
      }
    };

    void render();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdfDoc, pageNumber, scale, visible]);

  return (
    <div
      ref={wrapperRef}
      data-page={pageNumber}
      className="relative mx-auto overflow-hidden rounded-sm bg-white shadow-paper ring-1 ring-black/[0.04]"
      style={{ width: pageWidth, height: pageHeight }}
    >
      {!rendered && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-[#F4F2EE] to-white" />
      )}

      <canvas ref={canvasRef} className="block h-full w-full select-none" />

      {rendered && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {citations.map((citation) => (
            <button
              key={citation.id}
              type="button"
              aria-label={`查看引用 ${citation.rawText}`}
              className="pointer-events-auto absolute cursor-pointer rounded-[3px] border-b border-dashed border-amber-500/70 bg-amber-400/[0.13] p-0 transition-colors duration-150 hover:bg-amber-400/[0.3] focus:outline-none focus-visible:bg-amber-400/30 focus-visible:ring-1 focus-visible:ring-amber-500"
              style={{
                left: `${citation.rect.x * 100}%`,
                top: `${citation.rect.y * 100}%`,
                width: `${citation.rect.width * 100}%`,
                height: `${citation.rect.height * 100}%`,
              }}
              onMouseEnter={(event) => onCitationHover?.(citation, event.currentTarget)}
              onMouseLeave={() => onCitationLeave?.()}
              onFocus={(event) => onCitationHover?.(citation, event.currentTarget)}
              onBlur={() => onCitationLeave?.()}
              onClick={() => onCitationClick?.(citation)}
            />
          ))}
        </div>
      )}

      {flash && flash.pageNumber === pageNumber && (
        <div
          key={flash.token}
          className="citation-flash pointer-events-none absolute z-20 rounded-[4px] bg-amber-300/60 ring-2 ring-amber-500/40"
          style={{
            left: `${flash.rect.x * 100}%`,
            top: `${flash.rect.y * 100}%`,
            width: `${Math.max(flash.rect.width, 0.02) * 100}%`,
            height: `${Math.max(flash.rect.height, 0.012) * 100}%`,
          }}
        />
      )}

      <span className="pointer-events-none absolute bottom-2 right-3 z-20 font-mono text-[10px] tracking-wider text-paper-muted/70">
        {pageNumber}
      </span>

      {snipMode && pageWidth > 0 && (
        <FreeSnipOverlay
          pdfDoc={pdfDoc}
          pageNumber={pageNumber}
          width={pageWidth}
          height={pageHeight}
        />
      )}
    </div>
  );
}
