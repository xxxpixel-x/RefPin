import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { LandingView } from './components/landing/LandingView';
import { TopBar } from './components/layout/TopBar';
import { ReturnBanner } from './components/layout/ReturnBanner';
import { HoverPeekCard, type PeekTrigger } from './components/peek/HoverPeekCard';
import { PinDock } from './components/dock/PinDock';
import { LightboxModal } from './components/dock/LightboxModal';
import { AssetDrawer } from './components/drawer/AssetDrawer';
import { PdfViewer, type PdfViewerHandle } from './components/pdf/PdfViewer';
import { loadPdfDocument } from './engine/pdfLoader';
import { parsePaper } from './engine/parsePaper';
import { captureDestinationPreview, recropPageRegion } from './engine/assetExtractor';
import { useReaderStore } from './store/useReaderStore';
import { SAMPLES } from './config/samples';
import type {
  InlineCitation,
  NormalizedRect,
  PaperAsset,
  PinnedItem,
  ReferenceEntry,
  SamplePaperMeta,
} from './types/paper';

interface FallbackPreviewState {
  citationId: string;
  imageUrl: string;
  pageNumber: number;
  cropRect: NormalizedRect;
}

function findAssetForCitation(
  citation: InlineCitation,
  assetsMap: Record<string, PaperAsset>,
): PaperAsset | undefined {
  for (const key of citation.targetKeys) {
    if (assetsMap[key]) return assetsMap[key];
    const baseKey = key.replace(/[a-z]$/, '');
    if (baseKey !== key && assetsMap[baseKey]) return assetsMap[baseKey];
  }
  return undefined;
}

function findReferenceForCitation(
  citation: InlineCitation,
  referencesMap: Record<string, ReferenceEntry>,
): ReferenceEntry | undefined {
  for (const key of citation.targetKeys) {
    if (referencesMap[key]) return referencesMap[key];
  }
  return undefined;
}

export default function App() {
  const pdfDoc = useReaderStore((state) => state.pdfDoc);
  const fileName = useReaderStore((state) => state.fileName);
  const numPages = useReaderStore((state) => state.numPages);
  const currentPage = useReaderStore((state) => state.currentPage);
  const scale = useReaderStore((state) => state.scale);
  const isParsing = useReaderStore((state) => state.isParsing);
  const parseProgress = useReaderStore((state) => state.parseProgress);
  const parseError = useReaderStore((state) => state.parseError);
  const assetsMap = useReaderStore((state) => state.assetsMap);
  const referencesMap = useReaderStore((state) => state.referencesMap);
  const citationsByPage = useReaderStore((state) => state.citationsByPage);
  const pinnedItems = useReaderStore((state) => state.pinnedItems);
  const drawerOpen = useReaderStore((state) => state.drawerOpen);
  const snipMode = useReaderStore((state) => state.snipMode);
  const jumpAnchor = useReaderStore((state) => state.jumpAnchor);
  const dockPosition = useReaderStore((state) => state.dockPosition);
  const dockWidth = useReaderStore((state) => state.dockWidth);
  const dockHeight = useReaderStore((state) => state.dockHeight);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const openRequestRef = useRef(0);
  const activePeekIdRef = useRef<string | null>(null);
  const nativePreviewCacheRef = useRef(
    new Map<string, { imageUrl: string; pageNumber: number; cropRect: NormalizedRect }>(),
  );
  const toastTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const [bootingName, setBootingName] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [initialPage, setInitialPage] = useState<number | undefined>(undefined);
  const [hoverTrigger, setHoverTrigger] = useState<PeekTrigger | null>(null);
  const [fallbackPreview, setFallbackPreview] = useState<FallbackPreviewState | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<PaperAsset | null>(null);
  const [highlightedPinId, setHighlightedPinId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const flashPinnedCard = useCallback((id: string) => {
    setHighlightedPinId(id);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedPinId(null), 1400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const openPaper = useCallback(
    async (source: string | ArrayBuffer, name: string, startPage?: number) => {
      const requestId = ++openRequestRef.current;
      setBootError(null);
      setBootingName(name);
      setInitialPage(startPage);
      setHoverTrigger(null);
      setFallbackPreview(null);
      setLightboxAsset(null);
      activePeekIdRef.current = null;
      nativePreviewCacheRef.current.clear();

      useReaderStore.getState().resetPaper();

      try {
        const doc = await loadPdfDocument(source);
        if (requestId !== openRequestRef.current) {
          void doc.destroy().catch(() => {});
          return;
        }
        setBootingName(null);
        useReaderStore.getState().setPdfDocument(doc, name, source);
        useReaderStore.getState().setParsing(true);

        const result = await parsePaper(doc, (percent) => {
          if (requestId === openRequestRef.current) {
            useReaderStore.getState().setParseProgress(percent);
          }
        });
        if (requestId !== openRequestRef.current) return;
        useReaderStore.getState().setParseResult(result);
      } catch (error) {
        if (requestId !== openRequestRef.current) return;
        setBootingName(null);
        const message = error instanceof Error ? error.message : '论文打开失败，请确认 PDF 文件有效';
        useReaderStore.getState().setParseError(message);
        setBootError(message);
      } finally {
        if (requestId === openRequestRef.current) {
          useReaderStore.getState().setParsing(false);
        }
      }
    },
    [],
  );

  const handleOpenFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setBootError('请选择 .pdf 格式的论文文件');
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        await openPaper(buffer, file.name);
      } catch {
        setBootError('读取本地 PDF 失败，请重试');
      }
    },
    [openPaper],
  );

  const handleSelectSample = useCallback(
    (sample: SamplePaperMeta) => {
      void openPaper(sample.url, `${sample.title}.pdf`, sample.demoStartPage);
    },
    [openPaper],
  );

  const handleReset = useCallback(() => {
    openRequestRef.current += 1;
    setBootingName(null);
    setBootError(null);
    setInitialPage(undefined);
    setHoverTrigger(null);
    setFallbackPreview(null);
    setLightboxAsset(null);
    activePeekIdRef.current = null;
    nativePreviewCacheRef.current.clear();
    useReaderStore.getState().resetPaper();
  }, []);

  const handlePinAsset = useCallback(
    (asset: PaperAsset) => {
      const store = useReaderStore.getState();
      if (store.pinnedItems.some((item) => item.id === asset.key)) {
        flashPinnedCard(asset.key);
        showToast('已在对照钉板中');
        return;
      }
      store.pinAsset(asset);
      showToast(`已钉住 ${asset.label}`);
    },
    [flashPinnedCard, showToast],
  );

  const handlePinReference = useCallback(
    (reference: ReferenceEntry) => {
      const store = useReaderStore.getState();
      if (store.pinnedItems.some((item) => item.id === reference.key)) {
        flashPinnedCard(reference.key);
        showToast(`文献 [${reference.index}] 已在钉板中`);
        return;
      }
      store.pinReference(reference);
      showToast(`已钉住文献 [${reference.index}]`);
    },
    [flashPinnedCard, showToast],
  );

  const handleJump = useCallback(
    (
      pageNumber: number,
      targetRect?: NormalizedRect,
      sourceRect?: NormalizedRect,
    ) => {
      const store = useReaderStore.getState();
      store.setJumpAnchor({
        fromPage: store.currentPage,
        fromScrollTop: viewerRef.current?.getScrollTop() ?? 0,
        highlightRect: sourceRect,
        label: `回到第 ${store.currentPage} 页刚才读的位置`,
      });
      setHoverTrigger(null);
      viewerRef.current?.scrollToPosition(pageNumber, targetRect, true);
    },
    [],
  );

  const handlePeek = useCallback((citation: InlineCitation) => {
    activePeekIdRef.current = citation.id;
    const store = useReaderStore.getState();
    store.recordPeek();

    const asset = findAssetForCitation(citation, store.assetsMap);
    const reference = findReferenceForCitation(citation, store.referencesMap);
    const targetPage =
      asset?.pageNumber ?? reference?.pageNumber ?? citation.nativeDest?.pageNumber;

    if (targetPage && targetPage !== store.currentPage) {
      store.recordSavedFlip(targetPage);
    }

    if (asset || reference || !citation.nativeDest || !store.pdfDoc) {
      setFallbackPreview(null);
      return;
    }

    const destPage = citation.nativeDest.pageNumber;
    const destY = citation.nativeDest.targetY;
    const cacheKey = `${destPage}:${destY !== undefined ? destY.toFixed(3) : 'top'}`;
    const cached = nativePreviewCacheRef.current.get(cacheKey);
    if (cached) {
      setFallbackPreview({ citationId: citation.id, ...cached });
      return;
    }

    setFallbackPreview(null);
    const doc = store.pdfDoc;
    void captureDestinationPreview(doc, destPage, destY)
      .then((preview) => {
        const entry = {
          imageUrl: preview.imageUrl,
          pageNumber: destPage,
          cropRect: preview.cropRect,
        };
        nativePreviewCacheRef.current.set(cacheKey, entry);
        if (activePeekIdRef.current === citation.id) {
          setFallbackPreview({ citationId: citation.id, ...entry });
        }
      })
      .catch(() => {
        // 兜底截屏失败时回落到文字提示，不影响主流程
      });
  }, []);

  const handleCitationHover = useCallback(
    (citation: InlineCitation, anchorEl: HTMLElement) => {
      setHoverTrigger({ citation, anchorEl });
    },
    [],
  );

  const handleCitationLeave = useCallback(() => {
    setHoverTrigger(null);
  }, []);

  const handleCitationClick = useCallback(
    (citation: InlineCitation) => {
      const store = useReaderStore.getState();
      const asset = findAssetForCitation(citation, store.assetsMap);
      if (asset) {
        handlePinAsset(asset);
        return;
      }
      const reference = findReferenceForCitation(citation, store.referencesMap);
      if (reference) {
        handlePinReference(reference);
        return;
      }
      if (citation.nativeDest) {
        handleJump(citation.nativeDest.pageNumber, undefined, citation.rect);
      }
    },
    [handleJump, handlePinAsset, handlePinReference],
  );

  const handleExpandCrop = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const store = useReaderStore.getState();
      const item = store.pinnedItems.find((entry) => entry.id === id);
      if (!item || !item.cropRect || !store.pdfDoc) return;

      const delta = 0.06;
      const { x, y, width, height } = item.cropRect;
      const nextY = direction === 'up' ? Math.max(0, y - delta) : y;
      const addedUp = y - nextY;
      const nextHeight =
        direction === 'up'
          ? Math.min(1 - nextY, height + addedUp)
          : Math.min(1 - y, height + delta);

      const nextRect: NormalizedRect = {
        x,
        y: nextY,
        width,
        height: nextHeight,
      };

      try {
        const imageUrl = await recropPageRegion(store.pdfDoc, item.pageNumber, nextRect);
        useReaderStore.getState().updatePinnedCrop(id, nextRect, imageUrl);
        showToast(direction === 'up' ? '已向上扩展裁切范围' : '已向下扩展裁切范围');
      } catch {
        showToast('扩充裁切失败，请重试');
      }
    },
    [showToast],
  );

  const handleResetCrop = useCallback(
    async (id: string) => {
      const store = useReaderStore.getState();
      const item = store.pinnedItems.find((entry) => entry.id === id);
      if (!item || !item.originalCropRect) return;

      if (item.originalImageUrl) {
        store.resetPinnedCrop(id);
        showToast('已还原初始裁切范围');
        return;
      }

      if (!store.pdfDoc) return;
      try {
        const imageUrl = await recropPageRegion(
          store.pdfDoc,
          item.pageNumber,
          item.originalCropRect,
        );
        useReaderStore.getState().resetPinnedCrop(id, imageUrl);
        showToast('已还原初始裁切范围');
      } catch {
        showToast('还原裁切失败，请重试');
      }
    },
    [showToast],
  );

  const handleOpenLightboxFromPin = useCallback((item: PinnedItem) => {
    if (!item.imageUrl) return;
    setLightboxAsset({
      key: item.id,
      kind: item.kind === 'snip' || item.kind === 'reference' ? 'figure' : item.kind,
      label: item.title,
      caption: item.subtitle ?? '',
      pageNumber: item.pageNumber,
      cropRect: item.cropRect ?? { x: 0, y: 0, width: 1, height: 1 },
      imageUrl: item.imageUrl,
    });
  }, []);

  // 全局快捷键：S 开关框选、[ 开关资产墙、Esc 收起浮窗/灯箱/框选
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxAsset(null);
        setHoverTrigger(null);
        if (useReaderStore.getState().snipMode) {
          useReaderStore.getState().setSnipMode(false);
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const state = useReaderStore.getState();
      if (!state.pdfDoc) return;

      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        state.setSnipMode(!state.snipMode);
      } else if (event.key === '[') {
        event.preventDefault();
        state.setDrawerOpen(!state.drawerOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const assetsList = useMemo(
    () =>
      Object.values(assetsMap).sort(
        (a, b) => a.pageNumber - b.pageNumber || a.cropRect.y - b.cropRect.y,
      ),
    [assetsMap],
  );

  const referencesList = useMemo(
    () => Object.values(referencesMap).sort((a, b) => a.index - b.index),
    [referencesMap],
  );

  const pinnedIds = useMemo(() => pinnedItems.map((item) => item.id), [pinnedItems]);

  if (!pdfDoc) {
    if (bootingName) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper-bg px-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-paper-goldborder bg-paper-goldbg text-paper-gold">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <p className="text-sm font-medium text-paper-ink">正在打开 {bootingName}</p>
        </div>
      );
    }

    return (
      <div className="min-h-full bg-paper-bg">
        <LandingView
          samples={SAMPLES}
          onOpenFile={(file) => void handleOpenFile(file)}
          onSelectSample={handleSelectSample}
          error={bootError || parseError}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-paper-bg">
      <TopBar
        fileName={fileName}
        numPages={numPages}
        currentPage={currentPage}
        scale={scale}
        snipMode={snipMode}
        isParsing={isParsing}
        parseProgress={parseProgress}
        assetCount={assetsList.length}
        onJumpPage={(page) => viewerRef.current?.scrollToPosition(page)}
        onZoom={(nextScale) => useReaderStore.getState().setScale(nextScale)}
        onToggleSnip={() => useReaderStore.getState().setSnipMode(!snipMode)}
        onToggleDrawer={() => useReaderStore.getState().setDrawerOpen(!drawerOpen)}
        onReset={handleReset}
        onOpenFile={(file) => void handleOpenFile(file)}
      />

      {(parseError || bootError) && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-1.5 text-xs text-red-600">
          {parseError || bootError}
        </div>
      )}

      <div
        ref={workspaceRef}
        className={clsx(
          'relative flex min-h-0 flex-1 overflow-hidden',
          dockPosition === 'top' || dockPosition === 'bottom' ? 'flex-col' : 'flex-row',
        )}
      >
        <AssetDrawer
          open={drawerOpen}
          assets={assetsList}
          references={referencesList}
          pinnedIds={pinnedIds}
          isParsing={isParsing}
          parseProgress={parseProgress}
          onClose={() => useReaderStore.getState().setDrawerOpen(false)}
          onPinAsset={handlePinAsset}
          onPinReference={handlePinReference}
          onLocate={(pageNumber, asset) => handleJump(pageNumber, asset?.cropRect)}
        />

        <main className="relative min-h-0 min-w-0 flex-1">
          <ReturnBanner
            anchor={jumpAnchor}
            onReturn={(anchor) => {
              viewerRef.current?.scrollToPosition(
                anchor.fromPage,
                anchor.fromScrollTop,
                true,
                anchor.highlightRect,
              );
              useReaderStore.getState().clearJumpAnchor();
            }}
            onDismiss={() => useReaderStore.getState().clearJumpAnchor()}
          />

          <PdfViewer
            ref={viewerRef}
            pdfDoc={pdfDoc}
            scale={scale}
            citationsByPage={citationsByPage}
            snipMode={snipMode}
            initialPage={initialPage}
            onPageChange={(page) => useReaderStore.getState().setCurrentPage(page)}
            onCitationHover={handleCitationHover}
            onCitationLeave={handleCitationLeave}
            onCitationClick={handleCitationClick}
          />
        </main>

        <PinDock
          items={pinnedItems}
          highlightedId={highlightedPinId}
          position={dockPosition}
          width={dockWidth}
          height={dockHeight}
          workspaceRef={workspaceRef}
          onPositionChange={(pos) => useReaderStore.getState().setDockPosition(pos)}
          onWidthChange={(w) => useReaderStore.getState().setDockWidth(w)}
          onHeightChange={(h) => useReaderStore.getState().setDockHeight(h)}
          onUnpin={(id) => useReaderStore.getState().unpinItem(id)}
          onToggleCollapse={(id) => useReaderStore.getState().togglePinCollapse(id)}
          onJump={(pageNumber, cropRect) => handleJump(pageNumber, cropRect)}
          onExpandCrop={(id, direction) => void handleExpandCrop(id, direction)}
          onResetCrop={(id) => void handleResetCrop(id)}
          onOpenLightbox={handleOpenLightboxFromPin}
          onRename={(id, title) => useReaderStore.getState().renamePinnedItem(id, title)}
          onClear={() => useReaderStore.getState().clearPinnedItems()}
        />
      </div>

      <HoverPeekCard
        trigger={hoverTrigger}
        assetsMap={assetsMap}
        referencesMap={referencesMap}
        onPinAsset={handlePinAsset}
        onPinReference={handlePinReference}
        onJump={handleJump}
        onOpenLightbox={setLightboxAsset}
        onPeek={handlePeek}
        fallbackPreview={fallbackPreview}
      />

      <LightboxModal asset={lightboxAsset} onClose={() => setLightboxAsset(null)} />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-paper-ink px-4 py-2 text-[11px] text-white shadow-float">
          {toast}
        </div>
      )}
    </div>
  );
}
