import { getCachedPageLines, nearestLineIndex, type SearchMatch } from '../../engine/pageLinesCache';
import { t } from '../../i18n/core';
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
}

interface Props {
  pdfDoc: PDFDocumentProxy;
  scale: number;
  citationsByPage: Record<number, InlineCitation[]>;
  glossaryMentionsByPage: Record<number, GlossaryMention[]>;
  searchMatches: SearchMatch[];
  activeMatch?: SearchMatch;
  snipMode: boolean;
  /** 文档就绪后自动滚到的起始页（示例论文直达演示页） */
  initialPage?: number;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  onMentionHover?: (mention: ReaderMention, anchor: HTMLElement) => void;
  onMentionLeave?: () => void;
  onMentionClick?: (mention: ReaderMention, anchor: HTMLElement) => void;
  onPageChange?: (pageNumber: number) => void;
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
    initialPage,
    initialScrollTop,
    onScrollTopChange,
    onMentionHover,
    onMentionLeave,
    onMentionClick,
    onPageChange,
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
        if (!cancelled) setDims(list);
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
  }, [dims]);

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
    }),
    [scrollToPosition, stepRuler],
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
          {dims.map((dim, index) => (
            <PdfPageCanvas
              key={index + 1}
              pdfDoc={pdfDoc}
              pageNumber={index + 1}
              isVisible={visiblePages.has(index + 1)}
              scale={scale}
              pageWidth={dim.width * scale}
              pageHeight={dim.height * scale}
              citations={citationsByPage[index + 1] ?? NO_CITATIONS}
              glossaryMentions={glossaryMentionsByPage[index + 1] ?? NO_GLOSSARY_MENTIONS}
              flash={flash?.pageNumber === index + 1 ? flash : null}
              searchMatches={pageMatches[index + 1]}
              activeMatchId={activeMatch?.pageNumber === index + 1 ? activeMatch.id : undefined}
              rulerRect={rulerEnabled && ruler?.page === index + 1 ? ruler.rect : undefined}
              onLockRuler={rulerEnabled ? lockRuler : undefined}
              snipMode={snipMode}
              onMentionHover={onMentionHover}
              onMentionLeave={onMentionLeave}
              onMentionClick={onMentionClick}
            />
          ))}
        </div>
      )}
    </div>
  );
});
