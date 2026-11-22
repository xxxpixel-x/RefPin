import { LocalizedError, describeError, formatMessage, message, useI18n, type DisplayMessage } from './i18n';
import { pinTitle } from './i18n/pinTitle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { LandingView } from './components/landing/LandingView';
import { TopBar } from './components/layout/TopBar';
import { ReturnBanner } from './components/layout/ReturnBanner';
import { HoverPeekCard, type PeekTrigger } from './components/peek/HoverPeekCard';
import { SelectionToolbar } from './components/peek/SelectionToolbar';
import { PinDock } from './components/dock/PinDock';
import { LightboxModal } from './components/dock/LightboxModal';
import { AssetDrawer } from './components/drawer/AssetDrawer';
import { PdfViewer, type PdfViewerHandle } from './components/pdf/PdfViewer';
import { loadReaderPdf } from './engine/pdfLoader';
import { findAssetForCitation } from './engine/backlinks';
import { parsePaper } from './engine/parsePaper';
import { captureDestinationPreview, recropPageRegion } from './engine/assetExtractor';
import { useReaderStore } from './store/useReaderStore';
import { SAMPLES, getSampleById } from './config/samples';
import {
  deletePaperArchive, listRecentPapers, loadPaperArchive, loadPdfBlob,
  MAX_PDF_BYTES, savePaperArchive, savePdfBlob,
} from './storage/paperDb';
import type {
  InlineCitation,
  NormalizedRect,
  PaperAsset,
  PaperArchive,
  PinnedItem,
  ReaderMention,
  ReferenceEntry,
  SamplePaperMeta,
} from './types/paper';

interface FallbackPreviewState {
  citationId: string;
  imageUrl: string;
  pageNumber: number;
  cropRect: NormalizedRect;
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
  const { t, locale } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('reader.title');
  }, [locale, t]);
  const pdfDoc = useReaderStore((state) => state.pdfDoc);
  const fileName = useReaderStore((state) => state.fileName);
  const numPages = useReaderStore((state) => state.numPages);
  const currentPage = useReaderStore((state) => state.currentPage);
  const scale = useReaderStore((state) => state.scale);
  const isParsing = useReaderStore((state) => state.isParsing);
  const parseProgress = useReaderStore((state) => state.parseProgress);
  const parseError = useReaderStore((state) => state.parseError);
  const isImageOnly = useReaderStore((state) => state.isImageOnly);
  const assetsMap = useReaderStore((state) => state.assetsMap);
  const referencesMap = useReaderStore((state) => state.referencesMap);
  const citationsByPage = useReaderStore((state) => state.citationsByPage);
  const glossaryMap = useReaderStore(state => state.glossaryMap);
  const glossaryMentionsByPage = useReaderStore(state => state.glossaryMentionsByPage);
  const backlinksMap = useReaderStore((state) => state.backlinksMap);
  const pinnedItems = useReaderStore((state) => state.pinnedItems);
  const drawerOpen = useReaderStore((state) => state.drawerOpen);
  const snipMode = useReaderStore((state) => state.snipMode);
  const jumpAnchor = useReaderStore((state) => state.jumpAnchor);
  const dockPosition = useReaderStore((state) => state.dockPosition);
  const dockWidth = useReaderStore((state) => state.dockWidth);
  const dockHeight = useReaderStore((state) => state.dockHeight);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const readerRef = useRef<HTMLElement>(null);
  const archiveSession = useRef<{ scrollTop: number; sampleId?: string; openedAt: number }>({
    scrollTop: 0, openedAt: 0,
  });
  const saveTimerRef = useRef<number>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const openControllerRef = useRef<AbortController | null>(null);
  const activePeekIdRef = useRef<string | null>(null);
  const nativePreviewCacheRef = useRef(
    new Map<string, { imageUrl: string; pageNumber: number; cropRect: NormalizedRect }>(),
  );
  const toastTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const [bootingName, setBootingName] = useState<string | null>(null);
  const [bootError, setBootError] = useState<DisplayMessage | null>(null);
  const [initialPage, setInitialPage] = useState<number | undefined>(undefined);
  const [initialScrollTop, setInitialScrollTop] = useState<number>();
  const [recent, setRecent] = useState<PaperArchive[]>([]);
  const [hoverTrigger, setHoverTrigger] = useState<PeekTrigger | null>(null);
  const [fallbackPreview, setFallbackPreview] = useState<FallbackPreviewState | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<PaperAsset | null>(null);
  const [highlightedPinId, setHighlightedPinId] = useState<string | null>(null);
  const [toast, setToast] = useState<DisplayMessage | null>(null);

  const flushArchive = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    const state = useReaderStore.getState();
    if (!state.paperHash || !state.pdfDoc) return;
    const { sampleId, scrollTop, openedAt } = archiveSession.current;
    return savePaperArchive({
      paperHash: state.paperHash, fileName: state.fileName, sampleId,
      numPages: state.numPages, lastPage: state.currentPage, lastScrollTop: scrollTop,
      scale: state.scale, lastOpenedAt: openedAt, pinnedItems: state.pinnedItems,
    });
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushArchive, 600);
  }, [flushArchive]);

  const handleScrollTop = useCallback((top: number) => {
    archiveSession.current.scrollTop = top;
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    const unsubscribe = useReaderStore.subscribe((next, previous) => {
      if (next.pdfDoc && (next.currentPage !== previous.currentPage || next.scale !== previous.scale ||
          next.pinnedItems !== previous.pinnedItems)) scheduleSave();
    });
    const saveWhenHidden = () => { if (document.visibilityState === 'hidden') void flushArchive(); };
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', flushArchive);
    return () => {
      unsubscribe();
      void flushArchive();
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', flushArchive);
    };
  }, [flushArchive, scheduleSave]);

  useEffect(() => {
    if (pdfDoc || bootingName) return;
    let active = true;
    void listRecentPapers().then(rows => { if (active) setRecent(rows); });
    return () => { active = false; };
  }, [pdfDoc, bootingName]);

  const showToast = useCallback((notice: DisplayMessage) => {
    setToast(notice);
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
      openControllerRef.current?.abort();
      useReaderStore.getState().resetPaper();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const openPaper = useCallback(
    async (input: string | File | PaperArchive, name: string, startPage?: number, sampleId?: string) => {
      const previousSave = flushArchive();
      openControllerRef.current?.abort();
      const controller = new AbortController();
      openControllerRef.current = controller;
      const { signal } = controller;
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
        await previousSave;
        signal.throwIfAborted();
        const url = typeof input === 'string' ? input : null;
        const fromCache = typeof input !== 'string' && 'paperHash' in input;
        const file = fromCache ? await loadPdfBlob(input.paperHash) : input;
        signal.throwIfAborted();
        if (!file) throw new LocalizedError(message('archive.cacheMissing'));
        // Snapshot the local file before pdf.js takes ownership of the ArrayBuffer.
        const cacheBlob = !fromCache && file instanceof Blob && file.size <= MAX_PDF_BYTES
          ? new Blob([file], { type: 'application/pdf' }) : null;
        const source = typeof file === 'string' ? file : await file.arrayBuffer();
        const { doc, paperHash } = await loadReaderPdf(source, name, signal);
        const archive = await loadPaperArchive(paperHash);
        if (signal.aborted) {
          void doc.destroy().catch(() => {});
          return;
        }
        archiveSession.current = {
          sampleId: sampleId ?? archive?.sampleId, scrollTop: archive?.lastScrollTop ?? 0, openedAt: Date.now(),
        };
        setInitialPage(archive?.lastPage ?? startPage);
        setInitialScrollTop(archive?.lastScrollTop);
        useReaderStore.getState().setPdfDocument(doc, name, paperHash, url, archive);
        setBootingName(null);
        void flushArchive();
        if (cacheBlob) void savePdfBlob(paperHash, cacheBlob, archiveSession.current.sampleId);
        useReaderStore.getState().setParsing(true);

        const restorePreviews = async () => {
          for (const item of useReaderStore.getState().pinnedItems) {
            if (signal.aborted) return;
            if (item.previewStatus !== 'restoring' || !item.cropRect) continue;
            let imageUrl: string | undefined;
            try {
              imageUrl = await recropPageRegion(doc, item.pageNumber, item.cropRect, undefined, signal);
            } catch { /* The pin and its jump target still work if this crop fails. */ }
            if (!signal.aborted) useReaderStore.getState().restorePinnedPreview(item, imageUrl);
          }
        };
        void restorePreviews();

        const result = await parsePaper(doc, (percent) => {
          if (!signal.aborted) useReaderStore.getState().setParseProgress(percent);
        }, signal);
        if (signal.aborted) return;
        useReaderStore.getState().setParseResult(result);
      } catch (error) {
        if (signal.aborted) return;
        setBootingName(null);
        const notice = error instanceof Error && error.name === 'PasswordException'
          ? message('reader.encrypted')
          : describeError(error, message('reader.openFailed'));
        useReaderStore.getState().setParseError(notice);
        setBootError(notice);
      } finally {
        if (!signal.aborted) {
          useReaderStore.getState().setParsing(false);
        }
      }
    },
    [flushArchive],
  );

  const handleOpenFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setBootError(message('reader.choosePdf'));
        return;
      }
      void openPaper(file, file.name);
    },
    [openPaper],
  );

  const handleSelectSample = useCallback(
    (sample: SamplePaperMeta) => {
      void openPaper(sample.url, `${sample.title}.pdf`, sample.demoStartPage, sample.id);
    },
    [openPaper],
  );

  const handleReset = useCallback(() => {
    void flushArchive();
    openControllerRef.current?.abort();
    openControllerRef.current = null;
    setBootingName(null);
    setBootError(null);
    setInitialPage(undefined);
    setHoverTrigger(null);
    setFallbackPreview(null);
    setLightboxAsset(null);
    activePeekIdRef.current = null;
    nativePreviewCacheRef.current.clear();
    useReaderStore.getState().resetPaper();
  }, [flushArchive]);

  const handlePinAsset = useCallback(
    (asset: PaperAsset) => {
      const store = useReaderStore.getState();
      if (store.pinnedItems.some((item) => item.id === asset.key)) {
        flashPinnedCard(asset.key);
        showToast(message('dock.alreadyPinned'));
        return;
      }
      store.pinAsset(asset);
      showToast(message('dock.pinnedName', { name: asset.label }));
    },
    [flashPinnedCard, showToast],
  );

  const handlePinReference = useCallback(
    (reference: ReferenceEntry) => {
      const store = useReaderStore.getState();
      if (store.pinnedItems.some((item) => item.id === reference.key)) {
        flashPinnedCard(reference.key);
        showToast(message('dock.alreadyPinnedRef', { index: reference.index }));
        return;
      }
      store.pinReference(reference);
      showToast(message('dock.pinnedRef', { index: reference.index }));
    },
    [flashPinnedCard, showToast],
  );

  const handleJump = useCallback(
    (
      pageNumber: number,
      targetRect?: NormalizedRect,
      sourceRect?: NormalizedRect,
      sourcePage?: number,
    ) => {
      const store = useReaderStore.getState();
      store.setJumpAnchor({
        fromPage: sourcePage ?? store.currentPage,
        fromScrollTop: viewerRef.current?.getScrollTop() ?? 0,
        fromScrollLeft: viewerRef.current?.getScrollLeft() ?? 0,
        highlightRect: sourceRect,
        label: t('reader.returnToPage', { page: sourcePage ?? store.currentPage }),
      });
      setHoverTrigger(null);
      viewerRef.current?.scrollToPosition(pageNumber, targetRect, true);
    },
    [],
  );

  const handlePeek = useCallback((mention: ReaderMention) => {
    activePeekIdRef.current = mention.id;
    const store = useReaderStore.getState();
    store.recordPeek();
    if ('term' in mention) {
      const definition = store.glossaryMap[mention.term];
      if (definition) store.recordSavedFlip(definition.definedPage);
      setFallbackPreview(null);
      return;
    }
    const citation = mention;

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
        if (useReaderStore.getState().pdfDoc !== doc) return;
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

  const handleMentionHover = useCallback(
    (mention: ReaderMention, anchorEl: HTMLElement) => {
      setHoverTrigger({ mention, anchorEl });
    },
    [],
  );

  const handleMentionLeave = useCallback(() => {
    setHoverTrigger(null);
  }, []);

  const handleMentionClick = useCallback(
    (mention: ReaderMention, anchorEl: HTMLElement) => {
      if ('term' in mention) {
        setHoverTrigger({ mention, anchorEl });
        return;
      }
      const citation = mention;
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
        if (useReaderStore.getState().pdfDoc !== store.pdfDoc) return;
        useReaderStore.getState().updatePinnedCrop(id, nextRect, imageUrl);
        showToast(direction === 'up' ? message('crop.extendedUp') : message('crop.extendedDown'));
      } catch {
        if (useReaderStore.getState().pdfDoc === store.pdfDoc) showToast(message('crop.extendFailed'));
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
        showToast(message('crop.resetDone'));
        return;
      }

      if (!store.pdfDoc) return;
      try {
        const imageUrl = await recropPageRegion(
          store.pdfDoc,
          item.pageNumber,
          item.originalCropRect,
        );
        if (useReaderStore.getState().pdfDoc !== store.pdfDoc) return;
        useReaderStore.getState().resetPinnedCrop(id, imageUrl);
        showToast(message('crop.resetDone'));
      } catch {
        if (useReaderStore.getState().pdfDoc === store.pdfDoc) showToast(message('crop.resetFailed'));
      }
    },
    [showToast],
  );

  const handleOpenLightboxFromPin = useCallback((item: PinnedItem) => {
    if (!item.imageUrl) return;
    setLightboxAsset({
      key: item.id,
      kind: item.kind === 'snip' || item.kind === 'reference' ? 'figure' : item.kind,
      label: pinTitle(item),
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
          <p className="text-sm font-medium text-paper-ink">{t('reader.openingFile', { name: bootingName })}</p>
        </div>
      );
    }

    return (
      <div className="min-h-full bg-paper-bg">
        <LandingView
          samples={SAMPLES}
          onOpenFile={(file) => void handleOpenFile(file)}
          onSelectSample={handleSelectSample}
          recent={recent}
          onOpenRecent={entry => {
            const sample = entry.sampleId && getSampleById(entry.sampleId);
            if (sample) handleSelectSample(sample);
            else void openPaper(entry, entry.fileName);
          }}
          onRemoveRecent={async hash => {
            if (await deletePaperArchive(hash)) setRecent(rows => rows.filter(row => row.paperHash !== hash));
            else setBootError(message('archive.removeFailed'));
          }}
          error={formatMessage(bootError || parseError)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-paper-bg">
      <TopBar
        fileName={archiveSession.current.sampleId ? getSampleById(archiveSession.current.sampleId)?.title ?? fileName : fileName}
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
        <div role="alert" className="border-b border-paper-goldborder bg-paper-goldbg px-4 py-1.5 text-xs text-paper-ink">
          {formatMessage(parseError || bootError)}
        </div>
      )}

      {isImageOnly && (
        <div role="status" className="border-b border-paper-border bg-white px-4 py-2 text-xs text-paper-muted">
          {t('reader.scanned')}
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
          backlinksMap={backlinksMap}
          onJumpToBacklink={handleJump}
          pinnedIds={pinnedIds}
          isParsing={isParsing}
          parseProgress={parseProgress}
          onClose={() => useReaderStore.getState().setDrawerOpen(false)}
          onPinAsset={handlePinAsset}
          onPinReference={handlePinReference}
          onLocate={(pageNumber, asset) => handleJump(pageNumber, asset?.cropRect)}
        />

        <main ref={readerRef} className="relative min-h-0 min-w-0 flex-1">
          <ReturnBanner
            anchor={jumpAnchor}
            onReturn={(anchor) => {
              viewerRef.current?.scrollToPosition(
                anchor.fromPage,
                anchor.fromScrollTop,
                true,
                anchor.highlightRect,
                anchor.fromScrollLeft,
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
            glossaryMentionsByPage={glossaryMentionsByPage}
            snipMode={snipMode}
            initialPage={initialPage}
            initialScrollTop={initialScrollTop}
            onScrollTopChange={handleScrollTop}
            onPageChange={(page) => useReaderStore.getState().setCurrentPage(page)}
            onMentionHover={handleMentionHover}
            onMentionLeave={handleMentionLeave}
            onMentionClick={handleMentionClick}
          />
          {!snipMode && <SelectionToolbar viewerRef={readerRef} />}
        </main>

        <PinDock
          currentPage={currentPage}
          citations={citationsByPage[currentPage] ?? []}
          assetsMap={assetsMap}
          onPinAsset={handlePinAsset}
          onPreviewAsset={setLightboxAsset}
          items={pinnedItems}
          backlinksMap={backlinksMap}
          onJumpToBacklink={handleJump}
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
        glossaryMap={glossaryMap}
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
          {formatMessage(toast)}
        </div>
      )}
    </div>
  );
}
