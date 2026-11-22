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
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
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

type MainTab = 'pins' | 'assets';
type AssetFilter = 'all' | 'figure' | 'table' | 'equation' | 'reference';
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

function buildBibtex(ref: CompanionReference): string {
  return `@inproceedings{${ref.key},\n  title={${ref.title || ''}},\n  author={${ref.authors || ''}},\n  year={${ref.year || ''}}\n}`;
}

function hasPdfSignature(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46
    ) {
      return true;
    }
  }
  return false;
}

export function SidePanelApp() {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeWindowId, setActiveWindowId] = useState<number | undefined>(undefined);
  const [docKey, setDocKey] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('RefPin · 浮页伴读');
  const [siteLabel, setSiteLabel] = useState<string>('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('idle');
  const [linkedPdfUrl, setLinkedPdfUrl] = useState<string | null>(null);

  const [assets, setAssets] = useState<CompanionAsset[]>([]);
  const [references, setReferences] = useState<CompanionReference[]>([]);
  const [pinsByDoc, setPinsByDoc] = useState<Record<string, CompanionPinItem[]>>({});

  const [mainTab, setMainTab] = useState<MainTab>('assets');
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [highlightedPinId, setHighlightedPinId] = useState<string | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);
  const [zoomOverlay, setZoomOverlay] = useState<ZoomOverlayState | null>(null);
  const [pageZoomActiveId, setPageZoomActiveId] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<PaperAsset | null>(null);
  const [snipScreenshot, setSnipScreenshot] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const showToast = useCallback((message: string) => {
    setToast(message);
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
      showToast(existed ? '已在对照钉板中' : `已钉住 ${item.title}`);
    },
    [flashPin, showToast],
  );

  const destroyCurrentPdf = useCallback(() => {
    if (pdfDocRef.current) {
      void pdfDocRef.current.destroy().catch(() => {});
      pdfDocRef.current = null;
    }
  }, []);

  const parsePdfBuffer = useCallback(
    async (buffer: ArrayBuffer, displayName: string, requestId: number) => {
      destroyCurrentPdf();
      setSourceMode('pdf');
      setDocTitle(displayName);
      setIsLoading(true);
      setProgress(12);
      setStatusMessage('正在本地解析图表、公式与参考文献…');
      setErrorMessage(null);

      try {
        const doc = await loadPdfDocument(buffer);
        if (requestId !== syncRequestRef.current) {
          void doc.destroy().catch(() => {});
          return;
        }
        pdfDocRef.current = doc;
        const result = await parsePaper(doc, (pct) => {
          if (requestId === syncRequestRef.current) {
            setProgress(Math.max(15, pct));
          }
        });
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

        setAssets(nextAssets);
        setReferences(nextRefs);
        setProgress(100);
        setStatusMessage('');
      } catch (error) {
        if (requestId !== syncRequestRef.current) return;
        setErrorMessage(
          error instanceof Error ? error.message : 'PDF 解析失败，请确认文件完整有效',
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
      setStatusMessage('正在同步论文 PDF…');
      setErrorMessage(null);

      try {
        const res = await fetch(pdfUrl, {
          credentials: pdfUrl.startsWith('file://') ? 'omit' : 'include',
        });
        if (requestId !== syncRequestRef.current) return;

        if (!res.ok) {
          throw new Error(`无法拉取 PDF（HTTP ${res.status}），若需登录请先在左侧页面登录`);
        }

        const buffer = await res.arrayBuffer();
        if (requestId !== syncRequestRef.current) return;

        if (buffer.byteLength === 0 || !hasPdfSignature(buffer)) {
          throw new Error('目标地址未返回有效 PDF（可能需要先登录或通过验证）');
        }

        await parsePdfBuffer(buffer, displayName, requestId);
      } catch (error) {
        if (requestId !== syncRequestRef.current) return;
        setIsLoading(false);
        let msg = error instanceof Error ? error.message : '拉取论文 PDF 失败';
        if (pdfUrl.startsWith('file://') && /failed to fetch/i.test(msg)) {
          msg =
            '读取本地 file:// PDF 需在 chrome://extensions 中开启「允许访问文件网址」，或直接拖入下方解析';
        }
        setErrorMessage(msg);
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
      const onPdfTrPage = tabUrl.startsWith(pdfTrPrefix);
      setIsPdfTranslateTab(onPdfTrPage);

      let effectiveUrl = tabUrl;
      if (onPdfTrPage) {
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
        setDocTitle('RefPin · 浮页伴读');
        setSiteLabel('');
        setSourceMode('idle');
        setLinkedPdfUrl(null);
        setAssets([]);
        setReferences([]);
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
        onPdfTrPage
          ? new URL(tabUrl).searchParams.get('title') || urlInfo.suggestedTitle
          : tab?.title || urlInfo.suggestedTitle,
      );

      const sameDocAsLoaded = docKeyRef.current === nextDocKey;
      setDocKey(nextDocKey);
      setDocTitle(fallbackTitle);
      setSiteLabel(urlInfo.siteLabel);
      setLinkedPdfUrl(urlInfo.pdfUrl ?? (onPdfTrPage ? effectiveUrl : null));
      setErrorMessage(null);

      // 情况 1：当前标签页是原生 PDF，或正处于主标签页的沉浸式 PDF 译文视图
      if (onPdfTrPage || (urlInfo.kind === 'pdf' && urlInfo.pdfUrl)) {
        const targetPdf = onPdfTrPage ? effectiveUrl : urlInfo.pdfUrl!;
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
        if (sameDocAsLoaded && pdfDocRef.current && !forceDomScan) {
          setSourceMode('pdf');
          setIsLoading(false);
          return;
        }

        setAssets([]);
        setReferences([]);
        await fetchAndParsePdfUrl(targetPdf, fallbackTitle, requestId);
        return;
      }

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

      const effectivePdfUrl = domPayload?.pdfUrl || urlInfo.pdfUrl || null;
      setLinkedPdfUrl(effectivePdfUrl);

      // 若是学术摘要页（如 arXiv /abs/ 或 OpenReview /forum），或 DOM 没抽到图表但页面声明了 PDF 地址 -> 直接在侧边栏解析 PDF
      if (
        (urlInfo.kind === 'academic-abstract' ||
          (domPayload &&
            domPayload.isAcademicPage &&
            domPayload.assets.length === 0 &&
            domPayload.references.length === 0)) &&
        effectivePdfUrl
      ) {
        await fetchAndParsePdfUrl(
          effectivePdfUrl,
          domPayload?.title || fallbackTitle,
          requestId,
        );
        return;
      }

      if (
        domPayload &&
        (domPayload.isAcademicPage ||
          forceDomScan ||
          domPayload.assets.length > 0 ||
          domPayload.references.length > 0)
      ) {
        setSourceMode('dom');
        setDocTitle(domPayload.title || fallbackTitle);
        setSiteLabel(domPayload.siteLabel || urlInfo.siteLabel);
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
    const loadActive = () => {
      void chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
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

    const onActivated = (activeInfo: { tabId: number }) => {
      void chrome.tabs.get(activeInfo.tabId).then((tab) => {
        void syncWithTab(tab, false);
      });
    };

    const onUpdated = (
      tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active) return;
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
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
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
      showToast(direction === 'up' ? '已向上扩展裁切' : '已向下扩展裁切');
    } catch {
      showToast('裁切微调失败');
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
    showToast('已还原初始裁切');
  };

  const handleLocateOnPage = (anchorId?: string) => {
    if (!anchorId || activeTabId === null) return;
    void chrome.tabs
      .sendMessage(activeTabId, {
        type: 'REFPIN_SCROLL_TO_ANCHOR',
        anchorId,
      })
      .catch(() => {
        showToast('无法定位到左侧页面位置');
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
          showToast('请在左侧论文页面拖拽框选区域');
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
      const reason = captureResp?.error ? `（${captureResp.error}）` : '';
      showToast(`无法截取当前画面${reason}`);
      return;
    }
    setSnipScreenshot(captureResp.dataUrl);
  };

  const handleLocalFileFallback = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('请选择 .pdf 文件');
      return;
    }
    const requestId = ++syncRequestRef.current;
    const localKey = `local:${file.name}:${file.size}`;
    setDocKey(localKey);
    setSiteLabel('本地 PDF');
    const buffer = await file.arrayBuffer();
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

  const handleCopyBibtex = async (ref: CompanionReference) => {
    try {
      await navigator.clipboard.writeText(buildBibtex(ref));
      setCopiedRefId(ref.key);
      showToast('已复制 BibTeX');
      window.setTimeout(() => {
        setCopiedRefId((curr) => (curr === ref.key ? null : curr));
      }, 1600);
    } catch {
      showToast('复制失败');
    }
  };

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
    if (sourceMode === 'pdf' && linkedPdfUrl) {
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
      showToast('请刷新当前网页后再试');
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

    if (sourceMode === 'pdf' && linkedPdfUrl) {
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
      showToast('请刷新当前网页后再试');
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
    if (sourceMode === 'pdf' && linkedPdfUrl) {
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

  const totalAssetsCount = assets.length + references.length;

  return (
    <div className="flex h-screen flex-col bg-paper-bg text-paper-ink">
      {/* 顶栏 */}
      <header className="relative shrink-0 border-b border-paper-border bg-white/90 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-paper-ink text-[11px] font-bold text-white">
              R
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-paper-gold" />
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
            <button
              type="button"
              onClick={handleQuickTranslateClick}
              className={clsx(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition',
                pageTranslateStatus.active || isPdfTranslateTab
                  ? 'bg-paper-ink text-white'
                  : 'border border-paper-border bg-white text-paper-ink hover:border-amber-300',
              )}
              title="整篇翻译（直接显示在原页面，默认仅译文）"
            >
              <Languages className="h-3 w-3" />
              译
            </button>
            <button
              type="button"
              onClick={() => void handleStartSnip()}
              className="inline-flex items-center gap-1 rounded-lg bg-paper-gold px-2 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-amber-700"
              title="自由框选"
            >
              <Scissors className="h-3 w-3" />
              框选
            </button>
            <button
              type="button"
              onClick={() => setShowTranslateSettings((v) => !v)}
              className={clsx(
                'rounded-lg border p-1.5 transition',
                showTranslateSettings
                  ? 'border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
                  : 'border-paper-border bg-white text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
              )}
              title="翻译设置"
              aria-label="翻译设置"
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
              className="rounded-lg border border-paper-border bg-white p-1.5 text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
              title="重新扫描"
              aria-label="重新扫描"
            >
              <RefreshCw className={clsx('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-paper-muted" title={docTitle}>
            {docTitle}
          </p>
          {sourceMode === 'dom' && linkedPdfUrl && !isLoading && (
            <button
              type="button"
              onClick={() => {
                const requestId = ++syncRequestRef.current;
                void fetchAndParsePdfUrl(linkedPdfUrl, docTitle, requestId);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-paper-border bg-white px-1.5 py-0.5 text-[10px] text-paper-muted transition hover:border-amber-300 hover:text-paper-ink"
            >
              <FileSearch className="h-3 w-3" />
              PDF 提取
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
          <div className="flex rounded-md bg-white/90 p-0.5 text-[10.5px] shadow-sm">
            {(
              [
                { id: 'translated', label: '仅译文' },
                { id: 'bilingual', label: '双语' },
                { id: 'off', label: '原文' },
              ] as Array<{ id: TranslateDisplayMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => void handleChangeTranslateMode(opt.id)}
                className={clsx(
                  'rounded px-2 py-0.5 font-medium transition',
                  pageTranslateStatus.displayMode === opt.id
                    ? 'bg-paper-ink text-white'
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
              className="rounded border border-paper-goldborder bg-white p-1 text-paper-ink transition hover:bg-paper-bg"
              title="停止翻译"
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

      {/* 双分页签：钉板 / 资产 */}
      <div className="shrink-0 border-b border-paper-border bg-white px-3 py-2">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper-bg p-1">
          <button
            type="button"
            onClick={() => setMainTab('pins')}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition',
              mainTab === 'pins'
                ? 'bg-white text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            <Pin className="h-3.5 w-3.5 text-paper-gold" />
            对照钉板
            <span className="rounded-full bg-paper-goldbg px-1.5 font-mono text-[10px] text-paper-goldtext">
              {pinnedItems.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMainTab('assets')}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition',
              mainTab === 'assets'
                ? 'bg-white text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            全篇资产
            <span className="rounded-full bg-stone-200/80 px-1.5 font-mono text-[10px] text-paper-muted">
              {totalAssetsCount}
            </span>
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {(errorMessage || pageTranslateStatus.error) && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700">
          {errorMessage || pageTranslateStatus.error}
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
              {statusMessage || '正在解析论文…'}
            </p>
            <p className="font-mono text-[11px] text-paper-muted">{progress}%</p>
          </div>
        ) : mainTab === 'pins' ? (
          /* ---- 对照钉板 ---- */
          pinnedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-paper-border bg-white px-5 py-10 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-goldbg text-paper-gold">
                <Pin className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-xs font-medium text-paper-ink">
                暂无钉住内容
              </p>
              <div className="mt-3.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMainTab('assets')}
                  className="rounded-lg border border-paper-border bg-paper-bg px-3 py-1.5 text-[11px] font-medium text-paper-ink transition hover:border-amber-300"
                >
                  从资产钉入
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartSnip()}
                  className="inline-flex items-center gap-1 rounded-lg bg-paper-gold px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-amber-700"
                >
                  <Scissors className="h-3 w-3" />
                  框选
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-0.5 text-[11px] text-paper-muted">
                <span>共 {pinnedItems.length} 项</span>
                <button
                  type="button"
                  onClick={() => updateCurrentPins(() => [])}
                  className="inline-flex items-center gap-1 text-paper-muted transition hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                  清空
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
                    'overflow-hidden rounded-xl border bg-white shadow-paper will-change-transform transition-[transform,box-shadow,border-color,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-paper-goldborder hover:shadow-float',
                    highlightedPinId === item.id || isPageZoomed
                      ? 'border-paper-gold ring-2 ring-paper-goldsoft'
                      : 'border-paper-border',
                    isLifted && 'scale-[0.985] opacity-35',
                  )}
                >
                  <div className="flex items-center gap-1.5 border-b border-stone-100 bg-stone-50/70 px-2.5 py-2">
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
                      aria-label="折叠或展开"
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
                                entry.id === item.id ? { ...entry, title: trimmed } : entry,
                              ),
                            );
                          }
                          setEditingPinId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingPinId(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-xs font-medium text-paper-ink outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={() => {
                          setEditingPinId(item.id);
                          setEditingTitle(item.title);
                        }}
                        className="min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-paper-ink"
                        title="双击重命名"
                      >
                        {item.title}
                      </span>
                    )}

                    {item.pageNumber && (
                      <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 font-mono text-[10px] text-paper-goldtext">
                        P.{item.pageNumber}
                      </span>
                    )}

                    <div className="flex shrink-0 items-center gap-0.5">
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => handleMovePin(item.id, -1)}
                          className="rounded p-1 text-paper-muted hover:bg-stone-200/70 hover:text-paper-ink"
                          title="上移"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                      )}
                      {idx < pinnedItems.length - 1 && (
                        <button
                          type="button"
                          onClick={() => handleMovePin(item.id, 1)}
                          className="rounded p-1 text-paper-muted hover:bg-stone-200/70 hover:text-paper-ink"
                          title="下移"
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
                        className="rounded p-1 text-paper-muted hover:bg-red-50 hover:text-red-600"
                        title="移出钉板"
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
                              item.title,
                              item.subtitle || '',
                              item.imageUrl,
                              item.pageNumber,
                            )
                          }
                          className="group relative cursor-zoom-in overflow-hidden rounded-lg border border-stone-100 bg-paper-bg p-1.5"
                        >
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            className="mx-auto max-h-56 w-full object-contain"
                          />
                          <span className="absolute right-2 top-2 rounded-md bg-paper-ink/75 p-1 text-white opacity-0 transition group-hover:opacity-100">
                            <Maximize2 className="h-3 w-3" />
                          </span>
                        </div>
                      )}

                      {!item.imageUrl && item.tableHtml && (
                        <div
                          className="max-h-48 overflow-auto rounded-lg border border-paper-border bg-white text-[10.5px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-stone-200 [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-paper-bg [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold"
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
                          <p className="rounded-lg bg-paper-bg p-2 text-[11px] leading-relaxed text-stone-600">
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

                      {/* 卡片底部操作条 */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
                        {item.domAnchorId && (
                          <button
                            type="button"
                            onClick={() => handleLocateOnPage(item.domAnchorId)}
                            className="inline-flex items-center gap-1 rounded-md border border-paper-border bg-white px-2 py-1 text-[10.5px] text-paper-ink transition hover:bg-paper-bg"
                          >
                            <Crosshair className="h-3 w-3" />
                            定位原处
                          </button>
                        )}

                        {item.source === 'pdf' && item.cropRect && pdfDocRef.current && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleExpandPdfCrop(item, 'up')}
                              className="rounded-md border border-paper-border bg-white px-1.5 py-1 text-[10.5px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                              title="向上扩展裁切区域"
                            >
                              ↑ 扩上
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExpandPdfCrop(item, 'down')}
                              className="rounded-md border border-paper-border bg-white px-1.5 py-1 text-[10.5px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                              title="向下扩展裁切区域"
                            >
                              ↓ 扩下
                            </button>
                            {item.originalImageUrl &&
                              item.imageUrl !== item.originalImageUrl && (
                                <button
                                  type="button"
                                  onClick={() => handleResetPdfCrop(item)}
                                  className="inline-flex items-center gap-0.5 rounded-md border border-paper-border bg-white px-1.5 py-1 text-[10.5px] text-paper-muted transition hover:text-paper-ink"
                                >
                                  <RotateCcw className="h-2.5 w-2.5" />
                                  还原
                                </button>
                              )}
                          </>
                        )}

                        {item.reference && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleCopyBibtex(item.reference!)}
                              className="inline-flex items-center gap-1 rounded-md border border-paper-border bg-white px-2 py-1 text-[10.5px] text-paper-ink transition hover:bg-paper-goldbg"
                            >
                              {copiedRefId === item.reference.key ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              {copiedRefId === item.reference.key ? '已复制' : '复制 BibTeX'}
                            </button>
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
                              Scholar
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
            <div className="rounded-2xl border border-paper-border bg-white p-4 text-center shadow-paper">
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-paper-goldbg text-paper-gold">
                <FileSearch className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-xs font-semibold text-paper-ink">
                未识别到论文资产
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void chrome.tabs
                      .query({ active: true, currentWindow: true })
                      .then((tabs) => void syncWithTab(tabs[0], true));
                  }}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-paper-ink px-3 py-2 text-xs font-medium text-white transition hover:bg-stone-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  扫描当前网页
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartSnip()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-paper-border bg-paper-bg px-3 py-2 text-xs font-medium text-paper-ink transition hover:border-amber-300"
                >
                  <Scissors className="h-3.5 w-3.5 text-paper-gold" />
                  框选当前画面
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
              className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-paper-border bg-white/80 px-4 py-4 text-center transition hover:border-amber-300"
            >
              <Upload className="h-4 w-4 text-paper-muted" />
              <span className="text-[11px] font-medium text-paper-ink">
                拖入或选择本地 PDF
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
            <div className="flex items-center gap-1.5 rounded-xl border border-paper-border bg-white px-2.5 py-1.5 focus-within:border-amber-300">
              <Search className="h-3.5 w-3.5 shrink-0 text-paper-muted" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜 Fig 2、Table 1、14 或关键词…"
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
                  { id: 'all', label: `全部 ${totalAssetsCount}` },
                  {
                    id: 'figure',
                    label: `图 ${assets.filter((a) => a.kind === 'figure').length}`,
                  },
                  {
                    id: 'table',
                    label: `表 ${assets.filter((a) => a.kind === 'table').length}`,
                  },
                  {
                    id: 'equation',
                    label: `式 ${assets.filter((a) => a.kind === 'equation').length}`,
                  },
                  { id: 'reference', label: `文献 ${references.length}` },
                ] as Array<{ id: AssetFilter; label: string }>
              ).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setAssetFilter(chip.id)}
                  className={clsx(
                    'rounded-full px-2.5 py-1 text-[10.5px] font-medium transition',
                    assetFilter === chip.id
                      ? 'bg-paper-ink text-white'
                      : 'border border-paper-border bg-white text-paper-muted hover:text-paper-ink',
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
                  className="overflow-hidden rounded-xl border border-paper-border bg-white p-2.5 shadow-paper transition hover:border-amber-200"
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
                          P.{asset.pageNumber}
                        </span>
                      )}
                      {asset.domAnchorId && (
                        <button
                          type="button"
                          onClick={() => handleLocateOnPage(asset.domAnchorId)}
                          className="rounded-md border border-paper-border px-1.5 py-0.5 text-[10.5px] text-paper-muted transition hover:bg-paper-bg hover:text-paper-ink"
                        >
                          定位
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePinAsset(asset)}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium transition',
                          isPinned
                            ? 'border border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
                            : 'bg-paper-gold text-white hover:bg-amber-700',
                        )}
                      >
                        <Pin className="h-2.5 w-2.5" />
                        {isPinned ? '已钉' : '钉住'}
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
                      className="mt-2 cursor-zoom-in overflow-hidden rounded-lg border border-stone-100 bg-paper-bg p-1"
                    >
                      <img
                        src={asset.imageUrl}
                        alt={asset.label}
                        className="mx-auto max-h-40 w-full object-contain"
                      />
                    </div>
                  )}

                  {!asset.imageUrl && asset.tableHtml && (
                    <div
                      className="mt-2 max-h-36 overflow-auto rounded-lg border border-paper-border bg-white text-[10px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-stone-200 [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-paper-bg [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:font-semibold"
                      dangerouslySetInnerHTML={{ __html: asset.tableHtml }}
                    />
                  )}

                  {!asset.imageUrl && !asset.tableHtml && asset.textPreview && (
                    <div className="mt-2 rounded-lg bg-paper-bg px-2 py-1.5 font-mono text-[10.5px] text-paper-ink">
                      {asset.textPreview}
                    </div>
                  )}

                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-paper-muted">
                    {asset.caption}
                  </p>
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
                  className="rounded-xl border border-paper-border bg-white p-2.5 shadow-paper"
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
                        Scholar ↗
                      </a>
                      {ref.domAnchorId && (
                        <button
                          type="button"
                          onClick={() => handleLocateOnPage(ref.domAnchorId)}
                          className="rounded-md border border-paper-border px-1.5 py-0.5 text-[10px] text-paper-muted transition hover:text-paper-ink"
                        >
                          定位
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePinReference(ref)}
                        className={clsx(
                          'inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-[10.5px] font-medium transition',
                          isPinned
                            ? 'border border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
                            : 'bg-paper-gold text-white hover:bg-amber-700',
                        )}
                      >
                        <Pin className="h-2.5 w-2.5" />
                        {isPinned ? '已钉' : '钉住'}
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs font-medium leading-snug text-paper-ink">
                    {ref.title}
                  </p>
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
                没有匹配“{searchQuery}”的图表或文献
              </p>
            )}
          </div>
        )}
      </div>

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
            <article className="overflow-hidden rounded-xl border border-paper-goldborder/90 bg-white ring-1 ring-amber-400/25">
              <div className="flex items-center gap-1.5 border-b border-stone-100 bg-stone-50/90 px-3 py-2">
                <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper-goldtext">
                  {zoomedItem.kind === 'snip' ? 'Snip' : zoomedItem.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-paper-ink">
                  {zoomedItem.title}
                </span>
                {zoomedItem.pageNumber && (
                  <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 font-mono text-[10px] text-paper-goldtext">
                    P.{zoomedItem.pageNumber}
                  </span>
                )}
                <button
                  type="button"
                  onClick={dismissZoomImmediately}
                  className="rounded p-0.5 text-paper-muted transition hover:text-paper-ink"
                  aria-label="收起放大"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-3">
                {zoomedItem.imageUrl && (
                  <div
                    onClick={() =>
                      openLightbox(
                        zoomedItem.title,
                        zoomedItem.subtitle || '',
                        zoomedItem.imageUrl,
                        zoomedItem.pageNumber,
                      )
                    }
                    className="group relative cursor-zoom-in overflow-hidden rounded-lg border border-paper-border bg-paper-bg p-1.5"
                  >
                    <img
                      src={zoomedItem.imageUrl}
                      alt={zoomedItem.title}
                      className="mx-auto max-h-[60vh] w-full object-contain"
                    />
                    <span className="absolute right-2 top-2 rounded-md bg-paper-ink/75 p-1 text-white opacity-0 transition group-hover:opacity-100">
                      <Maximize2 className="h-3 w-3" />
                    </span>
                  </div>
                )}

                {!zoomedItem.imageUrl && zoomedItem.tableHtml && (
                  <div
                    className="max-h-[54vh] overflow-auto rounded-lg border border-paper-border bg-white text-[11px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-stone-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-paper-bg [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold"
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
                    <p className="max-h-[34vh] overflow-y-auto rounded-lg bg-paper-bg p-2.5 text-[11px] leading-relaxed text-stone-600">
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

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
                  {zoomedItem.domAnchorId && (
                    <button
                      type="button"
                      onClick={() => {
                        dismissZoomImmediately();
                        handleLocateOnPage(zoomedItem.domAnchorId);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-paper-border bg-white px-2 py-1 text-[10.5px] text-paper-ink transition hover:bg-paper-bg"
                    >
                      <Crosshair className="h-3 w-3" />
                      定位原处
                    </button>
                  )}

                  {zoomedItem.source === 'pdf' &&
                    zoomedItem.cropRect &&
                    pdfDocRef.current && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleExpandPdfCrop(zoomedItem, 'up')}
                          className="rounded-md border border-paper-border bg-white px-2 py-1 text-[10.5px] text-paper-ink transition hover:border-paper-goldborder"
                        >
                          ↑ 扩上
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleExpandPdfCrop(zoomedItem, 'down')}
                          className="rounded-md border border-paper-border bg-white px-2 py-1 text-[10.5px] text-paper-ink transition hover:border-paper-goldborder"
                        >
                          ↓ 扩下
                        </button>
                        {zoomedItem.originalImageUrl &&
                          zoomedItem.imageUrl !== zoomedItem.originalImageUrl && (
                            <button
                              type="button"
                              onClick={() => handleResetPdfCrop(zoomedItem)}
                              className="inline-flex items-center gap-0.5 rounded-md border border-paper-goldborder bg-paper-goldbg px-2 py-1 text-[10.5px] font-medium text-paper-goldtext"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                              还原
                            </button>
                          )}
                      </>
                    )}

                  {zoomedItem.reference && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleCopyBibtex(zoomedItem.reference!)}
                        className="inline-flex items-center gap-1 rounded-md border border-paper-border bg-white px-2 py-1 text-[10.5px] text-paper-ink transition hover:bg-paper-goldbg"
                      >
                        {copiedRefId === zoomedItem.reference.key ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedRefId === zoomedItem.reference.key ? '已复制' : '复制 BibTeX'}
                      </button>
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
                        Scholar
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
            const item: CompanionPinItem = {
              id: `snip:${Date.now()}`,
              kind: 'snip',
              source: 'snip',
              title: `自由框选 #${new Date().toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}`,
              subtitle: docTitle,
              imageUrl: croppedDataUrl,
              pinnedAt: Date.now(),
            };
            if (!docKey) setDocKey(targetKey);
            addPinForDoc(targetKey, item, true);
            setSnipScreenshot(null);
          }}
        />
      )}

      {/* 轻量 Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 whitespace-nowrap rounded-full bg-paper-ink px-3.5 py-1.5 text-[11px] text-white shadow-float">
          {toast}
        </div>
      )}
    </div>
  );
}
