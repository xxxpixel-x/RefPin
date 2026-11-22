import { getCachedPageLines, nearestLineIndex, type SearchMatch } from '../../engine/pageLinesCache';
import type { TranslatedBlock } from '../../engine/pdfParagraphs';
import { t } from '../../i18n/core';
import type { TranslateDisplayMode } from '../../services/translator';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { GlossaryMention, InlineCitation, NormalizedRect, ReaderMention } from '../../types/paper';
import { useReaderStore } from '../../store/useReaderStore';
import { PdfPageCanvas, type FlashHighlight } from './PdfPageCanvas';

const NO_CITATIONS: InlineCitation[] = [];
const NO_GLOSSARY_MENTIONS: GlossaryMention[] = [];

export interface PdfViewerHandle {
  /**
   * 滚到某页；rectOrScrollTop 可以给具体矩形或精确 scrollTop。
   * 传 scrollTop + flashHighlight 时用 flashRect 播放定位光带。
   */
  scrollToPosition: (
    pageNumber: number,
    rectOrScrollTop?: NormalizedRect | number,
    flashHighlight?: boolean,
    flashRect?: NormalizedRect,
    scrollLeft?: number,
  ) => { scrollTop: number; scrollLeft: number } | undefined;
  stepRuler: (delta: -1 | 1) => void;
  getScrollTop: () => number;
  getScrollLeft: () => number;
  /** Scale at which the widest page fits the viewer width, once page sizes are known. */
  getFitWidthScale: () => number | undefined;
}

const PAGE_LIST_PADDING_X = 48;

function fitWidthScale(dims: Array<{ width: number }>, viewerWidth: number) {
  const widest = Math.max(1, ...dims.map(dim => dim.width));
  const fit = Math.floor(((viewerWidth - PAGE_LIST_PADDING_X - 8) / widest) * 100) / 100;
  return Math.min(2.5, Math.max(0.6, fit));
}

interface Props {
  pdfDoc: PDFDocumentProxy;
  scale: number;
  citationsByPage: Record<number, InlineCitation[]>;
  glossaryMentionsByPage: Record<number, GlossaryMention[]>;
  searchMatches: SearchMatch[];
  activeMatch?: SearchMatch;
  snipMode: boolean;
  translateMode?: TranslateDisplayMode;
  translatedBlocksByPage?: Record<number, TranslatedBlock[]>;
  onVisiblePagesChange?: (pages: Set<number>) => void;
  /** 文档就绪后自动滚到的起始页（示例论文直达演示页） */
  initialPage?: number;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  onMentionHover?: (mention: ReaderMention, anchor: HTMLElement) => void;
  onMentionLeave?: () => void;
  onMentionClick?: (mention: ReaderMention, anchor: HTMLElement) => void;
  onPageChange?: (pageNumber: number) => void;
  /** Shrink to fit the viewer width when the paper first loads (new papers without a saved zoom). */
  fitWidthOnLoad?: boolean;
  onFitScale?: (scale: number) => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  {
    pdfDoc,
    scale,
    citationsByPage,
    glossaryMentionsByPage,
    searchMatches,
    activeMatch,
    snipMode,
    translateMode = 'off',
    translatedBlocksByPage,
    onVisiblePagesChange,
    initialPage,
    initialScrollTop,
    onScrollTopChange,
    onMentionHover,
    onMentionLeave,
    onMentionClick,
    onPageChange,
    fitWidthOnLoad,
    onFitScale,
  },
  ref,
) {
  const rulerEnabled = useReaderStore(state => state.readingRulerEnabled);
  const [ruler, setRuler] = useState<{ page: number; index: number; rect: NormalizedRect } | null>(null);
  const pageMatches = useMemo(() => {
    const byPage: Record<number, SearchMatch[]> = {};
    for (const match of searchMatches) (byPage[match.pageNumber] ??= []).push(match);
    return byPage;
  }, [searchMatches]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<number | null>(null);
  const lastPageRef = useRef(0);
  const didInitialScrollRef = useRef(false);
  const [dims, setDims] = useState<Array<{ width: number; height: number }> | null>(null);
  const [flash, setFlash] = useState<FlashHighlight | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set());
  const [containerWidth, setContainerWidth] = useState<number>(1040);
  const fitOnLoadRef = useRef({ fitWidthOnLoad, onFitScale, scale });
  fitOnLoadRef.current = { fitWidthOnLoad, onFitScale, scale };
  const visibleCallbackRef = useRef(onVisiblePagesChange);
  visibleCallbackRef.current = onVisiblePagesChange;

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const updateWidth = () => {
      if (root.clientWidth > 0) setContainerWidth(root.clientWidth);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    visibleCallbackRef.current?.(visiblePages);
  }, [visiblePages]);

  useEffect(() => {
    didInitialScrollRef.current = false;
    lastPageRef.current = 0;
  }, [pdfDoc, initialPage]);

  useEffect(() => {
    let cancelled = false;
    setDims(null);
    setFlash(null);

    const load = async () => {
      try {
        const list = await Promise.all(
          Array.from({ length: pdfDoc.numPages }, async (_, index) => {
            const page = await pdfDoc.getPage(index + 1);
            const viewport = page.getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          }),
        );
        if (cancelled) return;
        // Fit before the first layout so the initial page scroll lands at the final scale.
        const fit = fitOnLoadRef.current;
        const viewerWidth = scrollRef.current?.clientWidth ?? 0;
        if (fit.fitWidthOnLoad && fit.onFitScale && viewerWidth > 0 && list.length) {
          const next = fitWidthScale(list, viewerWidth);
          if (next < fit.scale) fit.onFitScale(next);
        }
        setDims(list);
      } catch {
        // 文档释放 / 损坏时不要永久停在“正在打开论文…”
        if (!cancelled) setDims([]);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !dims?.length) return;
    const observer = new IntersectionObserver(entries => {
      setVisiblePages(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) next.add(page);
          else next.delete(page);
        }
        return next;
      });
    }, { root, rootMargin: '900px 0px 900px 0px' });
    root.querySelectorAll('[data-page]').forEach(page => observer.observe(page));
    return () => observer.disconnect();
  }, [dims, translateMode]);

  useEffect(
    () => () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  // Esc 退出框选：在 PdfViewer 全局只注册一份，避免每页重复监听
  useEffect(() => {
    if (!snipMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        useReaderStore.getState().setSnipMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [snipMode]);

  const scrollToPosition = useCallback<PdfViewerHandle['scrollToPosition']>(
    (pageNumber, rectOrScrollTop, flashHighlight, flashRect, scrollLeft) => {
      const container = scrollRef.current;
      if (!container) return;
      const pageElement = container.querySelector<HTMLElement>(
        `[data-page="${pageNumber}"]`,
      );
      if (!pageElement) return;

      const containerRect = container.getBoundingClientRect();
      const pageBounds = pageElement.getBoundingClientRect();
      const pageOffset = pageBounds.top - containerRect.top + container.scrollTop;

      let top = pageOffset - 16;
      let left = scrollLeft ?? container.scrollLeft;
      let rect: NormalizedRect | null = null;

      if (typeof rectOrScrollTop === 'number') {
        top = rectOrScrollTop;
      } else if (rectOrScrollTop) {
        rect = rectOrScrollTop;
        top = pageOffset + rectOrScrollTop.y * pageElement.offsetHeight - 96;
        // At high zoom the citation may also be outside the horizontal viewport.
        const x = pageBounds.left - containerRect.left + rect.x * pageBounds.width;
        const width = rect.width * pageBounds.width;
        if (x < 0 || x + width > container.clientWidth) {
          left += x - Math.max(16, (container.clientWidth - width) / 2);
        }
      }

      top = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
      left = Math.max(0, Math.min(left, container.scrollWidth - container.clientWidth));
      container.scrollTo({ top, left, behavior: 'smooth' });

      if (flashHighlight) {
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        // 精确返回时优先使用来源矩形，而不是写死的假矩形
        const highlightRect: NormalizedRect = flashRect ??
          rect ?? { x: 0.08, y: 0.12, width: 0.84, height: 0.05 };
        setFlash({ pageNumber, rect: highlightRect, token: Date.now() });
        flashTimerRef.current = window.setTimeout(() => setFlash(null), 1800);
      }
      return { scrollTop: top, scrollLeft: left };
    },
    [],
  );

  useEffect(() => {
    if (activeMatch && dims?.length) scrollToPosition(activeMatch.pageNumber, activeMatch.rect);
  }, [activeMatch, dims, scrollToPosition]);

  const lockRuler = useCallback((page: number, x: number, y: number) => {
    const lines = getCachedPageLines(pdfDoc)?.[page] ?? [];
    const index = nearestLineIndex(lines, x, y);
    setRuler({ page, index, rect: lines[index]?.rect ?? { x: 0.035, y: Math.min(0.984, Math.max(0, y - 0.008)), width: 0.93, height: 0.016 } });
  }, [pdfDoc]);

  const stepRuler = useCallback((delta: -1 | 1) => {
    const page = ruler?.page ?? useReaderStore.getState().currentPage;
    const lines = getCachedPageLines(pdfDoc)?.[page];
    if (!lines?.length) return;
    let current = delta > 0 ? -1 : lines.length;
    if (ruler) current = ruler.index >= 0 ? ruler.index :
      nearestLineIndex(lines, ruler.rect.x + ruler.rect.width / 2, ruler.rect.y + ruler.rect.height / 2);
    const index = Math.max(0, Math.min(lines.length - 1, current + delta));
    const line = lines[index];
    setRuler({ page, index, rect: line.rect });
    const container = scrollRef.current;
    const bounds = container?.querySelector('[data-page="' + page + '"]')?.getBoundingClientRect();
    if (!bounds || !container) return;
    const viewport = container.getBoundingClientRect();
    const x = bounds.left + line.rect.x * bounds.width;
    const y = bounds.top + line.rect.y * bounds.height;
    if (y < viewport.top + 16 || y + line.rect.height * bounds.height > viewport.bottom - 16 ||
        x < viewport.left || x + line.rect.width * bounds.width > viewport.right) scrollToPosition(page, line.rect);
  }, [pdfDoc, ruler, scrollToPosition]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPosition,
      stepRuler,
      getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      getScrollLeft: () => scrollRef.current?.scrollLeft ?? 0,
      getFitWidthScale: () => {
        const viewerWidth = scrollRef.current?.clientWidth ?? 0;
        return dims?.length && viewerWidth > 0 ? fitWidthScale(dims, viewerWidth) : undefined;
      },
    }),
    [scrollToPosition, stepRuler, dims],
  );

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !onPageChange) return;
    const containerRect = container.getBoundingClientRect();
    const anchorY = containerRect.top + 96;
    const pages = container.querySelector('[data-page-list]')?.children;
    if (!pages?.length) return;
    let low = 0;
    let high = pages.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (pages[mid].getBoundingClientRect().top <= anchorY) low = mid + 1;
      else high = mid;
    }
    const currentPage = Math.max(1, low);

    if (currentPage !== lastPageRef.current) {
      lastPageRef.current = currentPage;
      onPageChange(currentPage);
    }
  }, [onPageChange]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || !dims?.length || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    if (initialScrollTop !== undefined) {
      root.scrollTop = initialScrollTop;
    } else if (initialPage && initialPage > 1) {
      const page = root.querySelector<HTMLElement>(`[data-page="${initialPage}"]`);
      if (page) root.scrollTop += page.getBoundingClientRect().top - root.getBoundingClientRect().top - 16;
    }
    onScrollTopChange?.(root.scrollTop);
    handleScroll();
  }, [dims, initialPage, initialScrollTop, onScrollTopChange, handleScroll]);

  const frameRef = useRef<number | null>(null);
  const onScroll = () => {
    if (didInitialScrollRef.current && scrollRef.current) onScrollTopChange?.(scrollRef.current.scrollTop);
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      handleScroll();
    });
  };

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <div
      ref={scrollRef}
      data-pdf-viewer
      onScroll={onScroll}
      className="relative h-full w-full overflow-auto bg-paper-bg"
    >
      {snipMode && (
        <div className="pointer-events-none sticky top-3 z-40 flex justify-center">
          <div className="pointer-events-auto rounded-full border border-paper-goldborder bg-paper-goldbg/95 px-4 py-1.5 text-xs text-paper-goldtext shadow-sm backdrop-blur">
            {t('snip.instructions')}
          </div>
        </div>
      )}

      {!dims ? (
        <div className="flex h-full items-center justify-center text-sm text-paper-muted">
          {t('reader.opening')}
        </div>
      ) : (
        <div data-page-list className="flex w-max min-w-full flex-col items-center gap-7 px-6 py-8">
          {dims.map((dim, index) => {
            const pageNumber = index + 1;
            const isVisible = visiblePages.has(pageNumber);
            const pageBlocks = translatedBlocksByPage?.[pageNumber];
            const isBilingual = translateMode === 'bilingual';
            const fitSingleScale = Math.min(
              1.35,
              Math.max(0.48, (Math.max(520, containerWidth - 68) / 2) / Math.max(1, dim.width)),
            );
            const effectiveScale = isBilingual ? fitSingleScale * (scale / 1.25) : scale;
            const pageWidth = dim.width * effectiveScale;
            const pageHeight = dim.height * effectiveScale;

            const primaryCanvas = (
              <PdfPageCanvas
                key={isBilingual ? `${pageNumber}-orig` : pageNumber}
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                isVisible={isVisible}
                scale={effectiveScale}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                citations={citationsByPage[pageNumber] ?? NO_CITATIONS}
                glossaryMentions={glossaryMentionsByPage[pageNumber] ?? NO_GLOSSARY_MENTIONS}
                flash={flash?.pageNumber === pageNumber ? flash : null}
                searchMatches={pageMatches[pageNumber]}
                activeMatchId={activeMatch?.pageNumber === pageNumber ? activeMatch.id : undefined}
                rulerRect={rulerEnabled && ruler?.page === pageNumber ? ruler.rect : undefined}
                onLockRuler={rulerEnabled ? lockRuler : undefined}
                snipMode={snipMode}
                translatedBlocks={translateMode === 'translated' ? pageBlocks : undefined}
                showTranslationOverlay={translateMode === 'translated'}
                onMentionHover={onMentionHover}
                onMentionLeave={onMentionLeave}
                onMentionClick={onMentionClick}
              />
            );

            if (!isBilingual) return primaryCanvas;

            return (
              <div key={pageNumber} className="flex items-start justify-center gap-5">
                {primaryCanvas}
                <PdfPageCanvas
                  key={`${pageNumber}-tr`}
                  pdfDoc={pdfDoc}
                  pageNumber={pageNumber}
                  isVisible={isVisible}
                  scale={effectiveScale}
                  pageWidth={pageWidth}
                  pageHeight={pageHeight}
                  citations={citationsByPage[pageNumber] ?? NO_CITATIONS}
                  glossaryMentions={NO_GLOSSARY_MENTIONS}
                  snipMode={false}
                  translatedBlocks={pageBlocks}
                  showTranslationOverlay
                  isCompanionPage
                  onMentionHover={onMentionHover}
                  onMentionLeave={onMentionLeave}
                  onMentionClick={onMentionClick}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
