import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InlineCitation, NormalizedRect } from '../../types/paper';
import { useReaderStore } from '../../store/useReaderStore';
import { PdfPageCanvas, type FlashHighlight } from './PdfPageCanvas';

const NO_CITATIONS: InlineCitation[] = [];

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
  ) => void;
  getScrollTop: () => number;
  getScrollLeft: () => number;
}

interface Props {
  pdfDoc: PDFDocumentProxy;
  scale: number;
  citationsByPage: Record<number, InlineCitation[]>;
  snipMode: boolean;
  /** 文档就绪后自动滚到的起始页（示例论文直达演示页） */
  initialPage?: number;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  onCitationHover?: (citation: InlineCitation, anchor: HTMLElement) => void;
  onCitationLeave?: () => void;
  onCitationClick?: (citation: InlineCitation) => void;
  onPageChange?: (pageNumber: number) => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  {
    pdfDoc,
    scale,
    citationsByPage,
    snipMode,
    initialPage,
    initialScrollTop,
    onScrollTopChange,
    onCitationHover,
    onCitationLeave,
    onCitationClick,
    onPageChange,
  },
  ref,
) {
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

      container.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });

      if (flashHighlight) {
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        // 精确返回时优先使用来源矩形，而不是写死的假矩形
        const highlightRect: NormalizedRect = flashRect ??
          rect ?? { x: 0.08, y: 0.12, width: 0.84, height: 0.05 };
        setFlash({ pageNumber, rect: highlightRect, token: Date.now() });
        flashTimerRef.current = window.setTimeout(() => setFlash(null), 1800);
      }
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToPosition,
      getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      getScrollLeft: () => scrollRef.current?.scrollLeft ?? 0,
    }),
    [scrollToPosition],
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
          <div className="pointer-events-auto rounded-full border border-amber-200 bg-amber-50/95 px-4 py-1.5 text-xs text-amber-800 shadow-sm backdrop-blur">
            在论文任意区域拖拽框选，松手即钉到对照钉板 · 按 Esc 退出
          </div>
        </div>
      )}

      {!dims ? (
        <div className="flex h-full items-center justify-center text-sm text-paper-muted">
          正在打开论文…
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
              flash={flash?.pageNumber === index + 1 ? flash : null}
              snipMode={snipMode}
              onCitationHover={onCitationHover}
              onCitationLeave={onCitationLeave}
              onCitationClick={onCitationClick}
            />
          ))}
        </div>
      )}
    </div>
  );
});
