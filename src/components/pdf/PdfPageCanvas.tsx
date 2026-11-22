import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import type { GlossaryMention, InlineCitation, NormalizedRect, ReaderMention } from '../../types/paper';
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
  isVisible: boolean;
  /** 由 PdfViewer 统一计算，保证滚动布局稳定 */
  pageWidth: number;
  pageHeight: number;
  citations: InlineCitation[];
  glossaryMentions: GlossaryMention[];
  flash?: FlashHighlight | null;
  snipMode: boolean;
  onMentionHover?: (mention: ReaderMention, anchor: HTMLElement) => void;
  onMentionLeave?: () => void;
  onMentionClick?: (mention: ReaderMention, anchor: HTMLElement) => void;
}

export const PdfPageCanvas = memo(function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  scale,
  isVisible,
  pageWidth,
  pageHeight,
  citations,
  glossaryMentions,
  flash,
  snipMode,
  onMentionHover,
  onMentionLeave,
  onMentionClick,
}: Props) {
  const mentions = useMemo(() => [...citations, ...glossaryMentions], [citations, glossaryMentions]);
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hotspotsRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<{ x: number; y: number; mention?: ReaderMention; dragged: boolean } | null>(null);
  const renderedScaleRef = useRef<number | null>(null);
  const renderedDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderedPageRef = useRef<number | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = textRef.current;
    if (!canvas || !container || !isVisible) return;

    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textTask: TextLayer | undefined;
    async function render(target: HTMLCanvasElement, layer: HTMLDivElement) {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      if (renderedDocRef.current !== pdfDoc || renderedPageRef.current !== pageNumber ||
          renderedScaleRef.current !== scale) {
        setRendered(false);
        // Invalidate before resizing: a zoom back may interrupt a partial render.
        renderedScaleRef.current = null;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        const context = target.getContext('2d');
        if (!context) return;
        renderTask = page.render({
          canvasContext: context, viewport,
          transform: [target.width / viewport.width, 0, 0, target.height / viewport.height, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        renderedDocRef.current = pdfDoc;
        renderedPageRef.current = pageNumber;
        renderedScaleRef.current = scale;
      }
      setRendered(true);
      textTask = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      await textTask.render();
    }
    void render(canvas, container).catch(() => {
      // Scrolling, zooming or closing a document can cancel either task.
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textTask?.cancel();
      container.replaceChildren();
    };
  }, [pdfDoc, pageNumber, scale, isVisible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isVisible) {
      setRendered(false);
      return;
    }
    return () => {
      canvas.width = 0;
      canvas.height = 0;
      renderedScaleRef.current = null;
      renderedDocRef.current = null;
      renderedPageRef.current = null;
      hoverRef.current = null;
      pressRef.current = null;
    };
  }, [isVisible]);

  // Native text selection receives every pointer event, including drags starting on a chip.
  // The overlay buttons provide the visual anchors and native keyboard activation.
  function mentionAt(event: { clientX: number; clientY: number; currentTarget: HTMLElement }) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    return mentions.findIndex(({ rect }) => x >= rect.x && x <= rect.x + rect.width &&
      y >= rect.y && y <= rect.y + rect.height);
  }

  function leaveMention() {
    if (hoverRef.current) {
      delete hoverRef.current.dataset.hovered;
      onMentionLeave?.();
    }
    hoverRef.current = null;
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (snipMode || !rendered) return;
    if (event.buttons) {
      const press = pressRef.current;
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) press.dragged = true;
      leaveMention();
      return;
    }
    if (window.getSelection()?.toString().trim()) return leaveMention();
    const index = mentionAt(event);
    const anchor = hotspotsRef.current?.children[index] as HTMLElement | undefined;
    if (!anchor) return leaveMention();
    if (anchor !== hoverRef.current) {
      if (hoverRef.current) delete hoverRef.current.dataset.hovered;
      hoverRef.current = anchor;
      anchor.dataset.hovered = '';
      onMentionHover?.(mentions[index], anchor);
    }
  }

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        if (pressRef.current) pressRef.current.dragged = true;
        leaveMention();
      }}
      onPointerCancel={() => { pressRef.current = null; }}
      onPointerDown={event => {
        if (snipMode || !rendered || event.button !== 0) return;
        leaveMention();
        pressRef.current = {
          x: event.clientX, y: event.clientY, mention: mentions[mentionAt(event)], dragged: false,
        };
      }}
      onClick={event => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press?.mention || press.dragged || snipMode || window.getSelection()?.toString().trim()) return;
        const index = mentionAt(event);
        const anchor = hotspotsRef.current?.children[index];
        if (anchor instanceof HTMLElement && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 4 &&
            mentions[index] === press.mention) onMentionClick?.(press.mention, anchor);
      }}
      data-page={pageNumber}
      className="relative mx-auto overflow-hidden rounded-sm bg-white shadow-paper ring-1 ring-black/[0.04]"
      style={{ width: pageWidth, height: pageHeight, '--scale-factor': scale } as CSSProperties}
    >
      {isVisible && !rendered && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-[#F4F2EE] to-white" />
      )}

      <canvas ref={canvasRef} width={0} height={0} className="block h-full w-full select-none" />

      {isVisible && <div ref={textRef} className="textLayer" />}

      {isVisible && rendered && !snipMode && (
        <div ref={hotspotsRef} className="pointer-events-none absolute inset-0 z-10 select-none">
          {mentions.map((mention) => (
            <button
              key={mention.id}
              type="button"
              aria-label={`查看${'term' in mention ? '定义' : '引用'} ${mention.rawText}`}
              className={`absolute border-b p-0 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-paper-gold ${
                'term' in mention
                  ? 'border-dotted border-paper-muted/60 bg-transparent data-[hovered]:border-paper-gold data-[hovered]:bg-paper-gold/10'
                  : 'rounded-[3px] border-dashed border-paper-gold/70 bg-paper-gold/[0.13] data-[hovered]:bg-paper-gold/30 focus-visible:bg-paper-gold/30'
              }`}
              style={{
                left: `${mention.rect.x * 100}%`,
                top: `${mention.rect.y * 100}%`,
                width: `${mention.rect.width * 100}%`,
                height: `${mention.rect.height * 100}%`,
              }}
              onFocus={(event) => onMentionHover?.(mention, event.currentTarget)}
              onBlur={() => onMentionLeave?.()}
              onClick={event => { event.stopPropagation(); onMentionClick?.(mention, event.currentTarget); }}
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
            width: `${flash.rect.width * 100}%`,
            height: `${flash.rect.height * 100}%`,
          }}
        />
      )}

      <span className="pointer-events-none absolute bottom-2 right-3 select-none z-20 font-mono text-[10px] tracking-wider text-paper-muted/70">
        {pageNumber}
      </span>

      {isVisible && snipMode && pageWidth > 0 && (
        <FreeSnipOverlay
          pdfDoc={pdfDoc}
          pageNumber={pageNumber}
          width={pageWidth}
          height={pageHeight}
        />
      )}
    </div>
  );
});
