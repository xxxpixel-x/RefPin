import { openRemotePdf } from '../../services/arxivFetch';
import { openFullReader } from '../fullReader';
import { CompanionCommands, flattenOutline } from './CompanionCommands';
import { ThemeSwitcher } from '../../components/layout/ThemeSwitcher';
import { OutlineBranch } from '../../components/drawer/AssetDrawer';
import { usePreviewColor } from '../../components/peek/usePreviewColor';
import { ReferenceDetails } from '../../components/peek/ReferenceDetails';
import { BacklinkStrip } from '../../components/BacklinkStrip';
import { buildStudyNotesMarkdown, exportStudyPackZip, type StudyNotes } from '../../services/noteExporter';
import { describeError, formatMessage, message, useI18n, type DisplayMessage } from '../../i18n';
import { pinTitle, timedSnipTitle } from '../../i18n/pinTitle';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Crosshair,
  ExternalLink,
  FileSearch,
  Image as ImageIcon,
  Languages,
  Loader2,
  Maximize2,
  Pin,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  Settings,
  Square,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { loadPdfDocument } from '../../engine/pdfLoader';
import { parsePaper } from '../../engine/parsePaper';
import { recropPageRegion } from '../../engine/assetExtractor';
import { LightboxModal } from '../../components/dock/LightboxModal';
import type { NormalizedRect, PaperAsset } from '../../types/paper';
import {
  DEFAULT_TRANSLATE_CONFIG,
  STORAGE_KEY_PENDING_PIN,
  type CompanionIndex,
  type CompanionAsset,
  type CompanionPinItem,
  type CompanionReference,
  type DomPaperPayload,
  type PageTranslateStatus,
  type PendingPinRecord,
  type TranslateConfig,
  type TranslateDisplayMode,
} from '../protocol';
import {
  deriveDisplayName,
  inspectTabUrl,
  normalizeDocKey,
} from '../urlRules';
import { loadTranslateConfig, saveTranslateConfig } from '../translator';
import { ViewportSnipModal } from './ViewportSnipModal';
import { TranslateSettingsBar } from './TranslateSettingsBar';

type MainTab = 'pins' | 'assets' | 'outline' | 'glossary';
type AssetFilter = 'all' | CompanionAsset['kind'] | 'reference';
type SourceMode = 'idle' | 'dom' | 'pdf';

interface ZoomOverlayState {
  id: string;
  rect: {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  phase: 'entering' | 'open' | 'leaving';
}

const emptyIndex: CompanionIndex = { backlinksMap: {}, outline: [], glossaryMap: {} };

function CardImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const { filter, colorToggle } = usePreviewColor(src);
  return <>
    <img src={src} alt={alt} className={className} style={{ filter }} />
    <span className="absolute bottom-1 right-1">{colorToggle}</span>
  </>;
}

function PanelReferenceDetails({ reference }: { reference: CompanionReference }) {
  const entry = useMemo(() => ({ ...reference, pageNumber: reference.pageNumber ?? 0 }), [reference]);
  return <ReferenceDetails reference={entry} deferUntilVisible />;
}

export function SidePanelApp() {
  const { t, locale } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('panel.title');
  }, [locale, t]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const panelWindow = useRef<number>();
  const [activeWindowId, setActiveWindowId] = useState<number | undefined>(undefined);
  const [docKey, setDocKey] = useState<string>('');
  const [paperTitle, setDocTitle] = useState('');
  const docTitle = paperTitle || t('panel.title');
  const siteLabel = !docKey ? '' : docKey.startsWith('local:') ? t('site.localPdf') : inspectTabUrl(docKey).siteLabel;
  const [sourceMode, setSourceMode] = useState<SourceMode>('idle');
  const [linkedPdfUrl, setLinkedPdfUrl] = useState<string | null>(null);

  const [index, setIndex] = useState<CompanionIndex>(emptyIndex);
  const headings = useMemo(() => flattenOutline(index.outline), [index.outline]);
  const [termQuery, setTermQuery] = useState('');
  const terms = Object.values(index.glossaryMap);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const exportJob = useRef<AbortController | null>(null);
  const localFile = useRef<File | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => exportJob.current?.abort(), [docKey]);
  const [assets, setAssets] = useState<CompanionAsset[]>([]);
  const [references, setReferences] = useState<CompanionReference[]>([]);
  const [pinsByDoc, setPinsByDoc] = useState<Record<string, CompanionPinItem[]>>({});

  const [mainTab, setMainTab] = useState<MainTab>('assets');
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<'panel.fetching' | 'panel.parsing' | null>(null);
  const [errorMessage, setErrorMessage] = useState<DisplayMessage | null>(null);

  const [highlightedPinId, setHighlightedPinId] = useState<string | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [zoomOverlay, setZoomOverlay] = useState<ZoomOverlayState | null>(null);
  const [pageZoomActiveId, setPageZoomActiveId] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<PaperAsset | null>(null);
  const [snipScreenshot, setSnipScreenshot] = useState<string | null>(null);
  const [toast, setToast] = useState<DisplayMessage | null>(null);

  // ---- 整篇论文翻译控制状态（始终显示在左侧主页面，默认仅译文）----
  const [translateConfig, setTranslateConfig] = useState<TranslateConfig>(
    DEFAULT_TRANSLATE_CONFIG,
  );
  const [showTranslateSettings, setShowTranslateSettings] = useState<boolean>(false);
  const [isPdfTranslateTab, setIsPdfTranslateTab] = useState<boolean>(false);
  const [pageTranslateStatus, setPageTranslateStatus] = useState<PageTranslateStatus>({
    active: false,
    displayMode: 'off',
    done: 0,
    total: 0,
    running: false,
  });

  const syncRequestRef = useRef(0);
  const pdfJob = useRef<AbortController | null>(null);
  const parsedPdf = useRef<PDFDocumentProxy | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const docKeyRef = useRef<string>('');
  const toastTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoomEnterTimerRef = useRef<number | null>(null);
  const zoomLeaveTimerRef = useRef<number | null>(null);
  const zoomUnmountTimerRef = useRef<number | null>(null);
  const zoomRaf1Ref = useRef<number | null>(null);
  const zoomRaf2Ref = useRef<number | null>(null);
  const pageZoomActiveRef = useRef<string | null>(null);
  const activeTabIdRef = useRef<number | null>(null);
  const sourceModeRef = useRef<SourceMode>('idle');

  docKeyRef.current = docKey;
  pageZoomActiveRef.current = pageZoomActiveId;
  activeTabIdRef.current = activeTabId;
  sourceModeRef.current = sourceMode;

  const pinnedItems = useMemo(
    () => (docKey ? pinsByDoc[docKey] ?? [] : []),
    [docKey, pinsByDoc],
  );

  const pinnedIdSet = useMemo(
    () => new Set(pinnedItems.map((item) => item.id)),
    [pinnedItems],
  );

  const showToast = useCallback((notice: DisplayMessage) => {
    setToast(notice);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const flashPin = useCallback((id: string) => {
    setHighlightedPinId(id);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedPinId(null), 1500);
  }, []);

  const addPinForDoc = useCallback(
    (targetDocKey: string, item: CompanionPinItem, switchToPins = false) => {
      if (!targetDocKey) return;
      let existed = false;
      setPinsByDoc((prev) => {
        const list = prev[targetDocKey] ?? [];
        if (list.some((entry) => entry.id === item.id)) {
          existed = true;
          return prev;
        }
        return {
          ...prev,
          [targetDocKey]: [item, ...list],
        };
      });
      if (switchToPins) setMainTab('pins');
      flashPin(item.id);
      showToast(existed ? message('dock.alreadyPinned') : message('dock.pinnedName', { name: pinTitle(item) }));
    },
    [flashPin, showToast],
  );

  const destroyCurrentPdf = useCallback(() => {
    pdfJob.current?.abort();
    parsedPdf.current = null;
    if (pdfDocRef.current) {
      void pdfDocRef.current.destroy().catch(() => {});
      pdfDocRef.current = null;
    }
  }, []);

  const parsePdfBuffer = useCallback(
    async (buffer: ArrayBuffer, displayName: string, requestId: number) => {
      if (requestId !== syncRequestRef.current) return;
      destroyCurrentPdf();
      const job = new AbortController();
      pdfJob.current = job;
      setSourceMode('pdf');
      setIndex(emptyIndex);
      setAssets([]);
      setReferences([]);
      setDocTitle(displayName);
      setIsLoading(true);
      setProgress(12);
      setStatusMessage('panel.parsing');
      setErrorMessage(null);

      try {
        const doc = await loadPdfDocument(buffer, job.signal);
        if (requestId !== syncRequestRef.current) {
          void doc.destroy().catch(() => {});
          return;
        }
        pdfDocRef.current = doc;
        const result = await parsePaper(doc, (pct) => {
          if (requestId === syncRequestRef.current) {
            setProgress(Math.max(15, pct));
          }
        }, job.signal);
        if (requestId !== syncRequestRef.current) return;

        const nextAssets: CompanionAsset[] = Object.values(result.assetsMap)
          .sort((a, b) => a.pageNumber - b.pageNumber || a.cropRect.y - b.cropRect.y)
          .map((asset) => ({
            key: asset.key,
            kind: asset.kind,
            label: asset.label,
            caption: asset.caption,
            source: 'pdf',
            imageUrl: asset.imageUrl,
            pageNumber: asset.pageNumber,
            cropRect: asset.cropRect,
          }));

        const nextRefs: CompanionReference[] = Object.values(result.referencesMap)
          .sort((a, b) => a.index - b.index)
          .map((ref) => ({
            key: ref.key,
            index: ref.index,
            rawText: ref.rawText,
            title: ref.title || ref.rawText,
            authors: ref.authors,
            year: ref.year,
            pageNumber: ref.pageNumber,
          }));

        parsedPdf.current = doc;
        setIndex({ outline: result.outline, backlinksMap: result.backlinksMap, glossaryMap: result.glossaryMap });
        setAssets(nextAssets);
        setReferences(nextRefs);
        setProgress(100);
        setStatusMessage(null);
      } catch (error) {
        if (requestId !== syncRequestRef.current) return;
        setErrorMessage(
          error instanceof Error && error.name === 'PasswordException'
            ? message('reader.encrypted') : describeError(error, message('panel.parseFailed')),
        );
      } finally {
        if (requestId === syncRequestRef.current) {
          setIsLoading(false);
        }
      }
    },
    [destroyCurrentPdf],
  );

  const fetchAndParsePdfUrl = useCallback(
    async (pdfUrl: string, displayName: string, requestId: number) => {
      setIsLoading(true);
      setProgress(8);
      setStatusMessage('panel.fetching');
      setErrorMessage(null);

      pdfJob.current?.abort();
      const job = new AbortController();
      pdfJob.current = job;
      try {
        const file = await openRemotePdf({ pdfUrl, displayName }, job.signal);
        const buffer = await file.arrayBuffer();
        await parsePdfBuffer(buffer, displayName, requestId);
      } catch (error) {
        if (requestId !== syncRequestRef.current) return;
        setIsLoading(false);
        setErrorMessage(describeError(error, message('panel.fetchFailed')));
      }
    },
    [parsePdfBuffer],
  );

  const syncWithTab = useCallback(
    async (tab: chrome.tabs.Tab | undefined, forceDomScan = false) => {
      const requestId = ++syncRequestRef.current;
      const tabUrl = tab?.url || '';
      const tabId = tab?.id ?? null;
      setActiveTabId(tabId);
      setActiveWindowId(tab?.windowId);

      const pdfTrPrefix = chrome.runtime.getURL('pdf-translate.html');
      const onPdfTrPage = tabUrl.split('?')[0] === pdfTrPrefix;
      const onReaderPage = tabUrl.split('?')[0] === chrome.runtime.getURL('reader.html');
      localFile.current = null;
      setIsPdfTranslateTab(onPdfTrPage);

      let effectiveUrl = tabUrl;
      if (onPdfTrPage || onReaderPage) {
        try {
          const parsedTrUrl = new URL(tabUrl);
          effectiveUrl = parsedTrUrl.searchParams.get('url') || '';
        } catch {
          effectiveUrl = '';
        }
      }

      if (
        !effectiveUrl ||
        effectiveUrl.startsWith('chrome://') ||
        effectiveUrl.startsWith('edge://') ||
        effectiveUrl.startsWith('chrome-extension://')
      ) {
        destroyCurrentPdf();
        setDocKey('');
        setDocTitle('');
        setSourceMode('idle');
        setLinkedPdfUrl(null);
        setAssets([]);
        setReferences([]);
        setIndex(emptyIndex);
        setErrorMessage(null);
        setPageTranslateStatus({
          active: false,
          displayMode: 'off',
          done: 0,
          total: 0,
          running: false,
        });
        setIsLoading(false);
        return;
      }

      const nextDocKey = normalizeDocKey(effectiveUrl);
      const urlInfo = inspectTabUrl(effectiveUrl);
      const fallbackTitle = deriveDisplayName(
        effectiveUrl,
        onPdfTrPage || onReaderPage
          ? new URL(tabUrl).searchParams.get('title') || urlInfo.suggestedTitle
          : tab?.title || urlInfo.suggestedTitle,
      );

      const sameDocAsLoaded = docKeyRef.current === nextDocKey;
      if (!sameDocAsLoaded) setTermQuery('');
      setDocKey(nextDocKey);
      setDocTitle(fallbackTitle);
      setLinkedPdfUrl((onPdfTrPage || onReaderPage) ? effectiveUrl : urlInfo.pdfUrl ?? null);
      setErrorMessage(null);

      // 情况 1：当前标签页是原生 PDF，或正处于主标签页的沉浸式 PDF 译文视图
      if (onPdfTrPage || onReaderPage || (urlInfo.kind === 'pdf' && urlInfo.pdfUrl)) {
        const targetPdf = onPdfTrPage || onReaderPage ? effectiveUrl : urlInfo.pdfUrl!;
        if (onPdfTrPage) {
          const initialMode =
            new URL(tabUrl).searchParams.get('mode') === 'bilingual'
              ? 'bilingual'
              : 'translated';
          setPageTranslateStatus((prev) =>
            prev.active
              ? prev
              : {
                  active: true,
                  displayMode: initialMode,
                  done: 0,
                  total: 0,
                  running: true,
                },
          );
          void chrome.runtime
            .sendMessage({ type: 'REFPIN_PDF_TR_GET_STATUS', pdfUrl: targetPdf })
            .then((resp) => {
              const st = (resp as { ok?: boolean; status?: PageTranslateStatus } | undefined)
                ?.status;
              if (st && requestId === syncRequestRef.current) {
                setPageTranslateStatus(st);
              }
            })
            .catch(() => {});
        } else {
          setPageTranslateStatus({
            active: false,
            displayMode: 'off',
            done: 0,
            total: 0,
            running: false,
          });
        }

        // 若同一篇 PDF 在“原生 PDF ↔ 主页 PDF 译文”之间切换且已解析过资产，保留现有资产与钉板不重复解析
        if (sameDocAsLoaded && parsedPdf.current && !forceDomScan) {
          setSourceMode('pdf');
          setIsLoading(false);
          return;
        }

        setAssets([]);
        setReferences([]);
        setIndex(emptyIndex);
        if (/^https?:/i.test(targetPdf) && !onPdfTrPage && !forceDomScan) {
          // Merely switching the active tab must not download a remote paper.
          destroyCurrentPdf();
          setSourceMode('idle');
          setIsLoading(false);
          return;
        }
        await fetchAndParsePdfUrl(targetPdf, fallbackTitle, requestId);
        return;
      }

      setIndex(emptyIndex);
      // 情况 2：HTML 网页（学术 HTML 全文 / 摘要页 / 任意网页）
      destroyCurrentPdf();
      setAssets([]);
      setReferences([]);

      let domPayload: DomPaperPayload | null = null;
      if (tabId !== null) {
        try {
          const resp = (await chrome.tabs.sendMessage(tabId, {
            type: 'REFPIN_EXTRACT_DOM',
            force: forceDomScan,
          })) as { ok?: boolean; payload?: DomPaperPayload } | undefined;
          if (requestId !== syncRequestRef.current) return;
          if (resp?.ok && resp.payload) {
            domPayload = resp.payload;
          }
        } catch {
          // 某些受限页面或刚加载页面可能暂不可通信
        }
      }

      if (requestId !== syncRequestRef.current) return;
      const effectivePdfUrl = domPayload?.pdfUrl || urlInfo.pdfUrl || null;
      setLinkedPdfUrl(effectivePdfUrl);

      if (
        domPayload &&
        (domPayload.isAcademicPage ||
          forceDomScan ||
          domPayload.assets.length > 0 ||
          domPayload.references.length > 0)
      ) {
        setSourceMode('dom');
        setDocTitle(domPayload.title || fallbackTitle);
        setIndex({ outline: domPayload.outline ?? [], backlinksMap: domPayload.backlinksMap ?? {}, glossaryMap: domPayload.glossaryMap ?? {} });
        setAssets(domPayload.assets);
        setReferences(domPayload.references);
        setIsLoading(false);
        if (tabId !== null) {
          void chrome.tabs
            .sendMessage(tabId, { type: 'REFPIN_PAGE_TRANSLATE_GET_STATUS' })
            .then((resp) => {
              const st = (resp as { ok?: boolean; status?: PageTranslateStatus } | undefined)
                ?.status;
              if (st && requestId === syncRequestRef.current) {
                setPageTranslateStatus(st);
              }
            })
            .catch(() => {});
        }
        return;
      }

      setSourceMode('idle');
      setPageTranslateStatus({
        active: false,
        displayMode: 'off',
        done: 0,
        total: 0,
        running: false,
      });
      setIsLoading(false);
    },
    [destroyCurrentPdf, fetchAndParsePdfUrl],
  );

  // 初始化 + 监听标签页切换与更新 + 接收来自原网页的钉住消息
  useEffect(() => {
    let mounted = true;
    const loadActive = () => {
      void chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          if (!mounted) return;
          panelWindow.current = tabs[0]?.windowId;
          void syncWithTab(tabs[0], false);
        });
    };

    loadActive();
    void loadTranslateConfig().then(setTranslateConfig);

    // 读取打开侧边栏前由原网页悬停卡片写入的待钉入条目
    void chrome.storage.session.get(STORAGE_KEY_PENDING_PIN).then((data) => {
      const pending = data[STORAGE_KEY_PENDING_PIN] as PendingPinRecord | undefined;
      if (pending && Date.now() - pending.timestamp < 15_000) {
        const key = normalizeDocKey(pending.tabUrl);
        addPinForDoc(key, pending.item, true);
        void chrome.storage.session.remove(STORAGE_KEY_PENDING_PIN);
      }
    });

    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (info.windowId === panelWindow.current) loadActive();
    };

    const onUpdated = (
      tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active || tab.windowId !== panelWindow.current) return;
      if (changeInfo.status === 'complete' || changeInfo.url) {
        void syncWithTab(tab, false);
      }
    };

    const onMessage = (rawMessage: unknown) => {
      const msg = rawMessage as {
        type?: string;
        tabUrl?: string;
        pdfUrl?: string;
        item?: CompanionPinItem;
        status?: PageTranslateStatus;
      } | null;
      if (msg?.type === 'REFPIN_SIDEPANEL_PUSH_PIN' && msg.item && msg.tabUrl) {
        const key = normalizeDocKey(msg.tabUrl);
        addPinForDoc(key, msg.item, true);
        void chrome.storage.session.remove(STORAGE_KEY_PENDING_PIN);
      }
      if (
        msg?.type === 'REFPIN_PAGE_TRANSLATE_STATUS_PUSH' &&
        msg.status &&
        msg.tabUrl &&
        normalizeDocKey(msg.tabUrl) === docKeyRef.current
      ) {
        setPageTranslateStatus(msg.status);
      }
      if (
        msg?.type === 'REFPIN_PDF_TR_STATUS_PUSH' &&
        msg.status &&
        msg.pdfUrl &&
        normalizeDocKey(msg.pdfUrl) === docKeyRef.current
      ) {
        setPageTranslateStatus(msg.status);
      }
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onMessage);

    return () => {
      mounted = false;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
      ++syncRequestRef.current;
      destroyCurrentPdf();
    };
  }, [addPinForDoc, destroyCurrentPdf, syncWithTab]);

  // ---- 钉板与资产操作 ----
  const handlePinAsset = (asset: CompanionAsset) => {
    if (!docKey) return;
    const item: CompanionPinItem = {
      id: asset.key,
      kind: asset.kind,
      source: asset.source,
      title: asset.label,
      subtitle: asset.caption,
      imageUrl: asset.imageUrl,
      tableHtml: asset.tableHtml,
      textPreview: asset.textPreview,
      domAnchorId: asset.domAnchorId,
      pageNumber: asset.pageNumber,
      cropRect: asset.cropRect,
      originalCropRect: asset.cropRect,
      originalImageUrl: asset.imageUrl,
      pinnedAt: Date.now(),
    };
    addPinForDoc(docKey, item, false);
  };

  const handlePinReference = (ref: CompanionReference) => {
    if (!docKey) return;
    const item: CompanionPinItem = {
      id: ref.key,
      kind: 'reference',
      source: ref.domAnchorId ? 'dom' : 'pdf',
      title: `[${ref.index}] ${ref.title}`,
      subtitle: [ref.authors, ref.year].filter(Boolean).join(' · '),
      domAnchorId: ref.domAnchorId,
      pageNumber: ref.pageNumber,
      reference: ref,
      pinnedAt: Date.now(),
    };
    addPinForDoc(docKey, item, false);
  };

  const updateCurrentPins = (updater: (list: CompanionPinItem[]) => CompanionPinItem[]) => {
    if (!docKey) return;
    setPinsByDoc((prev) => ({
      ...prev,
      [docKey]: updater(prev[docKey] ?? []),
    }));
  };

  const handleMovePin = (id: string, delta: -1 | 1) => {
    updateCurrentPins((list) => {
      const idx = list.findIndex((item) => item.id === id);
      const nextIdx = idx + delta;
      if (idx < 0 || nextIdx < 0 || nextIdx >= list.length) return list;
      const copy = [...list];
      const [moved] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, moved);
      return copy;
    });
  };

  const handleExpandPdfCrop = async (item: CompanionPinItem, direction: 'up' | 'down') => {
    if (!pdfDocRef.current || !item.cropRect || !item.pageNumber) return;
    const delta = 0.06;
    const { x, y, width, height } = item.cropRect;
    const nextY = direction === 'up' ? Math.max(0, y - delta) : y;
    const addedUp = y - nextY;
    const nextHeight =
      direction === 'up'
        ? Math.min(1 - nextY, height + addedUp)
        : Math.min(1 - y, height + delta);

    const nextRect: NormalizedRect = { x, y: nextY, width, height: nextHeight };
    try {
      const imageUrl = await recropPageRegion(pdfDocRef.current, item.pageNumber, nextRect);
      updateCurrentPins((list) =>
        list.map((entry) =>
          entry.id === item.id ? { ...entry, cropRect: nextRect, imageUrl } : entry,
        ),
      );
      showToast(direction === 'up' ? message('crop.upDone') : message('crop.downDone'));
    } catch {
      showToast(message('crop.adjustFailed'));
    }
  };

  const handleResetPdfCrop = (item: CompanionPinItem) => {
    if (!item.originalCropRect || !item.originalImageUrl) return;
    updateCurrentPins((list) =>
      list.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              cropRect: entry.originalCropRect,
              imageUrl: entry.originalImageUrl,
            }
          : entry,
      ),
    );
    showToast(message('crop.restored'));
  };

  const handleLocateOnPage = (anchorId?: string) => {
    if (!anchorId || activeTabId === null) return;
    void chrome.tabs
      .sendMessage(activeTabId, {
        type: 'REFPIN_SCROLL_TO_ANCHOR',
        anchorId,
      })
      .catch(() => {
        showToast(message('panel.locateFailed'));
      });
  };

  const handleStartSnip = async () => {
    // 实时查询当前激活标签页，避免切窗口或刷新扩展后 tabId/windowId 过时
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const currentTab = tabs[0];
    const tabId = currentTab?.id ?? activeTabId;
    const windowId = currentTab?.windowId ?? activeWindowId;

    // 1) HTML 网页优先直接在左侧原网页拉起十字框选遮罩
    if (sourceMode !== 'pdf' && tabId !== null && tabId !== undefined) {
      try {
        const resp = (await chrome.tabs.sendMessage(tabId, {
          type: 'REFPIN_START_PAGE_SNIP',
        })) as { ok?: boolean } | undefined;
        if (resp?.ok) {
          showToast(message('panel.snipPrompt'));
          return;
        }
      } catch {
        // 页面未刷新或原生 PDF 页无法通信时，自动无缝回落到侧栏截屏框选
      }
    }

    // 2) 原生 PDF 页或未注入脚本的页面：直接抓取当前可见画面在侧边栏内框选
    try {
      const dataUrl =
        typeof windowId === 'number'
          ? await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
          : await chrome.tabs.captureVisibleTab({ format: 'png' });
      if (dataUrl) {
        setSnipScreenshot(dataUrl);
        return;
      }
    } catch {
      // 尝试经 background 兜底
    }

    const captureResp = (await chrome.runtime.sendMessage({
      type: 'REFPIN_CAPTURE_VISIBLE_TAB',
      windowId,
    })) as { ok?: boolean; dataUrl?: string; error?: string } | undefined;

    if (!captureResp?.ok || !captureResp.dataUrl) {
      const reason = captureResp?.error ? ` (${captureResp.error})` : '';
      showToast(message('panel.captureFailed', { reason }));
      return;
    }
    setSnipScreenshot(captureResp.dataUrl);
  };

  const handleLocalFileFallback = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast(message('panel.choosePdf'));
      return;
    }
    const requestId = ++syncRequestRef.current;
    const localKey = `local:${file.name}:${file.size}`;
    const buffer = await file.arrayBuffer();
    if (requestId !== syncRequestRef.current) return;
    localFile.current = file;
    setDocKey(localKey);
    setLinkedPdfUrl(null);
    await parsePdfBuffer(buffer, file.name, requestId);
  };

  // ---- 钉板悬停自动放大（对齐 PinDock 物理手感，并支持 HTML 页破框浮出到左侧网页）----
  const clearZoomTimers = useCallback(() => {
    if (zoomEnterTimerRef.current !== null) {
      window.clearTimeout(zoomEnterTimerRef.current);
      zoomEnterTimerRef.current = null;
    }
    if (zoomLeaveTimerRef.current !== null) {
      window.clearTimeout(zoomLeaveTimerRef.current);
      zoomLeaveTimerRef.current = null;
    }
    if (zoomUnmountTimerRef.current !== null) {
      window.clearTimeout(zoomUnmountTimerRef.current);
      zoomUnmountTimerRef.current = null;
    }
    if (zoomRaf1Ref.current !== null) {
      window.cancelAnimationFrame(zoomRaf1Ref.current);
      zoomRaf1Ref.current = null;
    }
    if (zoomRaf2Ref.current !== null) {
      window.cancelAnimationFrame(zoomRaf2Ref.current);
      zoomRaf2Ref.current = null;
    }
  }, []);

  const hidePageZoom = useCallback(() => {
    if (!pageZoomActiveRef.current) return;
    setPageZoomActiveId(null);
    if (activeTabIdRef.current !== null) {
      void chrome.tabs
        .sendMessage(activeTabIdRef.current, { type: 'REFPIN_HIDE_ZOOM_PREVIEW' })
        .catch(() => {});
    }
  }, []);

  const dismissZoomImmediately = useCallback(() => {
    clearZoomTimers();
    setZoomOverlay(null);
    hidePageZoom();
  }, [clearZoomTimers, hidePageZoom]);

  const openLightbox = (title: string, caption: string, imageUrl?: string, pageNumber?: number) => {
    if (!imageUrl) return;
    dismissZoomImmediately();
    setLightboxAsset({
      key: `lb:${title}`,
      kind: 'figure',
      label: title,
      caption,
      pageNumber: pageNumber ?? 1,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
      imageUrl,
    });
  };

  const scheduleZoomLeave = useCallback(() => {
    if (zoomEnterTimerRef.current !== null) {
      window.clearTimeout(zoomEnterTimerRef.current);
      zoomEnterTimerRef.current = null;
    }
    if (zoomLeaveTimerRef.current !== null) {
      window.clearTimeout(zoomLeaveTimerRef.current);
    }
    zoomLeaveTimerRef.current = window.setTimeout(() => {
      zoomLeaveTimerRef.current = null;
      hidePageZoom();
      setZoomOverlay((prev) => (prev ? { ...prev, phase: 'leaving' } : null));
      if (zoomUnmountTimerRef.current !== null) {
        window.clearTimeout(zoomUnmountTimerRef.current);
      }
      zoomUnmountTimerRef.current = window.setTimeout(() => {
        zoomUnmountTimerRef.current = null;
        setZoomOverlay(null);
      }, 210);
    }, 75);
  }, [hidePageZoom]);

  const openInPanelZoom = useCallback((id: string, rect: DOMRect) => {
    setZoomOverlay({
      id,
      rect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      phase: 'entering',
    });

    zoomRaf1Ref.current = window.requestAnimationFrame(() => {
      zoomRaf2Ref.current = window.requestAnimationFrame(() => {
        setZoomOverlay((prev) =>
          prev && prev.id === id && prev.phase === 'entering'
            ? { ...prev, phase: 'open' }
            : prev,
        );
      });
    });
  }, []);

  const handlePinHoverStart = useCallback(
    (item: CompanionPinItem, el: HTMLElement) => {
      if (item.collapsed || editingPinId === item.id || lightboxAsset || snipScreenshot) {
        return;
      }
      if (zoomLeaveTimerRef.current !== null) {
        window.clearTimeout(zoomLeaveTimerRef.current);
        zoomLeaveTimerRef.current = null;
      }
      if (zoomUnmountTimerRef.current !== null) {
        window.clearTimeout(zoomUnmountTimerRef.current);
        zoomUnmountTimerRef.current = null;
      }

      if (zoomOverlay?.id === item.id) {
        setZoomOverlay((prev) => (prev ? { ...prev, phase: 'open' } : prev));
        return;
      }
      if (pageZoomActiveRef.current === item.id) {
        return;
      }

      if (zoomEnterTimerRef.current !== null) {
        window.clearTimeout(zoomEnterTimerRef.current);
      }

      zoomEnterTimerRef.current = window.setTimeout(() => {
        zoomEnterTimerRef.current = null;
        if (!el.isConnected) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // 优先尝试在左侧 HTML 网页右缘破框浮出大尺寸放大预览；若当前是原生 PDF 或不可通信，无缝降级为侧栏内浮层放大
        const tabId = activeTabIdRef.current;
        if (sourceModeRef.current === 'dom' && tabId !== null) {
          const anchorCenterRatio =
            (rect.top + rect.height / 2) / Math.max(1, window.innerHeight);
          void chrome.tabs
            .sendMessage(tabId, {
              type: 'REFPIN_SHOW_ZOOM_PREVIEW',
              item,
              anchorCenterRatio,
            })
            .then((resp) => {
              const ok = (resp as { ok?: boolean } | undefined)?.ok;
              if (ok) {
                setZoomOverlay(null);
                setPageZoomActiveId(item.id);
              } else {
                openInPanelZoom(item.id, rect);
              }
            })
            .catch(() => {
              openInPanelZoom(item.id, rect);
            });
          return;
        }

        openInPanelZoom(item.id, rect);
      }, 130);
    },
    [editingPinId, lightboxAsset, openInPanelZoom, snipScreenshot, zoomOverlay?.id],
  );

  const handlePinHoverEnd = useCallback(
    (id: string) => {
      if (zoomEnterTimerRef.current !== null) {
        window.clearTimeout(zoomEnterTimerRef.current);
        zoomEnterTimerRef.current = null;
      }
      if (zoomOverlay?.id === id || pageZoomActiveRef.current === id) {
        scheduleZoomLeave();
      }
    },
    [scheduleZoomLeave, zoomOverlay?.id],
  );

  // 切换 Tab / 折叠移除 / 窗口失焦 / Esc 时自动收起悬浮放大
  useEffect(() => {
    dismissZoomImmediately();
  }, [mainTab, docKey, dismissZoomImmediately]);

  useEffect(() => {
    const activeId = zoomOverlay?.id || pageZoomActiveId;
    if (!activeId) return;
    const target = pinnedItems.find((entry) => entry.id === activeId);
    if (!target || target.collapsed) {
      dismissZoomImmediately();
    }
  }, [pinnedItems, zoomOverlay, pageZoomActiveId, dismissZoomImmediately]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissZoomImmediately();
    };
    const onBlur = () => dismissZoomImmediately();
    const onDocLeave = () => dismissZoomImmediately();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    document.addEventListener('mouseleave', onDocLeave);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mouseleave', onDocLeave);
      clearZoomTimers();
      hidePageZoom();
    };
  }, [clearZoomTimers, dismissZoomImmediately, hidePageZoom]);

  const zoomedItem = useMemo(
    () =>
      zoomOverlay
        ? pinnedItems.find((entry) => entry.id === zoomOverlay.id) ?? null
        : null,
    [pinnedItems, zoomOverlay],
  );

  const zoomedOverlayStyle = useMemo<CSSProperties | null>(() => {
    if (!zoomOverlay || !zoomedItem || typeof window === 'undefined') return null;
    const { rect, phase } = zoomOverlay;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const targetWidth = Math.max(280, vw - 16);
    const startScale = Number(
      Math.min(0.95, Math.max(0.84, rect.width / targetWidth)).toFixed(3),
    );
    const isOpen = phase === 'open';
    const anchorBottom = rect.top + rect.height / 2 > vh * 0.54;

    return {
      position: 'fixed',
      left: 8,
      right: 8,
      zIndex: 45,
      ...(anchorBottom
        ? { bottom: Math.max(10, vh - rect.bottom - 6), transformOrigin: 'center bottom' }
        : { top: Math.max(54, rect.top - 6), transformOrigin: 'center top' }),
      opacity: isOpen ? 1 : 0,
      transform: isOpen
        ? 'scale(1) translate3d(0, 0, 0)'
        : `scale(${startScale}) translate3d(0, 0, 0)`,
      boxShadow: isOpen
        ? '0 24px 64px -8px rgba(28, 25, 23, 0.24), 0 8px 20px -4px rgba(28, 25, 23, 0.12)'
        : '0 4px 12px rgba(28, 25, 23, 0.06)',
      borderRadius: 12,
      pointerEvents: phase === 'leaving' ? 'none' : 'auto',
      transition:
        phase === 'leaving'
          ? 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease-out, box-shadow 200ms ease-out'
          : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out, box-shadow 300ms cubic-bezier(0.22, 1, 0.36, 1)',
      willChange: 'transform, opacity',
    };
  }, [zoomOverlay, zoomedItem]);

  // ---- 整篇翻译控制（始终直接作用于左侧主页面：HTML 就地替换 / PDF 原位译文覆盖）----
  const handleUpdateTranslateConfig = (next: TranslateConfig) => {
    setTranslateConfig(next);
    void saveTranslateConfig(next);
  };

  const openPdfTranslateInMainTab = async (
    pdfUrl: string,
    displayMode: Exclude<TranslateDisplayMode, 'off'> = 'translated',
  ) => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = tabs[0]?.id ?? activeTabId;
    if (tabId === null || tabId === undefined) return;
    const targetUrl = new URL(chrome.runtime.getURL('pdf-translate.html'));
    targetUrl.searchParams.set('url', pdfUrl);
    targetUrl.searchParams.set('mode', displayMode);
    if (docTitle) targetUrl.searchParams.set('title', docTitle);
    await chrome.tabs.update(tabId, { url: targetUrl.href });
  };

  const hasPdfSource = sourceMode === 'pdf' || (sourceMode === 'idle' && inspectTabUrl(docKey).kind === 'pdf');
  const handleStartTranslate = async (
    displayMode: Exclude<TranslateDisplayMode, 'off'> = 'translated',
  ) => {
    // 情况 1：已在主页 PDF 译文视图 -> 直接切换模式
    if (isPdfTranslateTab && linkedPdfUrl) {
      void chrome.runtime
        .sendMessage({
          type: 'REFPIN_PDF_TR_SET_MODE',
          pdfUrl: linkedPdfUrl,
          displayMode,
        })
        .catch(() => {});
      return;
    }

    // 情况 2：原生 PDF 页面 -> 在左侧主标签页切入原位 PDF 译文视图
    if (hasPdfSource && linkedPdfUrl) {
      await openPdfTranslateInMainTab(linkedPdfUrl, displayMode);
      return;
    }

    // 情况 3：HTML 论文网页 -> 直接在原网页就地翻译替换
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = tabs[0]?.id ?? activeTabId;
    if (tabId === null || tabId === undefined) return;
    try {
      const resp = (await chrome.tabs.sendMessage(tabId, {
        type: 'REFPIN_PAGE_TRANSLATE_START',
        displayMode,
      })) as { ok?: boolean; status?: PageTranslateStatus } | undefined;
      if (resp?.status) setPageTranslateStatus(resp.status);
    } catch {
      showToast(message('panel.refreshPage'));
    }
  };

  const handleChangeTranslateMode = async (displayMode: TranslateDisplayMode) => {
    if (isPdfTranslateTab && linkedPdfUrl) {
      void chrome.runtime
        .sendMessage({
          type: 'REFPIN_PDF_TR_SET_MODE',
          pdfUrl: linkedPdfUrl,
          displayMode,
        })
        .catch(() => {});
      return;
    }

    if (hasPdfSource && linkedPdfUrl) {
      if (displayMode !== 'off') {
        await openPdfTranslateInMainTab(linkedPdfUrl, displayMode);
      }
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = tabs[0]?.id ?? activeTabId;
    if (tabId === null || tabId === undefined) return;
    try {
      const resp = (await chrome.tabs.sendMessage(tabId, {
        type: 'REFPIN_PAGE_TRANSLATE_MODE',
        displayMode,
      })) as { ok?: boolean; status?: PageTranslateStatus } | undefined;
      if (resp?.status) setPageTranslateStatus(resp.status);
    } catch {
      showToast(message('panel.refreshPage'));
    }
  };

  const handleStopTranslate = async () => {
    if (isPdfTranslateTab && linkedPdfUrl) {
      void chrome.runtime
        .sendMessage({ type: 'REFPIN_PDF_TR_STOP', pdfUrl: linkedPdfUrl })
        .catch(() => {});
      return;
    }
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = tabs[0]?.id ?? activeTabId;
    if (tabId === null || tabId === undefined) return;
    try {
      const resp = (await chrome.tabs.sendMessage(tabId, {
        type: 'REFPIN_PAGE_TRANSLATE_STOP',
      })) as { ok?: boolean; status?: PageTranslateStatus } | undefined;
      if (resp?.status) setPageTranslateStatus(resp.status);
    } catch {
      // ignore
    }
  };

  const handleQuickTranslateClick = () => {
    if (isPdfTranslateTab) {
      void handleChangeTranslateMode('off');
      return;
    }
    if (hasPdfSource && linkedPdfUrl) {
      void openPdfTranslateInMainTab(linkedPdfUrl, 'translated');
      return;
    }
    if (pageTranslateStatus.running) {
      void handleStopTranslate();
    } else if (pageTranslateStatus.displayMode !== 'off') {
      void handleChangeTranslateMode('off');
    } else {
      void handleStartTranslate('translated');
    }
  };

  // ---- 筛选逻辑 ----
  const query = searchQuery.trim().toLowerCase();

  const filteredAssets = useMemo(() => {
    if (assetFilter === 'reference') return [];
    return assets.filter((asset) => {
      if (assetFilter !== 'all' && asset.kind !== assetFilter) return false;
      if (!query) return true;
      return (
        asset.label.toLowerCase().includes(query) ||
        asset.caption.toLowerCase().includes(query) ||
        (asset.textPreview?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [assets, assetFilter, query]);

  const filteredRefs = useMemo(() => {
    if (assetFilter !== 'all' && assetFilter !== 'reference') return [];
    return references.filter((ref) => {
      if (!query) return true;
      return (
        String(ref.index) === query ||
        `[${ref.index}]`.includes(query) ||
        ref.title.toLowerCase().includes(query) ||
        ref.rawText.toLowerCase().includes(query)
      );
    });
  }, [references, assetFilter, query]);

  function launchReader(page?: number) {
    const file = localFile.current;
    if (file) {
      // The copy stays available while the new tab reads it, including after tab activation.
      const url = URL.createObjectURL(file);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      void openFullReader(url, file.name, page);
    } else void openFullReader(linkedPdfUrl, docTitle, page);
  }

  function jump(page?: number | null, anchor?: string) {
    if (anchor) handleLocateOnPage(anchor);
    else if (page) launchReader(page);
  }

  function backlinks(key: string) {
    return <BacklinkStrip backlinks={index.backlinksMap[key]} onJumpToBacklink={(page, _rect, anchor) => jump(page, anchor)} />;
  }

  const referencesMap = useMemo(() => Object.fromEntries(references.map(ref => [ref.key, ref])), [references]);
  async function exportNotes(mode: 'copy' | 'zip') {
    if (exportMenu.current) exportMenu.current.open = false;
    if (exportJob.current) return;
    const job = new AbortController();
    exportJob.current = job;
    setExporting(true);
    const doc = pdfDocRef.current;
    const notes: StudyNotes = {
      fileName: docTitle, numPages: doc?.numPages ?? 0, currentPage: 0,
      backlinksMap: index.backlinksMap, glossaryMap: index.glossaryMap,
      tableRows: Object.fromEntries(pinnedItems.filter(item => item.tableHtml).map(item => {
        const table = document.createElement('template');
        table.innerHTML = item.tableHtml!;
        return [item.id, Array.from(table.content.querySelectorAll('tr'), row =>
          Array.from(row.cells, cell => cell.textContent ?? ''))];
      })),
      pinnedItems: pinnedItems.map(item => {
        const ref = item.reference ?? referencesMap[item.id];
        return { ...item, title: pinTitle(item), automaticTitle: false, kind: item.kind === 'glossary' ? 'snip' : item.kind,
          pageNumber: item.pageNumber ?? 0, createdAt: item.pinnedAt,
          subtitle: [item.subtitle, item.textPreview !== item.subtitle && item.textPreview].filter(Boolean).join(' — '),
          reference: ref && { ...ref, pageNumber: ref.pageNumber ?? 0 } };
      }),
    };
    try {
      if (mode === 'copy') {
        await navigator.clipboard.writeText(buildStudyNotesMarkdown(notes));
        if (!job.signal.aborted) showToast(message('notes.copied'));
      } else {
        const missing = await exportStudyPackZip(notes, doc, job.signal);
        showToast(missing ? message('notes.partial', { count: missing }) : message('notes.saved'));
      }
    } catch {
      if (!job.signal.aborted) showToast(message(mode === 'copy' ? 'notes.copyFailed' : 'notes.failed'));
    } finally {
      exportJob.current = null;
      setExporting(false);
    }
  }

  const visibleTerms = terms.filter(entry => [entry.term, entry.expansion, entry.contextSentence].join(' ').toLowerCase().includes(termQuery.trim().toLowerCase()));
  const totalAssetsCount = assets.length + references.length;

  return (
    <div className="flex h-screen flex-col bg-paper-bg text-paper-ink">
      {/* 顶栏 */}
      <header className="relative z-20 shrink-0 border-b border-paper-border bg-paper-card px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-paper-ink text-[11px] font-bold text-paper-card">
              R
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-paper-border bg-paper-gold" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold tracking-tight text-paper-ink">
                  RefPin
                </span>
                {siteLabel && (
                  <span className="truncate rounded border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 text-[9.5px] font-medium text-paper-goldtext">
                    {siteLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <LanguageToggle />
            <button
              type="button"
              onClick={handleQuickTranslateClick}
              className={clsx(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition',
                pageTranslateStatus.active || isPdfTranslateTab
                  ? 'bg-paper-ink text-paper-card'
                  : 'border border-paper-border bg-paper-card text-paper-ink hover:border-paper-gold',
              )}
              title={t('translate.pageHint')}
            >
              <Languages className="h-3 w-3" />
              {t('translate.action')}
            </button>
            <button
              type="button"
              onClick={() => void handleStartSnip()}
              className="inline-flex items-center gap-1 rounded-lg bg-paper-gold px-2 py-1 text-[11px] font-medium text-paper-card shadow-sm transition hover:opacity-90"
              title={t('snip.free')}
            >
              <Scissors className="h-3 w-3" />
              {t('snip.action')}
            </button>
            <button
              type="button"
              onClick={() => setShowTranslateSettings((v) => !v)}
              className={clsx(
                'rounded-lg border p-1.5 transition',
                showTranslateSettings
                  ? 'border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
                  : 'border-paper-border bg-paper-card text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
              )}
              title={t('translate.settings')}
              aria-label={t('translate.settings')}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                void chrome.tabs
                  .query({ active: true, currentWindow: true })
                  .then((tabs) => void syncWithTab(tabs[0], true));
              }}
              className="rounded-lg border border-paper-border bg-paper-card p-1.5 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
              title={t('panel.rescan')}
              aria-label={t('panel.rescan')}
            >
              <RefreshCw className={clsx('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => launchReader()}
            className="inline-flex items-center gap-1 rounded-md bg-paper-ink px-2 py-1 text-xs font-medium text-paper-card">
            <BookOpen size={13} />{t('panel.fullReader')}
          </button>
          <ThemeSwitcher />
          <button type="button" title={t('palette.title')} aria-label={t('palette.title')} onClick={() => setPaletteOpen(true)}
            className="rounded-md border border-paper-border px-1.5 py-1 font-mono text-[11px]">⌘K</button>
          <details ref={exportMenu} className="relative ml-auto text-[11px]">
            <summary className="cursor-pointer rounded-md border border-paper-border px-2 py-1">{t('panel.export')}</summary>
            <div className="absolute right-0 z-20 mt-1 grid w-max gap-1 rounded-md border border-paper-border bg-paper-card p-1 shadow-float">
              {(['copy', 'zip'] as const).map(mode => <button key={mode} disabled={exporting || !docKey} type="button"
                className="rounded px-2 py-1.5 text-left hover:bg-paper-bg disabled:opacity-50"
                onClick={() => void exportNotes(mode)}>{t(mode === 'copy' ? 'notes.copy' : 'notes.zip')}</button>)}
            </div>
          </details>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-paper-muted" title={docTitle}>
            {docTitle}
          </p>
          {(sourceMode === 'dom' || sourceMode === 'idle') && linkedPdfUrl && !isLoading && (
            <button
              type="button"
              onClick={() => {
                const requestId = ++syncRequestRef.current;
                void fetchAndParsePdfUrl(linkedPdfUrl, docTitle, requestId);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-paper-border bg-paper-card px-1.5 py-0.5 text-[10px] text-paper-muted transition hover:border-paper-gold hover:text-paper-ink"
            >
              <FileSearch className="h-3 w-3" />
              {t('panel.extractPdf')}
            </button>
          )}
        </div>

        {isLoading && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-paper-goldsoft">
            <div
              className="h-full bg-paper-gold transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </header>

      {/* 原页面翻译快捷控制条（仅在开启翻译时出现） */}
      {(pageTranslateStatus.active || isPdfTranslateTab || pageTranslateStatus.running) && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-paper-border bg-paper-goldbg/60 px-3 py-1.5">
          <div className="flex rounded-md bg-paper-card p-0.5 text-[10.5px] shadow-sm">
            {(
              [
                { id: 'translated', label: t('translate.only') },
                { id: 'bilingual', label: t('translate.bilingual') },
                { id: 'off', label: t('translate.original') },
              ] as Array<{ id: TranslateDisplayMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => void handleChangeTranslateMode(opt.id)}
                className={clsx(
                  'rounded px-2 py-0.5 font-medium transition',
                  pageTranslateStatus.displayMode === opt.id
                    ? 'bg-paper-ink text-paper-card'
                    : 'text-paper-muted hover:text-paper-ink',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {pageTranslateStatus.total > 0 && (
            <span className="ml-auto font-mono text-[10px] text-paper-goldtext">
              {pageTranslateStatus.done}/{pageTranslateStatus.total}
            </span>
          )}

          {pageTranslateStatus.running && (
            <button
              type="button"
              onClick={() => void handleStopTranslate()}
              className="rounded border border-paper-goldborder bg-paper-card p-1 text-paper-ink transition hover:bg-paper-bg"
              title={t('translate.stop')}
            >
              <Square className="h-2.5 w-2.5 fill-current" />
            </button>
          )}
        </div>
      )}

      {/* 极简翻译引擎设置抽屉 */}
      {showTranslateSettings && (
        <TranslateSettingsBar
          config={translateConfig}
          onChange={handleUpdateTranslateConfig}
          onClose={() => setShowTranslateSettings(false)}
        />
      )}

      <nav className="grid shrink-0 grid-cols-4 gap-0.5 border-b border-paper-border bg-paper-card px-2 py-2">
        {([
          ['pins', t('panel.pins'), pinnedItems.length], ['assets', t('panel.assets'), totalAssetsCount],
          ['outline', t('outline.title'), headings.length], ['glossary', t('panel.glossary'), terms.length],
        ] as const).map(([tab, label, count]) => <button key={tab} type="button" aria-pressed={mainTab === tab}
          onClick={() => setMainTab(tab)} className="flex flex-wrap items-center justify-center gap-1 rounded-md py-1.5 text-[11px] text-paper-muted aria-pressed:bg-paper-goldbg aria-pressed:text-paper-goldtext">
          {label}<span className="rounded-full bg-paper-bg px-1 font-mono text-[10px]">{count}</span>
        </button>)}
      </nav>

      {/* 错误提示 */}
      {(errorMessage || pageTranslateStatus.error) && (
        <div className="shrink-0 border-b border-paper-goldborder bg-paper-goldbg px-3 py-2 text-[11px] leading-relaxed text-paper-ink">
          {formatMessage(errorMessage || pageTranslateStatus.error)}
        </div>
      )}

      {/* 主内容区 */}
      <div
        className="min-h-0 flex-1 overflow-y-auto p-3"
        onScroll={() => {
          if (zoomOverlay || pageZoomActiveId) dismissZoomImmediately();
        }}
      >
        {isLoading && totalAssetsCount === 0 && mainTab === 'assets' ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-paper-goldborder bg-paper-goldbg text-paper-gold">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <p className="text-xs font-medium text-paper-ink">
              {t(statusMessage || 'panel.busy')}
            </p>
            <p className="font-mono text-[11px] text-paper-muted">{progress}%</p>
          </div>
        ) : mainTab === 'outline' ? (
          index.outline.length ? <ul>{index.outline.map(item => <OutlineBranch key={item.id} item={item}
            onJump={heading => jump(heading.pageNumber, heading.domAnchorId)} />)}</ul>
            : <p className="py-6 text-center text-xs text-paper-muted">{t('panel.outlineEmpty')}</p>
        ) : mainTab === 'glossary' ? (
          <section className="space-y-2">
            <input type="search" value={termQuery} onChange={e => setTermQuery(e.target.value)}
              aria-label={t('panel.glossarySearch')} placeholder={t('panel.glossarySearch')}
              className="w-full rounded-lg border border-paper-border bg-paper-card px-3 py-2 text-xs" />
            {visibleTerms.length === 0 && <p className="py-6 text-center text-xs text-paper-muted">{t('panel.glossaryEmpty')}</p>}
            {visibleTerms.map(entry => <article key={entry.term} className="space-y-1 rounded-lg border border-paper-border bg-paper-card p-2.5 text-xs">
              <h3 className="font-semibold">{entry.term} · {entry.expansion}</h3>
              <p className="text-paper-muted">{entry.contextSentence}</p>
              <button className="text-paper-goldtext" onClick={() => jump(entry.definedPage, entry.domAnchorId)}>
                {entry.domAnchorId ? t('glossary.jump') : t('glossary.definedOn', { page: entry.definedPage })} ↗
              </button>
            </article>)}
          </section>
        ) : mainTab === 'pins' ? (
          /* ---- 对照钉板 ---- */
          pinnedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-paper-border bg-paper-card px-5 py-10 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-goldbg text-paper-gold">
                <Pin className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-xs font-medium text-paper-ink">
                {t('panel.noPins')}
              </p>
              <div className="mt-3.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMainTab('assets')}
                  className="rounded-lg border border-paper-border bg-paper-bg px-3 py-1.5 text-[11px] font-medium text-paper-ink transition hover:border-paper-gold"
                >
                  {t('panel.fromAssets')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartSnip()}
                  className="inline-flex items-center gap-1 rounded-lg bg-paper-gold px-3 py-1.5 text-[11px] font-medium text-paper-card transition hover:opacity-90"
                >
                  <Scissors className="h-3 w-3" />
                  {t('snip.action')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-0.5 text-[11px] text-paper-muted">
                <span>{t('panel.pinCount', { count: pinnedItems.length })}</span>
                <button
                  type="button"
                  onClick={() => updateCurrentPins(() => [])}
                  className="inline-flex items-center gap-1 text-paper-muted transition hover:text-paper-gold"
                >
                  <Trash2 className="h-3 w-3" />
                  {t('common.clear')}
                </button>
              </div>

              {pinnedItems.map((item, idx) => {
                const isLifted =
                  zoomOverlay?.id === item.id && zoomOverlay.phase !== 'leaving';
                const isPageZoomed = pageZoomActiveId === item.id;
                return (
                <article
                  key={item.id}
                  onMouseEnter={(event) => handlePinHoverStart(item, event.currentTarget)}
                  onMouseLeave={() => handlePinHoverEnd(item.id)}
                  className={clsx(
                    'overflow-hidden rounded-xl border bg-paper-card shadow-paper will-change-transform transition-[transform,box-shadow,border-color,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-paper-goldborder hover:shadow-float',
                    highlightedPinId === item.id || isPageZoomed
                      ? 'border-paper-gold ring-2 ring-paper-goldsoft'
                      : 'border-paper-border',
                    isLifted && 'scale-[0.985] opacity-35',
                  )}
                >
                  <div className="flex items-center gap-1.5 border-b border-paper-border bg-paper-bg px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateCurrentPins((list) =>
                          list.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, collapsed: !entry.collapsed }
                              : entry,
                          ),
                        )
                      }
                      className="text-paper-muted hover:text-paper-ink"
                      aria-label={t('pin.toggle')}
                    >
                      {item.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>

                    {editingPinId === item.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                          const trimmed = editingTitle.trim();
                          if (trimmed) {
                            updateCurrentPins((list) =>
                              list.map((entry) =>
                                entry.id === item.id ? { ...entry, title: trimmed, automaticTitle: false } : entry,
                              ),
                            );
                          }
                          setEditingPinId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingPinId(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-paper-gold bg-paper-card px-1.5 py-0.5 text-xs font-medium text-paper-ink outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={() => {
                          setEditingPinId(item.id);
                          setEditingTitle(pinTitle(item));
                        }}
                        className="min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-paper-ink"
                        title={t('panel.renameHint')}
                      >
                        {pinTitle(item)}
                      </span>
                    )}

                    <span className="shrink-0 rounded bg-paper-goldbg px-1 text-[9px] text-paper-goldtext">{t(`kind.${item.kind}`)}</span>
                    {item.pageNumber && (
                      <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 font-mono text-[10px] text-paper-goldtext">
                        {t('reader.page', { page: item.pageNumber })}
                      </span>
                    )}

                    <div className="flex shrink-0 items-center gap-0.5">
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => handleMovePin(item.id, -1)}
                          className="rounded p-1 text-paper-muted hover:bg-paper-bg hover:text-paper-ink"
                          title={t('pin.moveUp')}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                      )}
                      {idx < pinnedItems.length - 1 && (
                        <button
                          type="button"
                          onClick={() => handleMovePin(item.id, 1)}
                          className="rounded p-1 text-paper-muted hover:bg-paper-bg hover:text-paper-ink"
                          title={t('pin.moveDown')}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          updateCurrentPins((list) =>
                            list.filter((entry) => entry.id !== item.id),
                          )
                        }
                        className="rounded p-1 text-paper-muted hover:bg-paper-goldbg hover:text-paper-gold"
                        title={t('pin.unpin')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {!item.collapsed && (
                    <div className="p-2.5">
                      {item.imageUrl && (
                        <div
                          onClick={() =>
                            openLightbox(
                              pinTitle(item),
                              item.subtitle || '',
                              item.imageUrl,
                              item.pageNumber,
                            )
                          }
                          className="group relative cursor-zoom-in overflow-hidden rounded-lg border border-paper-border bg-paper-bg p-1.5"
                        >
                          <CardImage
                            src={item.imageUrl}
                            alt={pinTitle(item)}
                            className="mx-auto max-h-56 w-full object-contain"
                          />
                          <span className="absolute right-2 top-2 rounded-md bg-paper-ink/75 p-1 text-paper-card opacity-0 transition group-hover:opacity-100">
                            <Maximize2 className="h-3 w-3" />
                          </span>
                        </div>
                      )}

                      {!item.imageUrl && item.tableHtml && (
                        <div
                          className="max-h-48 overflow-auto rounded-lg border border-paper-border bg-paper-card text-[10.5px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-paper-border [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-paper-border [&_th]:bg-paper-bg [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold"
                          dangerouslySetInnerHTML={{ __html: item.tableHtml }}
                        />
                      )}

                      {!item.imageUrl && !item.tableHtml && item.textPreview && (
                        <div className="rounded-lg border border-paper-border bg-paper-bg px-2.5 py-2 font-mono text-[11px] leading-relaxed text-paper-ink">
                          {item.textPreview}
                        </div>
                      )}

                      {item.reference ? (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium leading-snug text-paper-ink">
                            {item.reference.title}
                          </p>
                          {(item.reference.authors || item.reference.year) && (
                            <p className="text-[11px] text-paper-muted">
                              {[item.reference.authors, item.reference.year]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          <p className="rounded-lg bg-paper-bg p-2 text-[11px] leading-relaxed text-paper-ink">
                            {item.reference.rawText}
                          </p>
                        </div>
                      ) : (
                        item.subtitle && (
                          <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-paper-muted">
                            {item.subtitle}
                          </p>
                        )
                      )}

                      {backlinks(item.id)}
                      {/* 卡片底部操作条 */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-paper-border pt-2">
                        {(item.domAnchorId || item.pageNumber) && (
                          <button
                            type="button"
                            onClick={() => jump(item.pageNumber, item.domAnchorId)}
                            className="inline-flex items-center gap-1 rounded-md border border-paper-border bg-paper-card px-2 py-1 text-[10.5px] text-paper-ink transition hover:bg-paper-bg"
                          >
                            <Crosshair className="h-3 w-3" />
                            {t('pin.locate')}
                          </button>
                        )}

                        {item.source === 'pdf' && item.cropRect && pdfDocRef.current && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleExpandPdfCrop(item, 'up')}
                              className="rounded-md border border-paper-border bg-paper-card px-1.5 py-1 text-[10.5px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                              title={t('crop.upHint')}
                            >
                              {t('crop.upArrow')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExpandPdfCrop(item, 'down')}
                              className="rounded-md border border-paper-border bg-paper-card px-1.5 py-1 text-[10.5px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                              title={t('crop.downHint')}
                            >
                              {t('crop.downArrow')}
                            </button>
                            {item.originalImageUrl &&
                              item.imageUrl !== item.originalImageUrl && (
                                <button
                                  type="button"
                                  onClick={() => handleResetPdfCrop(item)}
                                  className="inline-flex items-center gap-0.5 rounded-md border border-paper-border bg-paper-card px-1.5 py-1 text-[10.5px] text-paper-muted transition hover:text-paper-ink"
                                >
                                  <RotateCcw className="h-2.5 w-2.5" />
                                  {t('crop.reset')}
                                </button>
                              )}
                          </>
                        )}

                        {item.reference && (
                          <>
                            <PanelReferenceDetails reference={item.reference} />
                            <a
                              href={
                                item.reference.href ||
                                `https://scholar.google.com/scholar?q=${encodeURIComponent(
                                  item.reference.title || item.reference.rawText,
                                )}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto inline-flex items-center gap-1 rounded-md border border-paper-goldborder bg-paper-goldbg px-2 py-1 text-[10.5px] font-medium text-paper-goldtext transition hover:bg-paper-goldsoft"
                            >
                              {t('reference.source')}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </article>
                );
              })}
            </div>
          )
        ) : totalAssetsCount === 0 ? (
          /* ---- 未检测到论文内容时的空态（支持手动扫描 + 框选 + 拖入本地 PDF） ---- */
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-paper-border bg-paper-card p-4 text-center shadow-paper">
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-paper-goldbg text-paper-gold">
                <FileSearch className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-xs font-semibold text-paper-ink">
                {t('panel.noAssets')}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void chrome.tabs
                      .query({ active: true, currentWindow: true })
                      .then((tabs) => void syncWithTab(tabs[0], true));
                  }}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-paper-ink px-3 py-2 text-xs font-medium text-paper-card transition hover:opacity-90"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('panel.scan')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartSnip()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-paper-border bg-paper-bg px-3 py-2 text-xs font-medium text-paper-ink transition hover:border-paper-gold"
                >
                  <Scissors className="h-3.5 w-3.5 text-paper-gold" />
                  {t('panel.capture')}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleLocalFileFallback(file);
              }}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-paper-border bg-paper-card px-4 py-4 text-center transition hover:border-paper-gold"
            >
              <Upload className="h-4 w-4 text-paper-muted" />
              <span className="text-[11px] font-medium text-paper-ink">
                {t('panel.drop')}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLocalFileFallback(file);
                e.target.value = '';
              }}
            />
          </div>
        ) : (
          /* ---- 全篇资产墙 ---- */
          <div className="flex flex-col gap-2.5">
            {/* 搜索与分类筛选 */}
            <div className="flex items-center gap-1.5 rounded-xl border border-paper-border bg-paper-card px-2.5 py-1.5 focus-within:border-paper-gold">
              <Search className="h-3.5 w-3.5 shrink-0 text-paper-muted" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('panel.search')}
                className="min-w-0 flex-1 bg-transparent text-xs text-paper-ink outline-none placeholder:text-paper-muted"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-paper-muted hover:text-paper-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              {(
                [
                  { id: 'all', label: t('filter.allCount', { count: totalAssetsCount }) },
                  {
                    id: 'figure',
                    label: t('filter.figureCount', { count: assets.filter((a) => a.kind === 'figure').length }),
                  },
                  {
                    id: 'table',
                    label: t('filter.tableCount', { count: assets.filter((a) => a.kind === 'table').length }),
                  },
                  {
                    id: 'equation',
                    label: t('filter.equationCount', { count: assets.filter((a) => a.kind === 'equation').length }),
                  },
                  ...(['algorithm', 'theorem', 'section'] as const).map(kind => ({
                    id: kind, label: t(`kind.${kind}`) + ' ' + assets.filter(asset => asset.kind === kind).length,
                  })),
                  { id: 'reference', label: t('filter.referenceCount', { count: references.length }) },
                ] as Array<{ id: AssetFilter; label: string }>
              ).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setAssetFilter(chip.id)}
                  className={clsx(
                    'rounded-full px-2.5 py-1 text-[10.5px] font-medium transition',
                    assetFilter === chip.id
                      ? 'bg-paper-ink text-paper-card'
                      : 'border border-paper-border bg-paper-card text-paper-muted hover:text-paper-ink',
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* 图/表/公式卡片列表 */}
            {filteredAssets.map((asset) => {
              const isPinned = pinnedIdSet.has(asset.key);
              return (
                <div
                  key={asset.key}
                  className="overflow-hidden rounded-xl border border-paper-border bg-paper-card p-2.5 shadow-paper transition hover:border-paper-goldborder"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 text-[10.5px] font-semibold text-paper-goldtext">
                      {asset.kind === 'table' ? (
                        <Table2 className="h-3 w-3" />
                      ) : (
                        <ImageIcon className="h-3 w-3" />
                      )}
                      {asset.label}
                    </span>
                    <div className="flex items-center gap-1">
                      {asset.pageNumber && (
                        <span className="font-mono text-[10px] text-paper-muted">
                          {t('reader.page', { page: asset.pageNumber })}
                        </span>
                      )}
                      {(asset.domAnchorId || asset.pageNumber) && (
                        <button
                          type="button"
                          onClick={() => jump(asset.pageNumber, asset.domAnchorId)}
                          className="rounded-md border border-paper-border px-1.5 py-0.5 text-[10.5px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                        >
                          {t('common.locate')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePinAsset(asset)}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium transition',
                          isPinned
                            ? 'border border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
                            : 'bg-paper-gold text-paper-card hover:opacity-90',
                        )}
                      >
                        <Pin className="h-2.5 w-2.5" />
                        {isPinned ? t('pin.pinned') : t('common.pin')}
                      </button>
                    </div>
                  </div>

                  {asset.imageUrl && (
                    <div
                      onClick={() =>
                        openLightbox(
                          asset.label,
                          asset.caption,
                          asset.imageUrl,
                          asset.pageNumber,
                        )
                      }
                      className="relative mt-2 cursor-zoom-in overflow-hidden rounded-lg border border-paper-border bg-paper-bg p-1"
                    >
                      <CardImage
                        src={asset.imageUrl}
                        alt={asset.label}
                        className="mx-auto max-h-40 w-full object-contain"
                      />
                    </div>
                  )}

                  {!asset.imageUrl && asset.tableHtml && (
                    <div
                      className="mt-2 max-h-36 overflow-auto rounded-lg border border-paper-border bg-paper-card text-[10px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-paper-border [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-paper-border [&_th]:bg-paper-bg [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:font-semibold"
                      dangerouslySetInnerHTML={{ __html: asset.tableHtml }}
                    />
                  )}

                  {!asset.imageUrl && !asset.tableHtml && asset.textPreview && (
                    <div className="mt-2 rounded-lg bg-paper-bg px-2 py-1.5 font-mono text-[10.5px] text-paper-ink">
                      {asset.textPreview}
                    </div>
                  )}

                  <span className="text-[10px] text-paper-goldtext">{t(`kind.${asset.kind}`)}</span>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-paper-muted">
                    {asset.caption}
                  </p>
                  {backlinks(asset.key)}
                </div>
              );
            })}

            {/* 参考文献列表 */}
            {filteredRefs.map((ref) => {
              const isPinned = pinnedIdSet.has(ref.key);
              const scholarUrl =
                ref.href ||
                `https://scholar.google.com/scholar?q=${encodeURIComponent(
                  ref.title || ref.rawText,
                )}`;
              return (
                <div
                  key={ref.key}
                  className="rounded-xl border border-paper-border bg-paper-card p-2.5 shadow-paper"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="shrink-0 rounded bg-paper-bg px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-paper-ink">
                      [{ref.index}]
                    </span>
                    <div className="flex items-center gap-1">
                      <a
                        href={scholarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-paper-border px-1.5 py-0.5 text-[10px] text-paper-muted transition hover:text-paper-ink"
                      >
                        {t('reference.source')} ↗
                      </a>
                      {(ref.domAnchorId || ref.pageNumber) && (
                        <button
                          type="button"
                          onClick={() => jump(ref.pageNumber, ref.domAnchorId)}
                          className="rounded-md border border-paper-border px-1.5 py-0.5 text-[10px] text-paper-muted transition hover:text-paper-ink"
                        >
                          {t('common.locate')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePinReference(ref)}
                        className={clsx(
                          'inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-[10.5px] font-medium transition',
                          isPinned
                            ? 'border border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
                            : 'bg-paper-gold text-paper-card hover:opacity-90',
                        )}
                      >
                        <Pin className="h-2.5 w-2.5" />
                        {isPinned ? t('pin.pinned') : t('common.pin')}
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs font-medium leading-snug text-paper-ink">
                    {ref.title}
                  </p>
                  <PanelReferenceDetails reference={ref} />
                  {backlinks(ref.key)}
                  {(ref.authors || ref.year) && (
                    <p className="mt-0.5 text-[10.5px] text-paper-muted">
                      {[ref.authors, ref.year].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              );
            })}

            {filteredAssets.length === 0 && filteredRefs.length === 0 && (
              <p className="py-10 text-center text-xs text-paper-muted">
                {t('panel.noMatches', { query: searchQuery })}
              </p>
            )}
          </div>
        )}
      </div>

      {paletteOpen && <CompanionCommands index={index} assets={assets} references={references}
        numPages={pdfDocRef.current?.numPages ?? 0} canExport={!!docKey && !exporting}
        onJump={jump} onPinAsset={handlePinAsset} onPinReference={handlePinReference}
        onPin={item => addPinForDoc(docKey, item)} onOpenReader={() => launchReader()}
        onExport={exportNotes} onClose={() => setPaletteOpen(false)} />}

      {/* 钉板悬停自动放大浮层（原生 PDF / 侧栏内无缝降级模式） */}
      {zoomedItem &&
        zoomedOverlayStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={zoomedOverlayStyle}
            onMouseEnter={() => {
              if (zoomLeaveTimerRef.current !== null) {
                window.clearTimeout(zoomLeaveTimerRef.current);
                zoomLeaveTimerRef.current = null;
              }
              if (zoomUnmountTimerRef.current !== null) {
                window.clearTimeout(zoomUnmountTimerRef.current);
                zoomUnmountTimerRef.current = null;
              }
              setZoomOverlay((prev) => (prev ? { ...prev, phase: 'open' } : prev));
            }}
            onMouseLeave={scheduleZoomLeave}
          >
            <article className="overflow-hidden rounded-xl border border-paper-goldborder/90 bg-paper-card ring-1 ring-amber-400/25">
              <div className="flex items-center gap-1.5 border-b border-paper-border bg-paper-bg px-3 py-2">
                <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper-goldtext">
                  {t(`kind.${zoomedItem.kind}`)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-paper-ink">
                  {pinTitle(zoomedItem)}
                </span>
                {zoomedItem.pageNumber && (
                  <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 font-mono text-[10px] text-paper-goldtext">
                    {t('reader.page', { page: zoomedItem.pageNumber })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={dismissZoomImmediately}
                  className="rounded p-0.5 text-paper-muted transition hover:text-paper-ink"
                  aria-label={t('panel.closePreview')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-3">
                {zoomedItem.imageUrl && (
                  <div
                    onClick={() =>
                      openLightbox(
                        pinTitle(zoomedItem),
                        zoomedItem.subtitle || '',
                        zoomedItem.imageUrl,
                        zoomedItem.pageNumber,
                      )
                    }
                    className="group relative cursor-zoom-in overflow-hidden rounded-lg border border-paper-border bg-paper-bg p-1.5"
                  >
                    <CardImage
                      src={zoomedItem.imageUrl}
                      alt={pinTitle(zoomedItem)}
                      className="mx-auto max-h-[60vh] w-full object-contain"
                    />
                    <span className="absolute right-2 top-2 rounded-md bg-paper-ink/75 p-1 text-paper-card opacity-0 transition group-hover:opacity-100">
                      <Maximize2 className="h-3 w-3" />
                    </span>
                  </div>
                )}

                {!zoomedItem.imageUrl && zoomedItem.tableHtml && (
                  <div
                    className="max-h-[54vh] overflow-auto rounded-lg border border-paper-border bg-paper-card text-[11px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-paper-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-paper-border [&_th]:bg-paper-bg [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: zoomedItem.tableHtml }}
                  />
                )}

                {!zoomedItem.imageUrl && !zoomedItem.tableHtml && zoomedItem.textPreview && (
                  <div className="max-h-[46vh] overflow-auto rounded-lg border border-paper-border bg-paper-bg px-3 py-2.5 font-mono text-xs leading-relaxed text-paper-ink">
                    {zoomedItem.textPreview}
                  </div>
                )}

                {zoomedItem.reference ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold leading-snug text-paper-ink">
                      {zoomedItem.reference.title}
                    </p>
                    {(zoomedItem.reference.authors || zoomedItem.reference.year) && (
                      <p className="text-[11px] text-paper-muted">
                        {[zoomedItem.reference.authors, zoomedItem.reference.year]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="max-h-[34vh] overflow-y-auto rounded-lg bg-paper-bg p-2.5 text-[11px] leading-relaxed text-paper-ink">
                      {zoomedItem.reference.rawText}
                    </p>
                  </div>
                ) : (
                  zoomedItem.subtitle && (
                    <p className="mt-2 max-h-28 overflow-y-auto text-[11px] leading-relaxed text-paper-muted">
                      {zoomedItem.subtitle}
                    </p>
                  )
                )}

                {backlinks(zoomedItem.id)}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-paper-border pt-2">
                  {(zoomedItem.domAnchorId || zoomedItem.pageNumber) && (
                    <button
                      type="button"
                      onClick={() => {
                        dismissZoomImmediately();
                        jump(zoomedItem.pageNumber, zoomedItem.domAnchorId);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-paper-border bg-paper-card px-2 py-1 text-[10.5px] text-paper-ink transition hover:bg-paper-bg"
                    >
                      <Crosshair className="h-3 w-3" />
                      {t('pin.locate')}
                    </button>
                  )}

                  {zoomedItem.source === 'pdf' &&
                    zoomedItem.cropRect &&
                    pdfDocRef.current && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleExpandPdfCrop(zoomedItem, 'up')}
                          className="rounded-md border border-paper-border bg-paper-card px-2 py-1 text-[10.5px] text-paper-ink transition hover:border-paper-goldborder"
                        >
                          {t('crop.upArrow')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleExpandPdfCrop(zoomedItem, 'down')}
                          className="rounded-md border border-paper-border bg-paper-card px-2 py-1 text-[10.5px] text-paper-ink transition hover:border-paper-goldborder"
                        >
                          {t('crop.downArrow')}
                        </button>
                        {zoomedItem.originalImageUrl &&
                          zoomedItem.imageUrl !== zoomedItem.originalImageUrl && (
                            <button
                              type="button"
                              onClick={() => handleResetPdfCrop(zoomedItem)}
                              className="inline-flex items-center gap-0.5 rounded-md border border-paper-goldborder bg-paper-goldbg px-2 py-1 text-[10.5px] font-medium text-paper-goldtext"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                              {t('crop.reset')}
                            </button>
                          )}
                      </>
                    )}

                  {zoomedItem.reference && (
                    <>
                      <PanelReferenceDetails reference={zoomedItem.reference} />
                      <a
                        href={
                          zoomedItem.reference.href ||
                          `https://scholar.google.com/scholar?q=${encodeURIComponent(
                            zoomedItem.reference.title || zoomedItem.reference.rawText,
                          )}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-paper-goldborder bg-paper-goldbg px-2 py-1 text-[10.5px] font-medium text-paper-goldtext"
                      >
                        {t('reference.source')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>
            </article>
          </div>,
          document.body,
        )}

      {/* 高清放大灯箱 */}
      <LightboxModal asset={lightboxAsset} onClose={() => setLightboxAsset(null)} />

      {/* 原生 PDF 画面框选模态层 */}
      {snipScreenshot && (
        <ViewportSnipModal
          screenshotUrl={snipScreenshot}
          onCancel={() => setSnipScreenshot(null)}
          onConfirm={(croppedDataUrl) => {
            const targetKey = docKey || 'snip-default';
            const pinnedAt = Date.now();
            const item: CompanionPinItem = {
              id: `snip:${pinnedAt}`,
              kind: 'snip',
              source: 'snip',
              title: timedSnipTitle(pinnedAt),
              automaticTitle: true,
              subtitle: docTitle,
              imageUrl: croppedDataUrl,
              pinnedAt,
            };
            if (!docKey) setDocKey(targetKey);
            addPinForDoc(targetKey, item, true);
            setSnipScreenshot(null);
          }}
        />
      )}

      {/* 轻量 Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 whitespace-nowrap rounded-full bg-paper-ink px-3.5 py-1.5 text-[11px] text-paper-card shadow-float">
          {formatMessage(toast)}
        </div>
      )}
    </div>
  );
}
