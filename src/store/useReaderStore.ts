import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { buildBacklinksMap } from '../engine/backlinks';
import type { ParsePaperResult } from '../engine/parsePaper';
import type {
  CitationBacklink,
  DockPosition,
  InlineCitation,
  JumpAnchor,
  NormalizedRect,
  PaperAsset,
  PinnedItem,
  ReadingStats,
  ReferenceEntry,
} from '../types/paper';

export type ParseResultPayload = Omit<ParsePaperResult, 'isImageOnly'> & { isImageOnly?: boolean };

interface ReaderState {
  /* ---------- 文档 ---------- */
  fileName: string;
  pdfSource: string | null;
  paperHash: string | null;
  pdfDoc: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  scale: number;

  /* ---------- 解析 ---------- */
  isParsing: boolean;
  parseProgress: number;
  parseError: string | null;
  isImageOnly: boolean;

  /* ---------- 解析产物 ---------- */
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;
  backlinksMap: Record<string, CitationBacklink[]>;

  /* ---------- UI 状态 ---------- */
  pinnedItems: PinnedItem[];
  drawerOpen: boolean;
  snipMode: boolean;
  jumpAnchor: JumpAnchor;
  stats: ReadingStats;
  dockPosition: DockPosition;
  dockWidth: number;
  dockHeight: number;

  /* ---------- actions ---------- */
  setPdfDocument: (doc: PDFDocumentProxy, fileName: string, paperHash: string, url: string | null) => void;
  setNumPages: (n: number) => void;
  setCurrentPage: (p: number) => void;
  setScale: (s: number) => void;
  setParsing: (parsing: boolean) => void;
  setParseProgress: (percent: number) => void;
  setParseError: (message: string | null) => void;
  setParseResult: (payload: ParseResultPayload) => void;

  pinAsset: (asset: PaperAsset) => void;
  pinReference: (reference: ReferenceEntry) => void;
  pinSnip: (input: {
    pageNumber: number;
    cropRect: NormalizedRect;
    imageUrl: string;
    title?: string;
    subtitle?: string;
  }) => void;
  unpinItem: (id: string) => void;
  updatePinnedCrop: (id: string, cropRect: NormalizedRect, imageUrl: string) => void;
  resetPinnedCrop: (id: string, fallbackImageUrl?: string) => void;
  togglePinCollapse: (id: string) => void;
  clearPinnedItems: () => void;
  renamePinnedItem: (id: string, title: string) => void;
  movePinnedItem: (id: string, direction: 'up' | 'down') => void;

  recordSavedFlip: (targetPage: number) => void;
  recordPeek: () => void;

  setJumpAnchor: (anchor: JumpAnchor) => void;
  clearJumpAnchor: () => void;

  setDrawerOpen: (open: boolean) => void;
  setSnipMode: (on: boolean) => void;
  setDockPosition: (position: DockPosition) => void;
  setDockWidth: (width: number) => void;
  setDockHeight: (height: number) => void;

  resetPaper: () => void;
}

const DOCK_STORAGE_KEY = 'refpin.dock.layout.v1';

function loadSavedDockLayout(): {
  dockPosition: DockPosition;
  dockWidth: number;
  dockHeight: number;
} {
  const defaults = { dockPosition: 'right' as DockPosition, dockWidth: 388, dockHeight: 264 };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<typeof defaults>;
    const pos = parsed.dockPosition;
    const validPos: DockPosition =
      pos === 'left' || pos === 'right' || pos === 'top' || pos === 'bottom' ? pos : 'right';
    const dockWidth =
      typeof parsed.dockWidth === 'number' && Number.isFinite(parsed.dockWidth)
        ? Math.max(220, Math.round(parsed.dockWidth))
        : defaults.dockWidth;
    const dockHeight =
      typeof parsed.dockHeight === 'number' && Number.isFinite(parsed.dockHeight)
        ? Math.max(148, Math.round(parsed.dockHeight))
        : defaults.dockHeight;
    return { dockPosition: validPos, dockWidth, dockHeight };
  } catch {
    return defaults;
  }
}

function saveDockLayout(dockPosition: DockPosition, dockWidth: number, dockHeight: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({ dockPosition, dockWidth, dockHeight }),
    );
  } catch {
    // 隐私模式或配额受限时静默忽略
  }
}

const savedDock = loadSavedDockLayout();

const initialStats: ReadingStats = {
  savedFlips: 0,
  savedScrollPx: 0,
  peekCount: 0,
  pinCount: 0,
};

const PX_PER_PAGE = 1100;

export const useReaderStore = create<ReaderState>((set, get) => ({
  fileName: '',
  pdfSource: null,
  paperHash: null,
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  scale: 1.25,

  isParsing: false,
  parseProgress: 0,
  parseError: null,
  isImageOnly: false,

  assetsMap: {},
  referencesMap: {},
  citationsByPage: {},
  backlinksMap: {},

  pinnedItems: [],
  drawerOpen: false,
  snipMode: false,
  jumpAnchor: null,
  stats: initialStats,
  dockPosition: savedDock.dockPosition,
  dockWidth: savedDock.dockWidth,
  dockHeight: savedDock.dockHeight,

  setPdfDocument: (doc, fileName, paperHash, url) =>
    set({
      pdfDoc: doc,
      fileName,
      paperHash,
      pdfSource: url,
      numPages: doc.numPages,
      currentPage: 1,
      parseError: null,
    }),
  setNumPages: (n) => set({ numPages: n }),
  setCurrentPage: (p) => set({ currentPage: p }),
  setScale: (s) => set({ scale: Math.min(2.5, Math.max(0.6, Number(s.toFixed(2)))) }),
  setParsing: (parsing) => set({ isParsing: parsing }),
  setParseProgress: (percent) => set({ parseProgress: Math.min(100, Math.max(0, percent)) }),
  setParseError: (message) => set({ parseError: message }),
  setParseResult: (payload) => set({
    ...payload,
    isImageOnly: payload.isImageOnly ?? false,
    backlinksMap: buildBacklinksMap(payload.citationsByPage),
  }),

  pinAsset: (asset) => {
    const { pinnedItems } = get();
    if (pinnedItems.some((item) => item.id === asset.key)) return;
    const item: PinnedItem = {
      id: asset.key,
      kind: asset.kind,
      title: asset.label,
      subtitle: asset.caption,
      pageNumber: asset.pageNumber,
      imageUrl: asset.imageUrl,
      cropRect: asset.cropRect,
      originalCropRect: asset.cropRect,
      originalImageUrl: asset.imageUrl,
      createdAt: Date.now(),
    };
    set((state) => ({
      pinnedItems: [item, ...state.pinnedItems],
      stats: { ...state.stats, pinCount: state.stats.pinCount + 1 },
    }));
  },

  pinReference: (reference) => {
    const { pinnedItems } = get();
    if (pinnedItems.some((item) => item.id === reference.key)) return;
    const item: PinnedItem = {
      id: reference.key,
      kind: 'reference',
      title: reference.title || `参考文献 [${reference.index}]`,
      subtitle: reference.authors,
      pageNumber: reference.pageNumber,
      reference,
      createdAt: Date.now(),
    };
    set((state) => ({
      pinnedItems: [item, ...state.pinnedItems],
      stats: { ...state.stats, pinCount: state.stats.pinCount + 1 },
    }));
  },

  pinSnip: ({ pageNumber, cropRect, imageUrl, title, subtitle }) => {
    const item: PinnedItem = {
      id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'snip',
      title: title || `自由截选 · P.${pageNumber}`,
      subtitle,
      pageNumber,
      imageUrl,
      cropRect,
      originalCropRect: cropRect,
      originalImageUrl: imageUrl,
      createdAt: Date.now(),
    };
    set((state) => ({
      pinnedItems: [item, ...state.pinnedItems],
      stats: { ...state.stats, pinCount: state.stats.pinCount + 1 },
    }));
  },

  unpinItem: (id) =>
    set((state) => ({ pinnedItems: state.pinnedItems.filter((item) => item.id !== id) })),

  updatePinnedCrop: (id, cropRect, imageUrl) =>
    set((state) => ({
      pinnedItems: state.pinnedItems.map((item) =>
        item.id === id
          ? {
              ...item,
              originalCropRect: item.originalCropRect ?? item.cropRect,
              originalImageUrl: item.originalImageUrl ?? item.imageUrl,
              cropRect,
              imageUrl,
            }
          : item,
      ),
      assetsMap: state.assetsMap[id]
        ? {
            ...state.assetsMap,
            [id]: { ...state.assetsMap[id], cropRect, imageUrl },
          }
        : state.assetsMap,
    })),

  resetPinnedCrop: (id, fallbackImageUrl) =>
    set((state) => {
      const target = state.pinnedItems.find((item) => item.id === id);
      if (!target || !target.originalCropRect) return state;
      const restoredRect = target.originalCropRect;
      const restoredImage = target.originalImageUrl ?? fallbackImageUrl ?? target.imageUrl;
      return {
        pinnedItems: state.pinnedItems.map((item) =>
          item.id === id
            ? { ...item, cropRect: restoredRect, imageUrl: restoredImage }
            : item,
        ),
        assetsMap: state.assetsMap[id]
          ? {
              ...state.assetsMap,
              [id]: {
                ...state.assetsMap[id],
                cropRect: restoredRect,
                imageUrl: restoredImage,
              },
            }
          : state.assetsMap,
      };
    }),

  togglePinCollapse: (id) =>
    set((state) => ({
      pinnedItems: state.pinnedItems.map((item) =>
        item.id === id ? { ...item, collapsed: !item.collapsed } : item,
      ),
    })),

  clearPinnedItems: () => set({ pinnedItems: [] }),

  renamePinnedItem: (id, title) =>
    set((state) => ({
      pinnedItems: state.pinnedItems.map((item) =>
        item.id === id ? { ...item, title } : item,
      ),
    })),

  movePinnedItem: (id, direction) =>
    set((state) => {
      const index = state.pinnedItems.findIndex((item) => item.id === id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= state.pinnedItems.length) {
        return state;
      }
      const next = [...state.pinnedItems];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...state, pinnedItems: next };
    }),

  recordSavedFlip: (targetPage) => {
    const { currentPage } = get();
    const distance = Math.abs(targetPage - currentPage);
    if (distance === 0) return;
    set((state) => ({
      stats: {
        ...state.stats,
        savedFlips: state.stats.savedFlips + 1,
        savedScrollPx: state.stats.savedScrollPx + distance * PX_PER_PAGE,
      },
    }));
  },

  recordPeek: () =>
    set((state) => ({ stats: { ...state.stats, peekCount: state.stats.peekCount + 1 } })),

  setJumpAnchor: (anchor) => set({ jumpAnchor: anchor }),
  clearJumpAnchor: () => set({ jumpAnchor: null }),

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  setSnipMode: (on) => set({ snipMode: on }),
  setDockPosition: (dockPosition) => {
    const { dockWidth, dockHeight } = get();
    saveDockLayout(dockPosition, dockWidth, dockHeight);
    set({ dockPosition });
  },
  setDockWidth: (width) => {
    const clamped = Math.max(220, Math.round(width));
    const { dockPosition, dockHeight } = get();
    saveDockLayout(dockPosition, clamped, dockHeight);
    set({ dockWidth: clamped });
  },
  setDockHeight: (height) => {
    const clamped = Math.max(148, Math.round(height));
    const { dockPosition, dockWidth } = get();
    saveDockLayout(dockPosition, dockWidth, clamped);
    set({ dockHeight: clamped });
  },

  resetPaper: () => {
    const { pdfDoc } = get();
    if (pdfDoc) {
      try {
        void pdfDoc.destroy().catch(() => {});
      } catch {
        // 文档已释放时忽略
      }
    }
    set({
      fileName: '',
      pdfSource: null,
      paperHash: null,
      pdfDoc: null,
      numPages: 0,
      currentPage: 1,
      isParsing: false,
      parseProgress: 0,
      parseError: null,
      isImageOnly: false,
      assetsMap: {},
      referencesMap: {},
      citationsByPage: {},
      backlinksMap: {},
      pinnedItems: [],
      snipMode: false,
      jumpAnchor: null,
      stats: initialStats,
    });
  },
}));
