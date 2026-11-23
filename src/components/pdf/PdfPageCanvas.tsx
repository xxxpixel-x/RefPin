import type { SearchMatch } from '../../engine/pageLinesCache';
import type { TranslatedBlock } from '../../engine/pdfParagraphs';
import { useI18n } from '../../i18n';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import clsx from 'clsx';
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
  searchMatches?: SearchMatch[];
  activeMatchId?: string;
  rulerRect?: NormalizedRect;
  onLockRuler?: (page: number, x: number, y: number) => void;
  flash?: FlashHighlight | null;
  snipMode: boolean;
  translatedBlocks?: TranslatedBlock[];
  showTranslationOverlay?: boolean;
  isCompanionPage?: boolean;
  onMentionHover?: (mention: ReaderMention, anchor: HTMLElement) => void;
  onMentionLeave?: () => void;
  onMentionClick?: (mention: ReaderMention, anchor: HTMLElement) => void;
}

function overlayPosition(rect: NormalizedRect): CSSProperties {
  return { left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.width * 100 + '%', height: rect.height * 100 + '%' };
}

function isRectCenterInside(inner: NormalizedRect, outer: NormalizedRect): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return (
    cx >= outer.x - 0.004 &&
    cx <= outer.x + outer.width + 0.004 &&
    cy >= outer.y - 0.004 &&
    cy <= outer.y + outer.height + 0.004
  );
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
  searchMatches,
  activeMatchId,
  rulerRect,
  onLockRuler,
  snipMode,
  translatedBlocks,
  showTranslationOverlay = false,
  isCompanionPage = false,
  onMentionHover,
  onMentionLeave,
  onMentionClick,
}: Props) {
  const { t } = useI18n();
  const activeTranslatedBlocks = useMemo(
    () => (showTranslationOverlay && translatedBlocks ? translatedBlocks.filter((b) => Boolean(b.translated)) : []),
    [showTranslationOverlay, translatedBlocks],
  );
  const mentions = useMemo(() => {
    const all = [...citations, ...glossaryMentions];
    if (!activeTranslatedBlocks.length) return all;
    return all.filter((m) => !activeTranslatedBlocks.some((block) => isRectCenterInside(m.rect, block.rect)));
  }, [citations, glossaryMentions, activeTranslatedBlocks]);
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
      if (!isCompanionPage) {
        textTask = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        await textTask.render();
      }
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
        if (!press || press.dragged || snipMode || window.getSelection()?.toString().trim() ||
            Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
        if (!press.mention && mentionAt(event) === -1 && onLockRuler && !(event.target as HTMLElement).closest('button')) {
          const bounds = event.currentTarget.getBoundingClientRect();
          onLockRuler(pageNumber, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
          return;
        }
        if (!press.mention) return;
        const index = mentionAt(event);
        const anchor = hotspotsRef.current?.children[index];
        if (anchor instanceof HTMLElement && mentions[index] === press.mention) onMentionClick?.(press.mention, anchor);
      }}
      data-page={isCompanionPage ? undefined : pageNumber}
      className={clsx(
        'relative shrink-0 rounded-sm bg-paper-card shadow-paper ring-1 ring-black/[0.04]',
        !isCompanionPage && 'mx-auto',
        activeTranslatedBlocks.length > 0 && !snipMode ? 'overflow-visible' : 'overflow-hidden',
      )}
      style={{ width: pageWidth, height: pageHeight, '--scale-factor': scale } as CSSProperties}
    >
      {isVisible && !rendered && (
        <div className="absolute inset-0 animate-pulse bg-paper-bg" />
      )}

      <canvas ref={canvasRef} width={0} height={0} className="pdf-image block h-full w-full select-none" />

      {isVisible && (
        <div
          ref={textRef}
          className={clsx('textLayer', (isCompanionPage || activeTranslatedBlocks.length > 0) && 'pointer-events-none select-none opacity-0')}
        />
      )}

      {isVisible && rendered && activeTranslatedBlocks.length > 0 && !snipMode && (
        <div className="pointer-events-none absolute inset-0 z-[8]">
          {activeTranslatedBlocks.map((block) => {
            const boxH = block.rect.height * pageHeight;
            const boxW = block.rect.width * pageWidth;
            const avgLinePx = boxH / Math.max(1, block.lineCount);
            const fontSize = block.isHeading
              ? Math.min(20, Math.max(10.5, avgLinePx * 0.78))
              : block.isCaption
                ? Math.min(13, Math.max(8.5, avgLinePx * 0.72))
                : Math.min(15, Math.max(8.8, avgLinePx * 0.74));
            const padX = Math.min(3, boxW * 0.015);
            const padY = 1.5;

            const seenKeys = new Set<string>();
            const blockCitations = citations.filter((cite) => {
              if (!isRectCenterInside(cite.rect, block.rect)) return false;
              const dedupKey = cite.targetKeys.join(',') || cite.rawText;
              if (seenKeys.has(dedupKey)) return false;
              seenKeys.add(dedupKey);
              return true;
            });

            return (
              <div
                key={block.id}
                style={{
                  left: `${Math.max(0, block.rect.x * pageWidth - padX)}px`,
                  top: `${Math.max(0, block.rect.y * pageHeight - padY)}px`,
                  width: `${Math.min(pageWidth, boxW + padX * 2)}px`,
                  minHeight: `${boxH + padY * 2}px`,
                  fontSize: `${fontSize.toFixed(1)}px`,
                  lineHeight: block.isHeading ? 1.28 : 1.38,
                }}
                className={clsx(
                  'pointer-events-auto absolute select-text overflow-hidden bg-paper-card px-0.5 text-justify text-paper-ink transition-shadow hover:z-30 hover:h-auto hover:overflow-visible hover:rounded hover:shadow-float',
                  block.isHeading && 'font-semibold text-left',
                )}
              >
                <span>{block.translated}</span>
                {blockCitations.length > 0 && (
                  <span className="ml-1 inline-flex flex-wrap items-center gap-0.5 align-baseline">
                    {blockCitations.map((cite) => (
                      <button
                        key={cite.id}
                        type="button"
                        data-coach-citation={cite.id}
                        onMouseEnter={(e) => onMentionHover?.(cite, e.currentTarget)}
                        onMouseLeave={() => onMentionLeave?.()}
                        onFocus={(e) => onMentionHover?.(cite, e.currentTarget)}
                        onBlur={() => onMentionLeave?.()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMentionClick?.(cite, e.currentTarget);
                        }}
                        className="inline-flex items-center rounded border border-paper-goldborder bg-paper-goldbg px-1 py-0 text-[0.82em] font-medium leading-tight text-paper-goldtext transition hover:bg-paper-goldsoft"
                      >
                        {cite.rawText}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isVisible && rendered && !snipMode && (
        <div ref={hotspotsRef} className="pointer-events-none absolute inset-0 z-10 select-none">
          {mentions.map((mention) => (
            <button
              key={mention.id}
              type="button"
              data-coach-citation={mention.id}
              aria-label={t('term' in mention ? 'peek.showDefinition' : 'peek.showCitation', { name: mention.rawText })}
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

      {isVisible && searchMatches?.map(match => <div key={match.id} aria-hidden="true" style={overlayPosition(match.rect)}
        className={'pointer-events-none absolute z-[5] rounded-sm ' + (match.id === activeMatchId
          ? 'bg-paper-gold/40 ring-2 ring-paper-gold' : 'bg-paper-gold/25')} />)}
      {isVisible && rulerRect && <div aria-hidden="true" style={overlayPosition(rulerRect)}
        className="pointer-events-none absolute z-[6] border-b border-paper-gold/60 bg-paper-gold/15" />}
      {flash && flash.pageNumber === pageNumber && (
        <div
          key={flash.token}
          className="citation-flash pointer-events-none absolute z-20 rounded-[4px] bg-paper-gold/30 ring-2 ring-paper-gold/40"
          style={{
            left: `${flash.rect.x * 100}%`,
            top: `${flash.rect.y * 100}%`,
            width: `${flash.rect.width * 100}%`,
            height: `${flash.rect.height * 100}%`,
          }}
        />
      )}

      <span className="pointer-events-none absolute bottom-2 right-3 select-none z-20 font-mono text-[11px] tracking-wider text-paper-muted/70">
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
