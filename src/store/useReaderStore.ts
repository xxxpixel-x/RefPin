import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  InlineCitation,
  JumpAnchor,
  NormalizedRect,
  PaperAsset,
  PinnedItem,
  ReadingStats,
  ReferenceEntry,
} from '../types/paper';

export interface ParseResultPayload {
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;
}

interface ReaderState {
  /* ---------- 文档 ---------- */
  fileName: string;
  pdfSource: string | ArrayBuffer | null;
  pdfDoc: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  scale: number;

  /* ---------- 解析 ---------- */
  isParsing: boolean;
  parseProgress: number;
  parseError: string | null;

  /* ---------- 解析产物 ---------- */
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;

  /* ---------- UI 状态 ---------- */
  pinnedItems: PinnedItem[];
  drawerOpen: boolean;
  snipMode: boolean;
  jumpAnchor: JumpAnchor;
  stats: ReadingStats;

  /* ---------- actions ---------- */
  setPdfDocument: (doc: PDFDocumentProxy, fileName: string, source: string | ArrayBuffer) => void;
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
  togglePinCollapse: (id: string) => void;

  recordSavedFlip: (targetPage: number) => void;
  recordPeek: () => void;

  setJumpAnchor: (anchor: JumpAnchor) => void;
  clearJumpAnchor: () => void;

  setDrawerOpen: (open: boolean) => void;
  setSnipMode: (on: boolean) => void;

  resetPaper: () => void;
}

const initialStats: ReadingStats = {
  savedFlips: 0,
  savedScrollPx: 0,
  peekCount: 0,
  pinCount: 0,
};

/** 每“跳一页”折算的滚动距离，用于右上角“少滚 N px” */
const PX_PER_PAGE = 1100;

export const useReaderStore = create<ReaderState>((set, get) => ({
  fileName: '',
  pdfSource: null,
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  scale: 1.25,

  isParsing: false,
  parseProgress: 0,
  parseError: null,

  assetsMap: {},
  referencesMap: {},
  citationsByPage: {},

  pinnedItems: [],
  drawerOpen: false,
  snipMode: false,
  jumpAnchor: null,
  stats: initialStats,

  setPdfDocument: (doc, fileName, source) =>
    set({
      pdfDoc: doc,
      fileName,
      pdfSource: source,
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
  setParseResult: (payload) => set({ ...payload }),

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
        item.id === id ? { ...item, cropRect, imageUrl } : item,
      ),
    })),

  togglePinCollapse: (id) =>
    set((state) => ({
      pinnedItems: state.pinnedItems.map((item) =>
        item.id === id ? { ...item, collapsed: !item.collapsed } : item,
      ),
    })),

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

  resetPaper: () =>
    set({
      fileName: '',
      pdfSource: null,
      pdfDoc: null,
      numPages: 0,
      currentPage: 1,
      isParsing: false,
      parseProgress: 0,
      parseError: null,
      assetsMap: {},
      referencesMap: {},
      citationsByPage: {},
      pinnedItems: [],
      snipMode: false,
      jumpAnchor: null,
      stats: initialStats,
    }),
}));
