import { IS_EXTENSION_PAGE } from './config/runtime';
import { extensionPdfUrl, openRemotePdf, parsePaperLocation, type PaperLocation } from './services/arxivFetch';
import { LocalizedError, describeError, formatMessage, message, useI18n, type DisplayMessage } from './i18n';
import { pinTitle } from './i18n/pinTitle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { LandingView } from './components/landing/LandingView';
import { CommandPalette } from './components/layout/CommandPalette';
import { ShortcutHelp } from './components/layout/ShortcutHelp';
import { buildStudyNotesMarkdown, exportStudyPackZip } from './services/noteExporter';
import { TopBar } from './components/layout/TopBar';
import { ReadingBackupDialog } from './components/layout/ReadingBackupDialog';
import type { BackupAction } from './components/layout/SettingsMenu';
import { applyBackupSettings, type ParsedReadingBackup } from './storage/readingBackup';
import { restoreBackupTranslateConfig } from './services/translator';
import { getCachedPageLines, searchPageLines } from './engine/pageLinesCache';
import { SearchBar } from './components/layout/SearchBar';
import { ReturnBanner } from './components/layout/ReturnBanner';
import { OnboardingCoach } from './components/layout/OnboardingCoach';
import { useOnboarding } from './store/onboarding';
import { HoverPeekCard, type PeekTrigger } from './components/peek/HoverPeekCard';
import { SelectionToolbar } from './components/peek/SelectionToolbar';
import { HighlightEditor, type MenuPoint } from './components/peek/HighlightEditor';
import { PinDock } from './components/dock/PinDock';
import { useDockPopout } from './components/dock/useDockPopout';
import { LightboxModal } from './components/dock/LightboxModal';
import {
  closePreview,
  fitPreviewFrame,
  focusPreview,
  lastIndexWhere,
  loadImageSize,
  openPreview,
  type PreviewWindow,
} from './components/dock/previewWindows';
import { AssetDrawer } from './components/drawer/AssetDrawer';
import { PdfViewer, type PdfViewerHandle } from './components/pdf/PdfViewer';
import { loadReaderPdf } from './engine/pdfLoader';
import { findAssetForCitation, glossaryPinId } from './engine/backlinks';
import { parsePaper, type ScannedPaper } from './engine/parsePaper';
import { OcrBanner } from './components/pdf/OcrBanner';
import { captureDestinationPreview, recropPageRegion } from './engine/assetExtractor';
import { usePaperTranslation } from './services/usePaperTranslation';
import { NARROW_DOCK_QUERY, useReaderStore, visibleDockCollapsed } from './store/useReaderStore';
import { SAMPLES, getSampleById } from './config/samples';
import {
  deletePaperArchive, listRecentPapers, loadPaperArchive, loadPdfBlob,
  MAX_PDF_BYTES, mergePaperArchives, savePaperArchive, savePdfBlob,
} from './storage/paperDb';
import type {
  GlossaryEntry,
  Highlight,
  HighlightSelection,
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

interface ArchiveSession {
  scrollTop: number;
  sampleId?: string;
  openedAt: number;
  savedHighlights: Highlight[];
  saving?: Promise<boolean>;
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
  const [scannedPaper, setScannedPaper] = useState<ScannedPaper | null>(null);
  const assetsMap = useReaderStore((state) => state.assetsMap);
  const referencesMap = useReaderStore((state) => state.referencesMap);
  const citationsByPage = useReaderStore((state) => state.citationsByPage);
  const glossaryMap = useReaderStore(state => state.glossaryMap);
  const glossaryMentionsByPage = useReaderStore(state => state.glossaryMentionsByPage);
  const backlinksMap = useReaderStore((state) => state.backlinksMap);
  const pinnedItems = useReaderStore((state) => state.pinnedItems);
  const highlights = useReaderStore(state => state.highlights);
  const [highlightSaveFailed, setHighlightSaveFailed] = useState(false);
  const [annotation, setAnnotation] = useState<{ source: Highlight | HighlightSelection[]; point: MenuPoint } | null>(null);
  const editedHighlight = annotation && !Array.isArray(annotation.source) ? annotation.source : undefined;
  const editAnnotation = useCallback((item: Highlight, point: MenuPoint) => {
    setAnnotation({ source: item, point });
    setHoverTrigger(null);
  }, []);
  const closeAnnotation = useCallback(() => setAnnotation(null), []);
  const drawerOpen = useReaderStore((state) => state.drawerOpen);
  const drawerSection = useReaderStore((state) => state.drawerSection);
  const snipMode = useReaderStore((state) => state.snipMode);
  const outline = useReaderStore(state => state.outline);
  const bottomDrawer = useReaderStore(state => state.narrowDock && state.dockPosition !== 'popout');
  const savedPosition = useReaderStore(state => state.dockPosition);
  const dockPosition = bottomDrawer ? 'bottom' : savedPosition;
  const dockWidth = useReaderStore((state) => state.dockWidth);
  const dockHeight = useReaderStore((state) => state.dockHeight);
  const dockCollapsed = useReaderStore(visibleDockCollapsed);
  useEffect(() => {
    const media = window.matchMedia(NARROW_DOCK_QUERY);
    const update = () => useReaderStore.setState({ narrowDock: media.matches });
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([1, 2]));
  const coach = useOnboarding(state => state.run);
  const coachSession = useRef<{ sample?: SamplePaperMeta; replay: boolean }>({ replay: false });
  const translation = usePaperTranslation(pdfDoc, numPages, currentPage, visiblePages);

  const [sharedArxiv, setSharedArxiv] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('url') ? undefined : params.get('arxiv') || undefined;
  });
  const consumeLink = useCallback(() => setSharedArxiv(undefined), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [backupAction, setBackupAction] = useState<BackupAction | null>(null);
  const importingBackup = useRef(false);
  const [fitOnOpen, setFitOnOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportInProgress = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const lines = pdfDoc ? getCachedPageLines(pdfDoc) : undefined;
  const matches = useMemo(() => searchPageLines(lines, searchOpen ? query : ''), [lines, query, searchOpen]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setMatchIndex(0);
  }, []);
  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  }, [searchOpen, closeSearch]);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const readerRef = useRef<HTMLElement>(null);
  const archiveSession = useRef<ArchiveSession>({
    scrollTop: 0, openedAt: 0, savedHighlights: [],
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
  // 放大浮窗可以同时开多个，数组顺序即叠放顺序（最后一个在最前面）。
  const [previews, setPreviews] = useState<PreviewWindow[]>([]);
  const [highlightedPinId, setHighlightedPinId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ notice: DisplayMessage; action?: { label: DisplayMessage; run: () => void } } | null>(null);

  const flushArchive = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    const state = useReaderStore.getState();
    if (importingBackup.current || !state.paperHash || !state.pdfDoc) return;
    const session = archiveSession.current;
    const archive = {
      paperHash: state.paperHash, fileName: state.fileName, sampleId: session.sampleId,
      numPages: state.numPages, lastPage: state.currentPage, lastScrollTop: session.scrollTop,
      scale: state.scale, lastOpenedAt: session.openedAt, pinnedItems: state.pinnedItems, highlights: state.highlights,
    };
    const save = async () => {
      const saved = await savePaperArchive(archive, session.savedHighlights);
      if (useReaderStore.getState().pdfDoc === state.pdfDoc) {
        const hasChanges = session.savedHighlights !== archive.highlights &&
          (archive.highlights.length > 0 || session.savedHighlights.length > 0);
        setHighlightSaveFailed(!saved && hasChanges);
      }
      if (saved) session.savedHighlights = archive.highlights;
      return saved;
    };
    // 连续编辑或撤销按操作顺序写入，失败时保留上一次成功保存的比较基准。
    session.saving = session.saving ? session.saving.then(save) : save();
    return session.saving;
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
      if (next.pdfDoc && next.pdfDoc === previous.pdfDoc && next.highlights !== previous.highlights) {
        void flushArchive();
        return;
      }
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

  const showToast = useCallback((notice: DisplayMessage, action?: { label: DisplayMessage; run: () => void }) => {
    setToast({ notice, action });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    // Leave enough time to reach an Undo button.
    toastTimerRef.current = window.setTimeout(() => setToast(null), action ? 6000 : 1800);
  }, []);

  const { popoutWindow, openPopout } = useDockPopout(pdfDoc, showToast);
  const popoutRef = useRef(popoutWindow);
  popoutRef.current = popoutWindow;

  /** 打开放大浮窗：先读出截图尺寸，按比例算好默认大小；已打开的同一张图只提到最前面。 */
  const openPreviewWindow = useCallback(async (asset: PaperAsset, fromDock: boolean) => {
    setPreviews(list => focusPreview(list, asset.key));
    const size = await loadImageSize(asset.imageUrl);
    setPreviews(list => {
      if (list.some(item => item.id === asset.key)) return focusPreview(list, asset.key);
      const popout = popoutRef.current;
      const host = fromDock && popout ? popout : window;
      const cascade = list.filter(item => (item.fromDock && popout ? popout : window) === host).length;
      return openPreview(list, { id: asset.key, asset, fromDock, frame: fitPreviewFrame(size, host, cascade) });
    });
  }, []);

  const handleClearPins = useCallback(() => {
    const store = useReaderStore.getState();
    const previous = store.pinnedItems;
    if (!previous.length) return;
    const doc = store.pdfDoc;
    store.clearPinnedItems();
    showToast(message('dock.cleared', { count: previous.length }), {
      label: message('common.undo'),
      run: () => {
        const current = useReaderStore.getState();
        if (current.pdfDoc !== doc) return;
        current.restorePinnedItems([...previous, ...current.pinnedItems.filter(item => !previous.some(old => old.id === item.id))]);
        setToast(null);
      },
    });
  }, [showToast]);

  const handleExport = useCallback(async (mode: 'copy' | 'zip', host: Window = window) => {
    const notes = useReaderStore.getState();
    if (!notes.pdfDoc || exportInProgress.current) return;
    const signal = openControllerRef.current?.signal;
    try {
      if (mode === 'copy') {
        await host.navigator.clipboard.writeText(buildStudyNotesMarkdown(notes));
        showToast(message('notes.copied'));
      } else {
        exportInProgress.current = true;
        setExporting(true);
        const count = await exportStudyPackZip(notes, notes.pdfDoc, signal);
        showToast(count ? message('notes.partial', { count }) : message('notes.saved'));
      }
    } catch { if (!signal?.aborted) showToast(message(mode === 'copy' ? 'notes.copyFailed' : 'notes.failed')); }
    finally { exportInProgress.current = false; setExporting(false); }
  }, [showToast]);

  function deleteAnnotation(item: Highlight) {
    const store = useReaderStore.getState();
    const doc = store.pdfDoc;
    store.removeHighlight(item.id);
    closeAnnotation();
    showToast(message('highlight.deleted'), {
      label: message('common.undo'),
      run: () => {
        if (useReaderStore.getState().pdfDoc === doc) store.restoreHighlight(item);
        setToast(null);
      },
    });
  }

  const flashPinnedCard = useCallback((id: string) => {
    if (visibleDockCollapsed(useReaderStore.getState())) {
      useReaderStore.getState().toggleDockCollapsed();
    }
    setHighlightedPinId(id);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedPinId(null), 1400);
  }, []);

  useEffect(
    () => () => {
      openControllerRef.current?.abort();
      useOnboarding.getState().close();
      useReaderStore.getState().resetPaper();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const openPaper = useCallback(
    async (input: string | File | PaperArchive | PaperLocation, name: string, startPage?: number, sample?: SamplePaperMeta, replay = false) => {
      useOnboarding.getState().close();
      coachSession.current = { sample, replay };
      // 扩展示例仍使用本地 PDF 缓存，示例入口身份与归档方式独立。
      const sampleId = IS_EXTENSION_PAGE ? undefined : sample?.id;
      closeSearch();
      setSharedArxiv(undefined);
      setPaletteOpen(false);
      const previousSave = flushArchive();
      openControllerRef.current?.abort();
      const controller = new AbortController();
      setScannedPaper(null);
      openControllerRef.current = controller;
      const { signal } = controller;
      setBootError(null);
      setBootingName(name);
      setHighlightSaveFailed(false);
      setAnnotation(null);
      setInitialPage(startPage);
      setHoverTrigger(null);
      setFallbackPreview(null);
      setPreviews([]);
      activePeekIdRef.current = null;
      nativePreviewCacheRef.current.clear();

      useReaderStore.getState().resetPaper();

      try {
        await previousSave;
        signal.throwIfAborted();
        const url = typeof input === 'string' ? input : 'pdfUrl' in input ? input.pdfUrl : null;
        const fromCache = typeof input !== 'string' && 'paperHash' in input;
        let file: Blob | string | undefined;
        if (fromCache) file = await loadPdfBlob(input.paperHash);
        else if (typeof input === 'object' && 'pdfUrl' in input) file = await openRemotePdf(input, signal);
        else if (IS_EXTENSION_PAGE && typeof input === 'string') file = await openRemotePdf({ pdfUrl: input, displayName: name }, signal);
        else file = input;
        signal.throwIfAborted();
        if (!file) throw new LocalizedError(message('archive.cacheMissing'));
        // Snapshot the local file before pdf.js takes ownership of the ArrayBuffer.
        const cacheBlob = !fromCache && file instanceof Blob && file.size <= MAX_PDF_BYTES
          ? new Blob([file], { type: 'application/pdf' }) : null;
        const source = typeof file === 'string' ? file : await file.arrayBuffer();
        // Keep existing sample archives addressable when the hosting subpath changes.
        const sampleKey = sampleId && typeof source === 'string' ? '/samples/' + source.split('/').pop() : source;
        const { doc, paperHash } = await loadReaderPdf(source, name, signal, sampleKey);
        const archive = await loadPaperArchive(paperHash);
        if (signal.aborted) {
          void doc.destroy().catch(() => {});
          return;
        }
        const requestedPage = startPage && Math.min(startPage, doc.numPages);
        setFitOnOpen(!archive?.scale);
        const scrollTop = requestedPage ? undefined : archive?.lastScrollTop;
        archiveSession.current = {
          sampleId: sampleId ?? archive?.sampleId, scrollTop: scrollTop ?? 0,
          openedAt: Math.max(Date.now(), archive?.lastOpenedAt ?? 0),
          savedHighlights: archive?.highlights ?? [],
        };
        setInitialPage(requestedPage ?? archive?.lastPage);
        setInitialScrollTop(scrollTop);
        useReaderStore.getState().setPdfDocument(doc, name, paperHash, url, archive);
        if (requestedPage) useReaderStore.getState().setCurrentPage(requestedPage);
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
        }, signal, setScannedPaper);
        if (signal.aborted) return;
        useReaderStore.getState().setParseResult(result);
        useOnboarding.getState().start(sample, useReaderStore.getState(), coachSession.current.replay);
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
    [flushArchive, closeSearch],
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const url = params.get('url');
    if (!url) return;
    const timer = window.setTimeout(() => {
      const direct = IS_EXTENSION_PAGE && extensionPdfUrl(url);
      const paper = direct ? { pdfUrl: direct.href, displayName: direct.pathname.split('/').pop() || 'Paper.pdf' } : parsePaperLocation(url);
      if (!paper) { setBootError(message(IS_EXTENSION_PAGE ? 'remote.extensionInvalid' : 'remote.invalid')); return; }
      const title = params.get('title')?.trim() || paper.displayName;
      const page = Number(params.get('page'));
      // Keep signed and redirected PDF URLs intact when the extension opens a tab.
      void openPaper(paper, title,
        Number.isSafeInteger(page) && page > 0 ? page : undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openPaper]);

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

  useEffect(() => {
    if (!('launchQueue' in window)) return;
    const queue = window.launchQueue as { setConsumer: (consumer: (params: { files?: FileSystemFileHandle[] }) => void) => void };
    let active = true;
    let latest = 0;
    queue.setConsumer(async ({ files }) => {
      const handle = files?.find(item => item.kind === 'file' && /\.pdf$/i.test(item.name));
      if (!active || !handle) return;
      const request = ++latest;
      const previous = openControllerRef.current;
      try {
        const file = await handle.getFile();
        if (active && request === latest && previous === openControllerRef.current) handleOpenFile(file);
      } catch (error) {
        if (active && request === latest && previous === openControllerRef.current) setBootError(describeError(error, message('reader.openFailed')));
      }
    });
    return () => { active = false; };
  }, [handleOpenFile]);

  const handleSelectSample = useCallback(
    (sample: SamplePaperMeta) => {
      void openPaper(sample.url, `${sample.title}.pdf`, sample.demoStartPage, sample);
    },
    [openPaper],
  );

  const closePaper = useCallback(() => {
    useOnboarding.getState().close();
    closeSearch();
    window.clearTimeout(saveTimerRef.current);
    openControllerRef.current?.abort();
    openControllerRef.current = null;
    setScannedPaper(null);
    setBootingName(null);
    setBootError(null);
    setInitialPage(undefined);
    setAnnotation(null);
    setHoverTrigger(null);
    setFallbackPreview(null);
    setPreviews([]);
    activePeekIdRef.current = null;
    nativePreviewCacheRef.current.clear();
    useReaderStore.getState().resetPaper();
  }, [closeSearch]);

  const handleReset = useCallback(() => {
    void flushArchive();
    closePaper();
  }, [flushArchive, closePaper]);

  async function saveBeforeBackup() {
    const saving = flushArchive();
    if (saving) {
      if (!await saving) throw new LocalizedError(message('backup.saveFailed'));
    } else {
      // 从首页操作时，等刚关闭的论文写入完毕，再读取已存档的数据。
      await archiveSession.current.saving;
    }
  }

  async function importBackup(backup: ParsedReadingBackup) {
    const saved = saveBeforeBackup();
    importingBackup.current = true;
    try {
      await saved;
      const { imported, evicted } = await mergePaperArchives(backup.archives);
      const currentHash = useReaderStore.getState().paperHash;
      if (currentHash && (imported.includes(currentHash) || evicted.includes(currentHash))) closePaper();
      setRecent(await listRecentPapers());
      applyBackupSettings(backup.settings);
      const counts = { imported: imported.length, skipped: backup.total - imported.length };
      if (backup.translateConfig) {
        translation.setMode('off');
        try { await restoreBackupTranslateConfig(backup.translateConfig); }
        catch { return message('backup.configFailed', counts); }
      }
      return message('backup.imported', counts);
    } finally { importingBackup.current = false; }
  }

  const replayCoach = () => {
    const sample = coachSession.current.sample;
    if (!sample) {
      const demo = SAMPLES[0];
      void openPaper(demo.url, `${demo.title}.pdf`, demo.demoStartPage, demo, true);
      return;
    }
    coachSession.current.replay = true;
    setHoverTrigger(null);
    const reader = useReaderStore.getState();
    reader.setSnipMode(false);
    if (!reader.isParsing) useOnboarding.getState().start(sample, reader, true);
  };

  const handlePinAsset = useCallback(
    (asset: PaperAsset) => {
      const store = useReaderStore.getState();
      if (store.pinnedItems.some((item) => item.id === asset.key)) {
        flashPinnedCard(asset.key);
        showToast(message('dock.alreadyPinned'));
        return false;
      }
      store.pinAsset(asset);
      showToast(message('dock.pinnedName', { name: asset.label }));
      return true;
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

  const handlePinGlossary = useCallback(
    (entry: GlossaryEntry) => {
      const store = useReaderStore.getState();
      const id = glossaryPinId(entry.term);
      if (store.pinnedItems.some((item) => item.id === id)) {
        flashPinnedCard(id);
        showToast(message('dock.alreadyPinnedTerm', { term: entry.term }));
        return;
      }
      store.pinGlossary(entry);
      showToast(message('dock.pinnedTerm', { term: entry.term }));
    },
    [flashPinnedCard, showToast],
  );

  const handleJump = useCallback(
    (
      pageNumber: number,
      targetRect?: NormalizedRect,
      sourceRect?: NormalizedRect,
      sourcePage?: number,
      targetLabel?: string,
      titleId?: string,
    ) => {
      const store = useReaderStore.getState();
      const viewer = viewerRef.current;
      if (!viewer) return;
      const page = sourcePage ?? store.currentPage;
      const label = sourceRect && (store.citationsByPage[page]?.find(cite => cite.rect === sourceRect)?.rawText ??
        store.glossaryMentionsByPage[page]?.find(mention => mention.rect === sourceRect)?.term);
      const origin = { pageNumber: page, label, scrollTop: viewer.getScrollTop(),
        scrollLeft: viewer.getScrollLeft(), highlightRect: sourceRect };
      const target = viewer.scrollToPosition(pageNumber, targetRect, true);
      if (target) {
        store.recordJump(origin, { ...target, pageNumber, highlightRect: targetRect, label: targetLabel });
        useOnboarding.getState().send({ type: 'jumped', titleId, origin });
      }
      setHoverTrigger(null);
    },
    [],
  );

  const navigateHistory = useCallback((direction: 'back' | 'forward') => {
    const position = useReaderStore.getState().navigateHistory(direction);
    if (!position) return;
    setHoverTrigger(null);
    const target = viewerRef.current?.scrollToPosition(position.pageNumber, position.scrollTop, true, position.highlightRect, position.scrollLeft);
    if (target && direction === 'back') useOnboarding.getState().send({ type: 'returned', position });
  }, []);

  const handlePeek = useCallback((mention: ReaderMention) => {
    const run = useOnboarding.getState().run;
    if (run?.step === 'hover' && run.citation.id === mention.id) {
      setHoverTrigger(trigger => trigger?.mention.id === mention.id ? { ...trigger, locked: true } : trigger);
    }
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

  // Hovering previews a mention; a click locks that preview open so the reader can choose
  // between pinning it and jumping to it. A locked card ignores hovers until it is dismissed.
  const handleMentionHover = useCallback(
    (mention: ReaderMention, anchorEl: HTMLElement) => {
      setHoverTrigger(previous => previous?.locked ? previous : { mention, anchorEl });
    },
    [],
  );

  const handleMentionLeave = useCallback(() => {
    setHoverTrigger(previous => previous?.locked ? previous : null);
  }, []);

  const handleMentionClick = useCallback(
    (mention: ReaderMention, anchorEl: HTMLElement, touch?: boolean) => {
      setHoverTrigger({ mention, anchorEl, locked: true, touch });
    },
    [],
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
    const asset: PaperAsset = {
      key: item.id,
      kind: item.kind === 'snip' || item.kind === 'reference' || item.kind === 'glossary' ? 'figure' : item.kind,
      label: pinTitle(item),
      caption: item.subtitle ?? '',
      pageNumber: item.pageNumber,
      cropRect: item.cropRect ?? { x: 0, y: 0, width: 1, height: 1 },
      imageUrl: item.imageUrl,
    };
    void openPreviewWindow(asset, true);
  }, [openPreviewWindow]);

  // 全局快捷键：S 开关框选、[ 开关论文索引、G 开关术语栏、T 一键翻译、Esc 收起浮窗/框选
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useReaderStore.getState();
      if (event.isComposing || bootingName || backupAction) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(value => !value);
        return;
      }
      if (!state.pdfDoc || paletteOpen || shortcutsOpen) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleSearch();
        return;
      }
      if (event.key === 'Escape') {
        closeSearch();
        // 只关闭主窗口里最前面的一个浮窗；钉板小窗里的浮窗由小窗自己响应 Esc。
        setPreviews(list => {
          const popout = popoutRef.current;
          const index = lastIndexWhere(list, item => !(item.fromDock && popout));
          return index < 0 ? list : closePreview(list, list[index].id);
        });
        setHoverTrigger(null);
        translation.setSettingsOpen(false);
        if (useReaderStore.getState().snipMode) {
          useReaderStore.getState().setSnipMode(false);
        }
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.altKey) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          navigateHistory(event.key === 'ArrowLeft' ? 'back' : 'forward');
        } else if (state.readingRulerEnabled && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          viewerRef.current?.stepRuler(event.key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        state.setReadingRulerEnabled(!state.readingRulerEnabled);
        return;
      }

      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        state.setSnipMode(!state.snipMode);
      } else if (event.key === '[') {
        event.preventDefault();
        state.setDrawerOpen(!state.drawerOpen);
      } else if (event.key === ']' && state.dockPosition !== 'popout') {
        event.preventDefault();
        state.toggleDockCollapsed();
      } else if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        state.toggleDrawerSection('glossary');
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        translation.toggleTranslate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bootingName, backupAction, paletteOpen, shortcutsOpen, toggleSearch, closeSearch, navigateHistory, translation]);

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

  const glossaryList = useMemo(
    () =>
      Object.values(glossaryMap).sort(
        (a, b) => a.definedPage - b.definedPage || a.definedRect.y - b.definedRect.y,
      ),
    [glossaryMap],
  );

  const pinnedIds = useMemo(() => pinnedItems.map((item) => item.id), [pinnedItems]);

  const palette = paletteOpen && (
    <CommandPalette
      onClose={() => setPaletteOpen(false)}
      onPopout={popoutWindow ? undefined : openPopout}
      onExport={handleExport}
      onJump={(page, rect, label) => handleJump(page, rect, undefined, undefined, label)}
      onPinAsset={handlePinAsset}
      onPinReference={handlePinReference}
      onPinGlossary={handlePinGlossary}
      onToggleTranslate={translation.toggleTranslate}
      onSetTranslateMode={translation.setMode}
      onHome={handleReset}
      onSearch={() => setSearchOpen(true)}
    />
  );

  const backupDialog = backupAction && <ReadingBackupDialog key="reading-backup" action={backupAction}
    onClose={() => setBackupAction(null)} onBeforeExport={saveBeforeBackup} onImport={importBackup} />;

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
          onBackup={setBackupAction}
          samples={SAMPLES}
          initialArxiv={sharedArxiv}
          onConsumeLink={consumeLink}
          onOpenFile={handleOpenFile}
          onSelectSample={handleSelectSample}
          recent={recent}
          onOpenRecent={entry => {
            const sample = entry.sampleId && getSampleById(entry.sampleId);
            if (sample) void openPaper(sample.url, entry.fileName, undefined, sample);
            else void openPaper(entry, entry.fileName);
          }}
          onRemoveRecent={async hash => {
            if (await deletePaperArchive(hash)) setRecent(rows => rows.filter(row => row.paperHash !== hash));
            else setBootError(message('archive.removeFailed'));
          }}
          error={formatMessage(bootError || parseError)}
        />
        {palette}
        {backupDialog}
      </div>
    );
  }

  const dock = (
    <PinDock
      currentPage={currentPage}
      citations={citationsByPage[currentPage] ?? []}
      assetsMap={assetsMap}
      onPinAsset={handlePinAsset}
      onPreviewAsset={asset => void openPreviewWindow(asset, true)}
      items={pinnedItems}
      backlinksMap={backlinksMap}
      onJumpToBacklink={handleJump}
      highlightedId={highlightedPinId}
      position={dockPosition}
      width={dockWidth}
      height={dockHeight}
      dockCollapsed={dockCollapsed}
      bottomDrawer={bottomDrawer}
      onDockCollapsedChange={collapsed => bottomDrawer ? useReaderStore.setState({ drawerCollapsed: collapsed }) : useReaderStore.getState().setDockCollapsed(collapsed)}
      workspaceRef={workspaceRef}
      onPopout={openPopout}
      onPositionChange={(pos) => useReaderStore.getState().setDockPosition(pos)}
      onWidthChange={(w) => useReaderStore.getState().setDockWidth(w)}
      onHeightChange={(h) => useReaderStore.getState().setDockHeight(h)}
      onUnpin={(id) => useReaderStore.getState().unpinItem(id)}
      onToggleCollapse={(id) => useReaderStore.getState().togglePinCollapse(id)}
      onJump={(page, rect, titleId) => handleJump(page, rect, undefined, undefined, undefined, titleId)}
      onExpandCrop={(id, direction) => void handleExpandCrop(id, direction)}
      onResetCrop={(id) => void handleResetCrop(id)}
      onOpenLightbox={handleOpenLightboxFromPin}
      onRename={(id, title) => useReaderStore.getState().renamePinnedItem(id, title)}
      onMove={(id, delta) => useReaderStore.getState().movePinnedItem(id, delta === -1 ? 'up' : 'down')}
      onExport={mode => handleExport(mode, popoutWindow ?? window)}
      exporting={exporting}
      onClear={handleClearPins}
    />
  );

  return (
    <div className="flex h-full flex-col bg-paper-bg">
      <TopBar
        onBackup={setBackupAction}
        fileName={archiveSession.current.sampleId ? getSampleById(archiveSession.current.sampleId)?.title ?? fileName : fileName}
        numPages={numPages}
        currentPage={currentPage}
        scale={scale}
        snipMode={snipMode}
        isParsing={isParsing}
        parseProgress={parseProgress}
        assetCount={assetsList.length + glossaryList.length + referencesList.length + highlights.length}
        pinCount={pinnedItems.length}
        drawerOpen={drawerOpen}
        dockCollapsed={dockCollapsed}
        translation={translation}
        onPalette={() => setPaletteOpen(true)}
        onReplayCoach={replayCoach}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onSearch={toggleSearch}
        onJumpPage={handleJump}
        onZoom={(nextScale) => useReaderStore.getState().setScale(nextScale)}
        onFitWidth={() => {
          const fit = viewerRef.current?.getFitWidthScale();
          if (fit) useReaderStore.getState().setScale(fit);
        }}
        onToggleSnip={() => useReaderStore.getState().setSnipMode(!snipMode)}
        onToggleDrawer={() => useReaderStore.getState().setDrawerOpen(!drawerOpen)}
        onToggleDock={popoutWindow ? undefined : () => useReaderStore.getState().toggleDockCollapsed()}
        onReset={handleReset}
        onOpenFile={(file) => void handleOpenFile(file)}
      />

      {(parseError || bootError || translation.error) && (
        <div role="alert" className="border-b border-paper-goldborder bg-paper-goldbg px-4 py-1.5 text-xs text-paper-ink">
          {formatMessage(parseError || bootError || translation.error)}
        </div>
      )}
      {highlightSaveFailed && <div role="alert" className="border-b border-paper-goldborder bg-paper-goldbg px-4 py-1.5 text-xs text-paper-ink">
        {t('highlight.saveFailed')}
      </div>}

      {pdfDoc && scannedPaper && openControllerRef.current && <OcrBanner doc={pdfDoc} paper={scannedPaper}
        documentSignal={openControllerRef.current.signal} onComplete={(recognized, total) => {
          setScannedPaper(null);
          showToast(message('ocr.complete', { recognized, total }));
        }} />}

      <div
        ref={workspaceRef}
        className={clsx(
          'relative flex min-h-0 flex-1 overflow-hidden',
          dockPosition === 'top' || dockPosition === 'bottom' ? 'flex-col' : 'flex-row',
        )}
      >
        <AssetDrawer
          open={drawerOpen}
          section={drawerSection}
          onSectionChange={(sec) => useReaderStore.getState().setDrawerSection(sec)}
          assets={assetsList}
          outline={outline}
          glossary={glossaryList}
          highlights={highlights}
          onEditHighlight={editAnnotation}
          references={referencesList}
          backlinksMap={backlinksMap}
          onJumpToBacklink={handleJump}
          pinnedIds={pinnedIds}
          isParsing={isParsing}
          parseProgress={parseProgress}
          onClose={() => useReaderStore.getState().setDrawerOpen(false)}
          onPinAsset={handlePinAsset}
          onPinReference={handlePinReference}
          onPinGlossary={handlePinGlossary}
          onLocate={(page, rect, label) => handleJump(page, rect, undefined, undefined, label)}
          allowPush={dockPosition === 'left' || dockPosition === 'right'}
        />

        <main ref={readerRef} className="relative min-h-0 min-w-0 flex-1">
          <ReturnBanner onNavigate={navigateHistory} />
          {searchOpen && <SearchBar query={query} index={matchIndex} count={matches.length}
            onQuery={value => { setQuery(value); setMatchIndex(0); }}
            onStep={delta => { if (matches.length) setMatchIndex(i => (i + delta + matches.length) % matches.length); }}
            onClose={closeSearch} />}

          <PdfViewer
            ref={viewerRef}
            pdfDoc={pdfDoc}
            searchMatches={matches}
            activeMatch={matches[matchIndex]}
            scale={scale}
            citationsByPage={citationsByPage}
            glossaryMentionsByPage={glossaryMentionsByPage}
            highlights={highlights}
            onHighlightClick={editAnnotation}
            snipMode={snipMode}
            translateMode={translation.displayMode}
            translatedBlocksByPage={translation.blocksByPage}
            onVisiblePagesChange={setVisiblePages}
            initialPage={initialPage}
            initialScrollTop={initialScrollTop}
            onScrollTopChange={handleScrollTop}
            onPageChange={(page) => useReaderStore.getState().setCurrentPage(page)}
            fitWidthOnLoad={fitOnOpen}
            onFitScale={(fit) => useReaderStore.getState().setScale(fit)}
            onMentionHover={handleMentionHover}
            onMentionLeave={handleMentionLeave}
            onMentionClick={handleMentionClick}
          />
          {!snipMode && <SelectionToolbar viewerRef={readerRef} onOpenSettings={() => translation.setSettingsOpen(true)}
            onAnnotate={(pages, point) => { setHoverTrigger(null); setAnnotation({ source: pages, point }); }} />}
          {annotation && <HighlightEditor
            key={editedHighlight?.id ?? 'new'} point={annotation.point} highlight={editedHighlight}
            onClose={closeAnnotation}
            onSave={(color, note) => {
              const store = useReaderStore.getState();
              if (Array.isArray(annotation.source)) store.addHighlights(annotation.source, color, note);
              else store.editHighlight(annotation.source.id, color, note);
              closeAnnotation();
            }}
            onDelete={editedHighlight ? () => deleteAnnotation(editedHighlight) : undefined}
          />}
        </main>

        {popoutWindow ? createPortal(dock, popoutWindow.document.body) : dock}
      </div>

      <HoverPeekCard
        trigger={hoverTrigger}
        glossaryMap={glossaryMap}
        assetsMap={assetsMap}
        referencesMap={referencesMap}
        onPinAsset={asset => {
          if (handlePinAsset(asset)) {
            useOnboarding.getState().send({ type: 'pinned', assetId: asset.key });
            if (useOnboarding.getState().run?.step === 'jump') setHoverTrigger(null);
          }
        }}
        onPinReference={handlePinReference}
        onPinGlossary={handlePinGlossary}
        onJump={handleJump}
        onOpenLightbox={asset => void openPreviewWindow(asset, false)}
        onPeek={handlePeek}
        onDismiss={() => setHoverTrigger(null)}
        pinnedIds={pinnedIds}
        fallbackPreview={fallbackPreview}
      />

      {coach && <OnboardingCoach run={coach} dockWindow={popoutWindow} />}
      {previews.map((item, index) => {
        const host = item.fromDock && popoutWindow ? popoutWindow : window;
        const topOnHost = lastIndexWhere(previews, other => (other.fromDock && popoutWindow ? popoutWindow : window) === host) === index;
        return (
          <LightboxModal
            key={item.id}
            asset={item.asset}
            hostWindow={host}
            initialFrame={item.frame}
            zIndex={60 + index}
            onFocus={() => setPreviews(list => focusPreview(list, item.id))}
            closeOnEscape={host !== window && topOnHost}
            onClose={() => setPreviews(list => closePreview(list, item.id))}
          />
        );
      })}
      {palette}
      {backupDialog}
      {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}

      {/* Top-centred so it never collides with the jump-back bar at the bottom of the page. */}
      {toast && (
        <div role="status" className={clsx(
          'fixed left-1/2 top-[64px] z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full bg-paper-ink px-4 py-2 text-xs text-paper-card shadow-float',
          !toast.action && 'pointer-events-none',
        )}>
          <span>{formatMessage(toast.notice)}</span>
          {toast.action && (
            <button type="button" onClick={toast.action.run}
              className="rounded-full px-2 py-0.5 font-medium text-paper-gold hover:bg-paper-card/10">
              {formatMessage(toast.action.label)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
