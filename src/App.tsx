import { useRef, useState } from 'react';
import {
  ArrowLeft,
  FileText,
  Pin,
  Scissors,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { PdfViewer, type PdfViewerHandle } from './components/pdf/PdfViewer';
import { loadPdfDocument } from './engine/pdfLoader';
import { parsePaper } from './engine/parsePaper';
import { useReaderStore } from './store/useReaderStore';
import { SAMPLES } from './config/samples';
import { clamp } from './engine/utils';
import type { InlineCitation } from './types/paper';

/**
 * A 线调试台：只用于验证解析引擎与 PDF 画布。
 * B 线会用自己的 Landing / TopBar / HoverPeekCard / PinDock / AssetDrawer 替换这里。
 */
export default function App() {
  const pdfDoc = useReaderStore((state) => state.pdfDoc);
  const fileName = useReaderStore((state) => state.fileName);
  const numPages = useReaderStore((state) => state.numPages);
  const currentPage = useReaderStore((state) => state.currentPage);
  const scale = useReaderStore((state) => state.scale);
  const isParsing = useReaderStore((state) => state.isParsing);
  const parseProgress = useReaderStore((state) => state.parseProgress);
  const parseError = useReaderStore((state) => state.parseError);
  const citationsByPage = useReaderStore((state) => state.citationsByPage);
  const assetsMap = useReaderStore((state) => state.assetsMap);
  const referencesMap = useReaderStore((state) => state.referencesMap);
  const pinnedItems = useReaderStore((state) => state.pinnedItems);
  const snipMode = useReaderStore((state) => state.snipMode);
  const jumpAnchor = useReaderStore((state) => state.jumpAnchor);
  const stats = useReaderStore((state) => state.stats);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const [hover, setHover] = useState<{ citation: InlineCitation; anchor: HTMLElement } | null>(
    null,
  );
  const [bootError, setBootError] = useState<string | null>(null);

  const citationCount = Object.values(citationsByPage).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  const openPaper = async (
    source: string | ArrayBuffer,
    name: string,
  ) => {
    setBootError(null);
    setHover(null);
    const store = useReaderStore.getState();
    store.resetPaper();
    try {
      const doc = await loadPdfDocument(source);
      useReaderStore.getState().setPdfDocument(doc, name, source);
      useReaderStore.getState().setParsing(true);
      const result = await parsePaper(doc, (percent) =>
        useReaderStore.getState().setParseProgress(percent),
      );
      useReaderStore.getState().setParseResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '论文打开失败';
      useReaderStore.getState().setParseError(message);
      setBootError(message);
    } finally {
      useReaderStore.getState().setParsing(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setBootError('请选择 PDF 文件');
      return;
    }
    const buffer = await file.arrayBuffer();
    await openPaper(buffer, file.name);
  };

  const handleHover = (citation: InlineCitation, anchor: HTMLElement) => {
    setHover({ citation, anchor });
    if (citation.nativeDest && citation.nativeDest.pageNumber !== currentPage) {
      useReaderStore.getState().recordPeek();
    }
  };

  const jumpTo = (pageNumber: number, rect?: InlineCitation['rect']) => {
    const store = useReaderStore.getState();
    store.setJumpAnchor({
      fromPage: store.currentPage,
      fromScrollTop: viewerRef.current?.getScrollTop() ?? 0,
      label: `回到第 ${store.currentPage} 页刚才读的位置`,
    });
    store.recordSavedFlip(pageNumber);
    viewerRef.current?.scrollToPosition(pageNumber, rect, true);
  };

  if (!pdfDoc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
        <div className="text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-paper-goldborder bg-paper-goldbg px-3 py-1 text-xs text-paper-goldtext">
            RefPin · 浮页
            <span className="text-paper-muted">sands in shoes</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-paper-ink">
            读论文，再也不用为看图来回翻页。
          </h1>
          <p className="mt-3 text-sm text-paper-muted">
            鼠标停在 Fig. 2 或 [14] 上，图表与文献立刻浮在眼前。
          </p>
        </div>

        <label className="flex w-full max-w-xl cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-paper-border bg-white px-8 py-10 shadow-paper transition hover:border-amber-400">
          <Upload className="h-5 w-5 text-paper-muted" />
          <span className="text-sm text-paper-ink">点击选择或拖入本地 PDF</span>
          <span className="text-xs text-paper-muted">
            100% 浏览器本地解析 · 论文不上传任何服务器
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => void openPaper(sample.url, `${sample.title}.pdf`)}
              className="flex items-center gap-3 rounded-xl border border-paper-border bg-white px-4 py-3 text-left shadow-paper transition hover:-translate-y-0.5 hover:border-amber-300"
            >
              <FileText className="h-4 w-4 text-amber-600" />
              <span>
                <span className="block text-sm text-paper-ink">{sample.title}</span>
                <span className="block text-xs text-paper-muted">{sample.badge}</span>
              </span>
            </button>
          ))}
        </div>

        {bootError && <p className="text-sm text-red-600">{bootError}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex h-[52px] shrink-0 items-center gap-3 border-b border-paper-border bg-white/85 px-4 backdrop-blur">
        <span className="text-sm font-semibold tracking-tight text-paper-ink">RefPin</span>
        <span className="max-w-[240px] truncate text-xs text-paper-muted">{fileName}</span>

        <span className="ml-2 flex items-center gap-1 rounded-lg border border-paper-border px-1 py-0.5">
          <input
            className="w-10 bg-transparent text-center text-xs outline-none"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const value = Number((event.target as HTMLInputElement).value);
              if (Number.isFinite(value) && value >= 1 && value <= numPages) {
                viewerRef.current?.scrollToPosition(value);
              }
            }}
            aria-label="跳转页码"
            defaultValue={currentPage}
            key={currentPage}
          />
          <span className="text-xs text-paper-muted">/ {numPages}</span>
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md p-1 text-paper-muted hover:bg-paper-bg"
            onClick={() => useReaderStore.getState().setScale(scale - 0.15)}
            aria-label="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs text-paper-muted">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className="rounded-md p-1 text-paper-muted hover:bg-paper-bg"
            onClick={() => useReaderStore.getState().setScale(scale + 0.15)}
            aria-label="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => useReaderStore.getState().setSnipMode(!snipMode)}
          className={
            snipMode
              ? 'flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs text-white'
              : 'flex items-center gap-1 rounded-lg border border-paper-border px-2.5 py-1.5 text-xs text-paper-ink hover:bg-paper-bg'
          }
        >
          <Scissors className="h-3.5 w-3.5" />
          框选钉住
        </button>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-paper-muted md:inline">
            引用 {citationCount} · 图表 {Object.keys(assetsMap).length} · 文献{' '}
            {Object.keys(referencesMap).length}
          </span>
          <span className="rounded-full border border-paper-goldborder bg-paper-goldbg px-3 py-1 text-xs font-medium text-paper-goldtext">
            已免去翻页 {stats.savedFlips} 次 · 少滚 {stats.savedScrollPx.toLocaleString()} px
          </span>
          <button
            type="button"
            onClick={() => useReaderStore.getState().resetPaper()}
            className="text-xs text-paper-muted hover:text-paper-ink"
          >
            换一篇
          </button>
        </div>

        {isParsing && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-amber-100">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${parseProgress}%` }}
            />
          </div>
        )}
      </header>

      {jumpAnchor && (
        <div className="flex justify-center border-b border-paper-border bg-paper-bg py-1.5">
          <button
            type="button"
            onClick={() => {
              viewerRef.current?.scrollToPosition(
                jumpAnchor.fromPage,
                jumpAnchor.fromScrollTop,
              );
              useReaderStore.getState().clearJumpAnchor();
            }}
            className="flex items-center gap-1.5 rounded-full border border-paper-border bg-white px-3 py-1 text-xs text-paper-ink shadow-sm hover:border-amber-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {jumpAnchor.label}
            <span
              className="ml-1 text-paper-muted hover:text-paper-ink"
              onClick={(event) => {
                event.stopPropagation();
                useReaderStore.getState().clearJumpAnchor();
              }}
            >
              ×
            </span>
          </button>
        </div>
      )}

      {(parseError || bootError) && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-1.5 text-xs text-red-600">
          {parseError || bootError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <PdfViewer
            ref={viewerRef}
            pdfDoc={pdfDoc}
            scale={scale}
            citationsByPage={citationsByPage}
            snipMode={snipMode}
            initialPage={SAMPLES.find((sample) => fileName.startsWith(sample.title))?.demoStartPage}
            onPageChange={(page) => useReaderStore.getState().setCurrentPage(page)}
            onCitationHover={handleHover}
            onCitationLeave={() => setHover(null)}
            onCitationClick={(citation) => {
              const asset = citation.targetKeys
                .map((key) => assetsMap[key])
                .find(Boolean);
              const reference = citation.targetKeys
                .map((key) => referencesMap[key])
                .find(Boolean);
              const page = asset?.pageNumber ?? reference?.pageNumber ?? citation.nativeDest?.pageNumber;
              if (page) jumpTo(page, asset?.cropRect);
            }}
          />
        </main>

        <aside className="w-[220px] shrink-0 overflow-y-auto border-l border-paper-border bg-white/70 p-3">
          <div className="mb-2 text-xs font-medium text-paper-ink">
            对照钉板 ({pinnedItems.length})
          </div>
          {pinnedItems.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-paper-muted">
              悬停正文金色引用，点浮窗里的「钉住」，或按 S 框选任意区域。
            </p>
          ) : (
            <div className="space-y-2">
              {pinnedItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-paper-border bg-white p-2 shadow-sm"
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-medium text-paper-ink">
                      {item.title}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] text-paper-muted hover:text-red-500"
                      onClick={() => useReaderStore.getState().unpinItem(item.id)}
                    >
                      ×
                    </button>
                  </div>
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="max-h-[120px] w-full rounded object-contain"
                    />
                  )}
                  <div className="mt-1 text-[10px] text-paper-muted">
                    P.{item.pageNumber}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {hover && <DebugPeek hover={hover} onJump={jumpTo} />}
    </div>
  );
}

function DebugPeek({
  hover,
  onJump,
}: {
  hover: { citation: InlineCitation; anchor: HTMLElement };
  onJump: (page: number, rect?: InlineCitation['rect']) => void;
}) {
  const assetsMap = useReaderStore((state) => state.assetsMap);
  const referencesMap = useReaderStore((state) => state.referencesMap);

  const asset = hover.citation.targetKeys
    .map((key) => assetsMap[key])
    .find(Boolean);
  const reference = hover.citation.targetKeys
    .map((key) => referencesMap[key])
    .find(Boolean);

  const rect = hover.anchor.getBoundingClientRect();
  const cardWidth = 320;
  const left = clamp(rect.left - 12, 16, window.innerWidth - cardWidth - 16);
  const below = rect.top < window.innerHeight - 320;
  const top = below ? rect.bottom + 10 : Math.max(16, rect.top - 300);

  return (
    <div
      className="animate-fade-in-up fixed z-50 w-[320px] rounded-xl border border-paper-border bg-white p-3 shadow-float"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded bg-paper-goldbg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-paper-goldtext">
          {hover.citation.kind} · P.{hover.citation.pageNumber}
        </span>
        <span className="text-[10px] text-paper-muted">{hover.citation.rawText}</span>
      </div>

      {asset && (
        <>
          {asset.imageUrl && (
            <img
              src={asset.imageUrl}
              alt={asset.label}
              className="max-h-[180px] w-full rounded object-contain ring-1 ring-paper-border"
            />
          )}
          <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-paper-muted">
            {asset.caption}
          </p>
        </>
      )}

      {!asset && reference && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-paper-ink">{reference.title}</p>
          <p className="text-[11px] text-paper-muted">
            {[reference.authors, reference.year].filter(Boolean).join(' · ')}
          </p>
          <p className="line-clamp-3 text-[11px] leading-relaxed text-paper-muted">
            {reference.rawText}
          </p>
        </div>
      )}

      {!asset && !reference && (
        <p className="text-[11px] leading-relaxed text-paper-muted">
          未自动定位到该引用的图表/文献
          {hover.citation.nativeDest
            ? `，PDF 原生链接指向第 ${hover.citation.nativeDest.pageNumber} 页`
            : '，可前往原页或使用「框选钉住」'}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {asset && (
          <button
            type="button"
            onClick={() => useReaderStore.getState().pinAsset(asset)}
            className="flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[11px] text-white hover:bg-amber-700"
          >
            <Pin className="h-3 w-3" />
            钉到右侧
          </button>
        )}
        {reference && (
          <button
            type="button"
            onClick={() => useReaderStore.getState().pinReference(reference)}
            className="flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[11px] text-white hover:bg-amber-700"
          >
            <Pin className="h-3 w-3" />
            钉住文献
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            onJump(
              asset?.pageNumber ??
                reference?.pageNumber ??
                hover.citation.nativeDest?.pageNumber ??
                hover.citation.pageNumber,
              asset?.cropRect,
            )
          }
          className="ml-auto rounded-lg border border-paper-border px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-bg"
        >
          跳去原页
        </button>
      </div>
    </div>
  );
}
