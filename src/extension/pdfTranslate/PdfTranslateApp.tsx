import { usePreviewColor } from '../../components/peek/usePreviewColor';
import { openFullReader } from '../fullReader';
import { ThemeSwitcher } from '../../components/layout/ThemeSwitcher';
import { LocalizedError, describeError, formatMessage, message, useI18n, type DisplayMessage } from '../../i18n';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  Languages,
  Loader2,
  Minus,
  Plus,
  Square,
} from 'lucide-react';
import clsx from 'clsx';
import { loadPdfDocument } from '../../engine/pdfLoader';
import {
  extractPdfPageBlocks,
  type PdfParagraphBlock,
} from '../pdfParagraphs';
import type {
  ExtensionMessage,
  PageTranslateStatus,
  TranslateDisplayMode,
} from '../protocol';
import { deriveDisplayName } from '../urlRules';

interface TranslatedBlock extends PdfParagraphBlock {
  translated?: string;
}

interface PageMeta {
  pageNumber: number;
  width: number;
  height: number;
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  visible: boolean;
  blocks?: TranslatedBlock[];
  showOverlay: boolean;
  filter: string;
}

function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  width,
  height,
  visible,
  blocks,
  showOverlay,
  filter,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderedKeyRef = useRef<string>('');

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderKey = `${pageNumber}:${Math.round(width)}`;
    if (renderedKeyRef.current === renderKey) return;

    let cancelled = false;
    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = width / Math.max(1, baseViewport.width);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(width)}px`;
        canvas.style.height = `${Math.round(height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          renderedKeyRef.current = renderKey;
        }
      } catch {
        // 忽略中断的渲染任务
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, width, height, visible]);

  return (
    <div
      className="relative shrink-0 overflow-visible rounded-sm bg-paper-card shadow-paper"
      style={{ width: `${Math.round(width)}px`, height: `${Math.round(height)}px` }}
    >
      <canvas ref={canvasRef} className="block rounded-sm" style={{ filter }} />

      {showOverlay && blocks && blocks.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {blocks.map((block) => {
            if (!block.translated) return null;
            const boxH = block.rect.height * height;
            const boxW = block.rect.width * width;
            const avgLinePx = boxH / Math.max(1, block.lineCount);
            const fontSize = block.isHeading
              ? Math.min(20, Math.max(11.5, avgLinePx * 0.78))
              : block.isCaption
                ? Math.min(12.5, Math.max(9.5, avgLinePx * 0.72))
                : Math.min(14, Math.max(9.5, avgLinePx * 0.74));

            // 轻微外扩 1.5px 彻底遮盖原英文上下行尾笔画，同时避免侵入邻栏
            const padX = Math.min(3, boxW * 0.015);
            const padY = 1.5;

            return (
              <div
                key={block.id}
                style={{
                  left: `${Math.max(0, block.rect.x * width - padX)}px`,
                  top: `${Math.max(0, block.rect.y * height - padY)}px`,
                  width: `${Math.min(width, boxW + padX * 2)}px`,
                  minHeight: `${boxH + padY * 2}px`,
                  fontSize: `${fontSize.toFixed(1)}px`,
                  lineHeight: block.isHeading ? 1.28 : 1.38,
                }}
                className={clsx(
                  'pointer-events-auto absolute z-10 overflow-hidden bg-paper-card px-0.5 text-justify text-paper-ink transition-shadow hover:z-30 hover:h-auto hover:overflow-visible hover:rounded hover:shadow-float',
                  block.isHeading && 'font-semibold text-left',
                  block.isCaption && 'text-paper-ink',
                )}
              >
                {block.translated}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PdfTranslateApp() {
  const { t, locale } = useI18n();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const pdfUrl = params.get('url') || '';
  const { filter, colorToggle } = usePreviewColor(pdfUrl);
  const initialModeParam = params.get('mode');
  const initialMode: Exclude<TranslateDisplayMode, 'off'> =
    initialModeParam === 'bilingual' ? 'bilingual' : 'translated';

  const displayName = useMemo(
    () => deriveDisplayName(pdfUrl, params.get('title') || undefined),
    [pdfUrl, params, locale],
  );

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageMetas, setPageMetas] = useState<PageMeta[]>([]);
  const [blocksByPage, setBlocksByPage] = useState<Record<number, TranslatedBlock[]>>({});
  const [donePages, setDonePages] = useState<Set<number>>(new Set());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1, 2]));
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [displayMode, setDisplayMode] =
    useState<Exclude<TranslateDisplayMode, 'off'>>(initialMode);
  const [scale, setScale] = useState<number>(1);
  const [loadingPdf, setLoadingPdf] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<DisplayMessage | null>(null);

  const errorRef = useRef(error);
  errorRef.current = error;
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const visiblePagesRef = useRef<Set<number>>(new Set([1, 2]));
  const donePagesRef = useRef<Set<number>>(new Set());
  const blocksCacheRef = useRef<Map<number, TranslatedBlock[]>>(new Map());
  const runTokenRef = useRef(0);
  const runningRef = useRef(false);
  const displayModeRef = useRef<Exclude<TranslateDisplayMode, 'off'>>(initialMode);

  visiblePagesRef.current = visiblePages;
  donePagesRef.current = donePages;
  runningRef.current = running;
  displayModeRef.current = displayMode;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('translate.documentTitle', { name: displayName });
  }, [displayName, locale, t]);

  const getStatus = useCallback(
    (
      override?: Partial<PageTranslateStatus>,
    ): PageTranslateStatus => ({
      active: true,
      displayMode: displayModeRef.current,
      done: donePagesRef.current.size,
      total: pageMetas.length,
      running: runningRef.current,
      error: errorRef.current || undefined,
      ...override,
    }),
    [pageMetas.length],
  );

  const pushStatus = useCallback(
    (override?: Partial<PageTranslateStatus>) => {
      if (!pdfUrl) return;
      void chrome.runtime
        .sendMessage({
          type: 'REFPIN_PDF_TR_STATUS_PUSH',
          pdfUrl,
          status: getStatus(override),
        })
        .catch(() => {});
    },
    [getStatus, pdfUrl],
  );

  const restoreOriginalPdf = useCallback(() => {
    runTokenRef.current += 1;
    setRunning(false);
    pushStatus({ active: false, displayMode: 'off', running: false });
    if (pdfUrl) {
      window.location.replace(pdfUrl);
    }
  }, [pdfUrl, pushStatus]);

  // 1) 加载 PDF 文档与各页尺寸
  useEffect(() => {
    if (!pdfUrl) {
      setLoadingPdf(false);
      setError(message('translate.noPdfUrl'));
      return;
    }

    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;

    void (async () => {
      setLoadingPdf(true);
      setError(null);
      try {
        const res = await fetch(pdfUrl, {
          credentials: pdfUrl.startsWith('file://') ? 'omit' : 'include',
        });
        if (!res.ok) throw new LocalizedError(message('reader.httpError', { status: res.status }));
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        loadedDoc = await loadPdfDocument(buffer);
        if (cancelled) {
          void loadedDoc.destroy().catch(() => {});
          return;
        }

        const metas: PageMeta[] = [];
        const firstPage = await loadedDoc.getPage(1);
        const firstVp = firstPage.getViewport({ scale: 1 });
        for (let p = 1; p <= loadedDoc.numPages; p += 1) {
          metas.push({
            pageNumber: p,
            width: firstVp.width,
            height: firstVp.height,
          });
        }

        setPdfDoc(loadedDoc);
        setPageMetas(metas);
        setLoadingPdf(false);
      } catch (err) {
        if (cancelled) return;
        setLoadingPdf(false);
        setError(err instanceof Error && err.name === 'PasswordException' ? message('reader.encrypted') : describeError(err, message('reader.loadError')));
      }
    })();

    return () => {
      cancelled = true;
      runTokenRef.current += 1;
      if (loadedDoc) void loadedDoc.destroy().catch(() => {});
    };
  }, [pdfUrl]);

  // 2) 可见页追踪（懒渲染 + 可见页优先翻译）
  useEffect(() => {
    if (pageMetas.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNum = Number((entry.target as HTMLElement).dataset.pageNum);
            if (!Number.isFinite(pageNum)) continue;
            if (entry.isIntersecting) {
              next.add(pageNum);
            } else {
              next.delete(pageNum);
            }
          }
          return next;
        });
      },
      { rootMargin: '320px 0px' },
    );

    for (const el of pageElsRef.current.values()) {
      observer.observe(el);
    }

    // The observer preloads beyond the viewport. Use the actual reading position
    // for the page counter and the handoff to the full Reader.
    let frame = 0;
    const updateCurrentPage = () => {
      let low = 1, high = pageMetas.length;
      const readingLine = window.innerHeight / 3;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const element = pageElsRef.current.get(mid);
        if (element && element.getBoundingClientRect().top <= readingLine) low = mid;
        else high = mid - 1;
      }
      setCurrentPage(low);
      frame = 0;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(updateCurrentPage); };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [pageMetas.length, displayMode, scale]);

  // 3) 可见页优先流式翻译整篇 PDF
  const startTranslation = useCallback(
    async (doc: PDFDocumentProxy, totalPages: number) => {
      const token = ++runTokenRef.current;
      setRunning(true);
      runningRef.current = true;
      setError(null);
      pushStatus({ running: true, total: totalPages, error: undefined });

      const pickNextPage = (): number | null => {
        // 先找当前可见且未翻完的页
        const vis = Array.from(visiblePagesRef.current).sort((a, b) => a - b);
        for (const p of vis) {
          if (!donePagesRef.current.has(p) && p >= 1 && p <= totalPages) return p;
        }
        // 再按顺序翻剩余页
        for (let p = 1; p <= totalPages; p += 1) {
          if (!donePagesRef.current.has(p)) return p;
        }
        return null;
      };

      while (token === runTokenRef.current) {
        const pageNumber = pickNextPage();
        if (pageNumber === null) break;

        try {
          let pageBlocks = blocksCacheRef.current.get(pageNumber);
          if (!pageBlocks) {
            const extracted = await extractPdfPageBlocks(doc, pageNumber);
            if (token !== runTokenRef.current) return;
            pageBlocks = extracted.map((b) => ({ ...b }));
            blocksCacheRef.current.set(pageNumber, pageBlocks);
          }

          const pending = pageBlocks.filter((b) => !b.translated);
          const BATCH_SIZE = 5;

          for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            if (token !== runTokenRef.current) return;
            const slice = pending.slice(i, i + BATCH_SIZE);
            const resp = (await chrome.runtime.sendMessage({
              type: 'REFPIN_TRANSLATE_BATCH',
              texts: slice.map((b) => b.text),
            })) as { ok?: boolean; translations?: string[]; error?: DisplayMessage } | undefined;

            if (token !== runTokenRef.current) return;
            if (!resp?.ok || !Array.isArray(resp.translations)) {
              const errMsg = resp?.error || message('translate.requestFailed');
              setError(errMsg);
              setRunning(false);
              runningRef.current = false;
              pushStatus({ running: false, error: errMsg });
              return;
            }

            slice.forEach((b, idx) => {
              b.translated = resp.translations?.[idx] || b.text;
            });

            const snapshot = [...pageBlocks];
            blocksCacheRef.current.set(pageNumber, snapshot);
            setBlocksByPage((prev) => ({ ...prev, [pageNumber]: snapshot }));
          }

          const nextDone = new Set(donePagesRef.current);
          nextDone.add(pageNumber);
          donePagesRef.current = nextDone;
          setDonePages(nextDone);
          pushStatus({ done: nextDone.size, total: totalPages, running: true });
        } catch (err) {
          if (token !== runTokenRef.current) return;
          const errMsg = describeError(err, message('translate.failed'));
          setError(errMsg);
          setRunning(false);
          runningRef.current = false;
          pushStatus({ running: false, error: errMsg });
          return;
        }
      }

      if (token === runTokenRef.current) {
        setRunning(false);
        runningRef.current = false;
        pushStatus({ running: false, total: totalPages });
      }
    },
    [pushStatus],
  );

  // PDF 加载完毕立刻自动开始流式翻译
  useEffect(() => {
    if (!pdfDoc || pageMetas.length === 0) return;
    void startTranslation(pdfDoc, pageMetas.length);
  }, [pdfDoc, pageMetas.length, startTranslation]);

  // 4) 接收来自侧边栏的模式切换/停止/状态查询消息
  useEffect(() => {
    const onMessage = (
      rawMessage: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (resp?: unknown) => void,
    ) => {
      const msg = rawMessage as Partial<ExtensionMessage> | null;
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'REFPIN_PDF_TR_GET_STATUS') {
        sendResponse({ ok: true, status: getStatus() });
        return;
      }

      if (msg.type === 'REFPIN_PDF_TR_STOP') {
        runTokenRef.current += 1;
        setRunning(false);
        runningRef.current = false;
        const st = getStatus({ running: false });
        pushStatus(st);
        sendResponse({ ok: true, status: st });
        return;
      }

      if (msg.type === 'REFPIN_PDF_TR_SET_MODE' && msg.displayMode) {
        if (msg.displayMode === 'off') {
          sendResponse({ ok: true });
          restoreOriginalPdf();
          return;
        }
        setDisplayMode(msg.displayMode);
        displayModeRef.current = msg.displayMode;
        const st = getStatus({ displayMode: msg.displayMode });
        pushStatus(st);
        sendResponse({ ok: true, status: st });
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [getStatus, pushStatus, restoreOriginalPdf]);

  // 计算每页渲染宽度
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1100,
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const basePageWidth = useMemo(() => {
    const padding = 48;
    const avail = Math.max(360, viewportWidth - padding);
    if (displayMode === 'bilingual') {
      return Math.min(720, Math.max(340, (avail - 16) / 2)) * scale;
    }
    return Math.min(860, avail) * scale;
  }, [displayMode, scale, viewportWidth]);

  return (
    <div className="flex min-h-screen flex-col bg-paper-bg text-paper-ink">
      {/* 极简顶栏 */}
      <header className="sticky top-0 z-40 flex min-h-12 shrink-0 flex-wrap items-center py-1 gap-2.5 border-b border-paper-border bg-paper-card px-4 backdrop-blur">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-paper-ink text-xs font-bold text-paper-card">
          R
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-paper-ink">
          {displayName}
        </span>

        <button type="button" onClick={() => void openFullReader(pdfUrl, displayName, currentPage)}
          className="rounded-lg bg-paper-ink px-2.5 py-1 text-xs font-medium text-paper-card">{t('panel.openFullReader')}</button>
        <ThemeSwitcher />
        {colorToggle}
        <LanguageToggle />

        {pageMetas.length > 0 && (
          <span className="font-mono text-xs text-paper-muted">
            {currentPage} / {pageMetas.length}
          </span>
        )}

        <div className="flex items-center rounded-lg border border-paper-border bg-paper-card">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.7, Number((s - 0.1).toFixed(2))))}
            className="px-1.5 py-1 text-paper-muted hover:text-paper-ink"
            aria-label={t('reader.zoomOut')}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-xs text-paper-muted">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(1.6, Number((s + 0.1).toFixed(2))))}
            className="px-1.5 py-1 text-paper-muted hover:text-paper-ink"
            aria-label={t('reader.zoomIn')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex rounded-lg bg-paper-bg p-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setDisplayMode('translated');
              displayModeRef.current = 'translated';
              pushStatus({ displayMode: 'translated' });
            }}
            className={clsx(
              'rounded-md px-2.5 py-1 font-medium transition',
              displayMode === 'translated'
                ? 'bg-paper-card text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            {t('translate.only')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDisplayMode('bilingual');
              displayModeRef.current = 'bilingual';
              pushStatus({ displayMode: 'bilingual' });
            }}
            className={clsx(
              'rounded-md px-2.5 py-1 font-medium transition',
              displayMode === 'bilingual'
                ? 'bg-paper-card text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            {t('translate.bilingual')}
          </button>
          <button
            type="button"
            onClick={restoreOriginalPdf}
            className="rounded-md px-2.5 py-1 font-medium text-paper-muted transition hover:text-paper-ink"
          >
            {t('translate.original')}
          </button>
        </div>

        {running ? (
          <button
            aria-label={t('translate.stop')}
            title={t('translate.stop')}
            type="button"
            onClick={() => {
              runTokenRef.current += 1;
              setRunning(false);
              runningRef.current = false;
              pushStatus({ running: false });
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-paper-ink px-2.5 py-1 text-xs font-medium text-paper-card"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            {donePages.size}/{pageMetas.length}
          </button>
        ) : (
          pdfDoc &&
          donePages.size < pageMetas.length && (
            <button
              type="button"
              onClick={() => void startTranslation(pdfDoc, pageMetas.length)}
              className="inline-flex items-center gap-1 rounded-lg bg-paper-gold px-2.5 py-1 text-xs font-medium text-paper-card"
            >
              <Languages className="h-3 w-3" />
              {t('translate.resume')}
            </button>
          )
        )}
      </header>

      {error && (
        <div className="border-b border-paper-goldborder bg-paper-goldbg px-4 py-2 text-xs text-paper-ink">
          {formatMessage(error)}
        </div>
      )}

      {loadingPdf ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-paper-gold" />
        </div>
      ) : (
        <main className="flex flex-1 flex-col items-center gap-4 px-4 py-5">
          {pdfDoc &&
            pageMetas.map((meta) => {
              const renderWidth = basePageWidth;
              const renderHeight = (meta.height / Math.max(1, meta.width)) * renderWidth;
              const isVis = visiblePages.has(meta.pageNumber);
              const pageBlocks = blocksByPage[meta.pageNumber];

              return (
                <div
                  key={meta.pageNumber}
                  data-page-num={meta.pageNumber}
                  ref={(el) => {
                    if (el) pageElsRef.current.set(meta.pageNumber, el);
                    else pageElsRef.current.delete(meta.pageNumber);
                  }}
                  className={clsx(
                    'flex items-start justify-center',
                    displayMode === 'bilingual' ? 'gap-4' : '',
                  )}
                >
                  {displayMode === 'bilingual' && (
                    <PdfPageCanvas
                      pdfDoc={pdfDoc}
                      pageNumber={meta.pageNumber}
                      width={renderWidth}
                      height={renderHeight}
                      visible={isVis}
                      filter={filter}
                      showOverlay={false}
                    />
                  )}
                  <PdfPageCanvas
                    pdfDoc={pdfDoc}
                    pageNumber={meta.pageNumber}
                    width={renderWidth}
                    height={renderHeight}
                    visible={isVis}
                    blocks={pageBlocks}
                    filter={filter}
                    showOverlay
                  />
                </div>
              );
            })}
        </main>
      )}
    </div>
  );
}
