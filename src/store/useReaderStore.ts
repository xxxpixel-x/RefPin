import type { DisplayMessage } from '../i18n/types';
import { t } from '../i18n/core';
import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { buildBacklinksMap, glossaryPinId } from '../engine/backlinks';
import type { ParsePaperResult } from '../engine/parsePaper';
import type {
  CitationBacklink,
  DockPosition,
  GlossaryEntry,
  Highlight,
  HighlightSelection,
  InlineCitation,
  JumpPosition,
  OutlineItem,
  NormalizedRect,
  PaperAsset,
  PaperArchive,
  PinnedItem,
  ReadingStats,
  ReferenceEntry,
} from '../types/paper';

export type Theme = 'light' | 'sepia' | 'dark';
export type DrawerSection = 'assets' | 'outline' | 'glossary';

type NewParseFields = 'backlinksMap' | 'outline' | 'isImageOnly' | 'glossaryMap' | 'glossaryMentionsByPage';
export const clampReaderScale = (scale: number) => Math.min(2.5, Math.max(0.6, Number(scale.toFixed(2))));
export type ParseResultPayload = Omit<ParsePaperResult, NewParseFields> & Partial<Pick<ParsePaperResult, NewParseFields>>;

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
  parseError: DisplayMessage | null;
  isImageOnly: boolean;

  /* ---------- 解析产物 ---------- */
  outline: OutlineItem[];
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  citationsByPage: Record<number, InlineCitation[]>;
  glossaryMap: ParsePaperResult['glossaryMap'];
  glossaryMentionsByPage: ParsePaperResult['glossaryMentionsByPage'];
  backlinksMap: Record<string, CitationBacklink[]>;

  /* ---------- UI 状态 ---------- */
  pinnedItems: PinnedItem[];
  highlights: Highlight[];
  addHighlights: (pages: HighlightSelection[], color: Highlight['color'], note?: string) => void;
  editHighlight: (id: string, color: Highlight['color'], note?: string) => void;
  removeHighlight: (id: string) => void;
  restoreHighlight: (highlight: Highlight) => void;
  scholarLookupEnabled: boolean;
  setScholarLookupEnabled: (enabled: boolean) => void;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  drawerOpen: boolean;
  drawerSection: DrawerSection;
  snipMode: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  readingRulerEnabled: boolean;
  setReadingRulerEnabled: (enabled: boolean) => void;
  jumpHistory: { origin: JumpPosition; target: JumpPosition }[];
  historyCursor: number;
  historyVisible: boolean;
  recordJump: (origin: JumpPosition, target: JumpPosition) => void;
  navigateHistory: (direction: 'back' | 'forward') => JumpPosition | undefined;
  dismissHistory: () => void;
  stats: ReadingStats;
  dockPosition: DockPosition;
  dockWidth: number;
  dockHeight: number;
  dockCollapsed: boolean;

  narrowDock: boolean;
  drawerCollapsed: boolean;

  /* ---------- actions ---------- */
  setPdfDocument: (doc: PDFDocumentProxy, fileName: string, paperHash: string, url: string | null, archive?: PaperArchive) => void;
  restorePinnedPreview: (item: PinnedItem, imageUrl?: string) => void;
  setNumPages: (n: number) => void;
  setCurrentPage: (p: number) => void;
  setScale: (s: number) => void;
  setParsing: (parsing: boolean) => void;
  setParseProgress: (percent: number) => void;
  setParseError: (message: DisplayMessage | null) => void;
  setParseResult: (payload: ParseResultPayload) => void;

  pinAsset: (asset: PaperAsset) => void;
  pinReference: (reference: ReferenceEntry) => void;
  pinGlossary: (entry: GlossaryEntry) => void;
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
  restorePinnedItems: (items: PinnedItem[]) => void;
  renamePinnedItem: (id: string, title: string) => void;
  movePinnedItem: (id: string, direction: 'up' | 'down') => void;

  recordSavedFlip: (targetPage: number) => void;
  recordPeek: () => void;


  setDrawerOpen: (open: boolean) => void;
  setDrawerSection: (section: DrawerSection) => void;
  toggleDrawerSection: (section: DrawerSection) => void;
  setSnipMode: (on: boolean) => void;
  setDockPosition: (position: DockPosition) => void;
  setDockWidth: (width: number) => void;
  setDockHeight: (height: number) => void;
  setDockCollapsed: (collapsed: boolean) => void;
  toggleDockCollapsed: () => void;

  resetPaper: () => void;
}

const DOCK_STORAGE_KEY = 'refpin.dock.layout.v1';
const AUTO_SYNC_KEY = 'refpin.dock.autoSync.v1';

const SCHOLAR_KEY = 'refpin.scholar.v1';
const THEME_KEY = 'refpin.theme.v1';
const RULER_KEY = 'refpin.readingRuler.v1';

function preference(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Keep the session preference. */ }
}

const storedTheme = preference(THEME_KEY);
const initialTheme: Theme = storedTheme === 'dark' || storedTheme === 'sepia' ? storedTheme : 'light';

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.dataset.theme = theme;
}
applyTheme(initialTheme);

function loadAutoSync(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(AUTO_SYNC_KEY) !== 'false';
  } catch {
    return true;
  }
}

function loadSavedDockLayout(): {
  dockPosition: DockPosition;
  dockWidth: number;
  dockHeight: number;
  dockCollapsed: boolean;
} {
  const defaults = { dockPosition: 'right' as DockPosition, dockWidth: 340, dockHeight: 264, dockCollapsed: false };
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
    const dockCollapsed = parsed.dockCollapsed === true;
    return { dockPosition: validPos, dockWidth, dockHeight, dockCollapsed };
  } catch {
    return defaults;
  }
}

function saveDockLayout(dockPosition: DockPosition, dockWidth: number, dockHeight: number, dockCollapsed = false) {
  if (typeof window === 'undefined' || dockPosition === 'popout') return;
  try {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({ dockPosition, dockWidth, dockHeight, dockCollapsed }),
    );
  } catch {
    // 隐私模式或配额受限时静默忽略
  }
}

const savedDock = loadSavedDockLayout();

export const NARROW_DOCK_QUERY = '(width < 768px)';

export function visibleDockCollapsed(state: ReaderState) {
  return state.dockPosition !== 'popout' && (state.narrowDock ? state.drawerCollapsed : state.dockCollapsed);
}

function revealDock(state: ReaderState) {
  if (!visibleDockCollapsed(state)) return {};
  if (state.narrowDock) return { drawerCollapsed: false };
  saveDockLayout(state.dockPosition, state.dockWidth, state.dockHeight, false);
  return { dockCollapsed: false };
}

const initialStats: ReadingStats = {
  savedFlips: 0,
  savedScrollPx: 0,
  peekCount: 0,
  pinCount: 0,
};

export function reorderPins(items: PinnedItem[], id: string, delta: number) {
  const index = items.findIndex(item => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

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

  outline: [],
  assetsMap: {},
  referencesMap: {},
  citationsByPage: {},
  glossaryMap: {},
  glossaryMentionsByPage: {},
  backlinksMap: {},

  pinnedItems: [],
  highlights: [],
  addHighlights: (pages, color, note) => set(state => {
    const now = Date.now();
    const added = pages.map(page => ({
      ...page, id: crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
      color, note, createdAt: now, updatedAt: now,
    }));
    return { highlights: [...state.highlights, ...added] };
  }),
  editHighlight: (id, color, note) => set(state => ({
    highlights: state.highlights.map(item => item.id === id ? { ...item, color, note, updatedAt: Date.now() } : item),
  })),
  removeHighlight: id => set(state => ({ highlights: state.highlights.filter(item => item.id !== id) })),
  restoreHighlight: item => set(state => state.highlights.some(h => h.id === item.id)
    ? state : { highlights: [...state.highlights, item] }),
  scholarLookupEnabled: preference(SCHOLAR_KEY) === 'true',
  setScholarLookupEnabled: enabled => {
    savePreference(SCHOLAR_KEY, String(enabled));
    set({ scholarLookupEnabled: enabled });
  },
  autoSyncEnabled: loadAutoSync(),
  setAutoSyncEnabled: enabled => {
    try { window.localStorage.setItem(AUTO_SYNC_KEY, String(enabled)); } catch { /* Session-only storage. */ }
    set({ autoSyncEnabled: enabled });
  },
  drawerOpen: false,
  drawerSection: 'assets',
  snipMode: false,
  jumpHistory: [],
  historyCursor: 0,
  historyVisible: false,
  stats: initialStats,
  dockPosition: savedDock.dockPosition,
  dockWidth: savedDock.dockWidth,
  dockHeight: savedDock.dockHeight,
  dockCollapsed: savedDock.dockCollapsed,
  narrowDock: typeof window !== 'undefined' && window.matchMedia?.(NARROW_DOCK_QUERY).matches === true,
  drawerCollapsed: true,

  setPdfDocument: (doc, fileName, paperHash, url, archive) =>
    set({
      pdfDoc: doc,
      drawerCollapsed: true,
      fileName,
      paperHash,
      pdfSource: url,
      numPages: doc.numPages,
      currentPage: Math.min(doc.numPages, Math.max(1, archive?.lastPage ?? 1)),
      scale: archive?.scale ?? get().scale,
      highlights: archive?.highlights ?? [],
      pinnedItems: (archive?.pinnedItems ?? []).map(item => ({
        ...item,
        previewStatus: item.kind !== 'reference' && item.kind !== 'glossary' && item.cropRect ? 'restoring' : undefined,
      })),
      parseError: null,
    }),
  restorePinnedPreview: (original, imageUrl) => set(state => ({
    pinnedItems: state.pinnedItems.map(item =>
      item.id === original.id && item.cropRect === original.cropRect && item.previewStatus === 'restoring'
        ? { ...item, imageUrl, previewStatus: imageUrl ? undefined : 'unavailable' }
        : item),
  })),
  setNumPages: (n) => set({ numPages: n }),
  setCurrentPage: (p) => set({ currentPage: p }),
  setScale: (s) => set({ scale: clampReaderScale(s) }),
  setParsing: (parsing) => set({ isParsing: parsing }),
  setParseProgress: (percent) => set({ parseProgress: Math.min(100, Math.max(0, percent)) }),
  setParseError: (message) => set({ parseError: message }),
  setParseResult: (payload) => set({
    ...payload,
    outline: payload.outline ?? [],
    glossaryMap: payload.glossaryMap ?? {},
    glossaryMentionsByPage: payload.glossaryMentionsByPage ?? {},
    isImageOnly: payload.isImageOnly ?? false,
    backlinksMap: payload.backlinksMap ?? buildBacklinksMap(payload.citationsByPage, payload.glossaryMentionsByPage),
  }),

  pinAsset: (asset) => {
    const { pinnedItems } = get();
    if (pinnedItems.some((item) => item.id === asset.key)) {
      if (visibleDockCollapsed(get())) set(revealDock(get()));
      return;
    }
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
      ...revealDock(state),
      pinnedItems: [item, ...state.pinnedItems],
      stats: { ...state.stats, pinCount: state.stats.pinCount + 1 },
    }));
  },

  pinReference: (reference) => {
    const { pinnedItems } = get();
    if (pinnedItems.some((item) => item.id === reference.key)) {
      if (visibleDockCollapsed(get())) set(revealDock(get()));
      return;
    }
    const item: PinnedItem = {
      id: reference.key,
      kind: 'reference',
      automaticTitle: !reference.title,
      title: reference.title || t('reference.number', { index: reference.index }),
      subtitle: reference.authors,
      pageNumber: reference.pageNumber,
      reference,
      createdAt: Date.now(),
    };
    set((state) => ({
      ...revealDock(state),
      pinnedItems: [item, ...state.pinnedItems],
      stats: { ...state.stats, pinCount: state.stats.pinCount + 1 },
    }));
  },

  pinGlossary: (entry) => {
    const id = glossaryPinId(entry.term);
    const { pinnedItems } = get();
    if (pinnedItems.some((item) => item.id === id)) {
      if (visibleDockCollapsed(get())) set(revealDock(get()));
      return;
    }
    const item: PinnedItem = {
      id,
      kind: 'glossary',
      title: entry.term,
      subtitle: entry.expansion,
      textPreview: entry.contextSentence,
      pageNumber: entry.definedPage,
      cropRect: entry.definedRect,
      createdAt: Date.now(),
    };
    set((state) => ({
      ...revealDock(state),
      pinnedItems: [item, ...state.pinnedItems],
      stats: { ...state.stats, pinCount: state.stats.pinCount + 1 },
    }));
  },

  pinSnip: ({ pageNumber, cropRect, imageUrl, title, subtitle }) => {
    const item: PinnedItem = {
      id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'snip',
      automaticTitle: !title,
      title: title || t('snip.pageTitle', { page: pageNumber }),
      subtitle,
      pageNumber,
      imageUrl,
      cropRect,
      originalCropRect: cropRect,
      originalImageUrl: imageUrl,
      createdAt: Date.now(),
    };
    set((state) => ({
      ...revealDock(state),
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
              originalImageUrl: item.originalImageUrl ?? (item.originalCropRect ? undefined : item.imageUrl),
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
            ? { ...item, cropRect: restoredRect, imageUrl: restoredImage, originalImageUrl: restoredImage }
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
  restorePinnedItems: (items) => set({ pinnedItems: items }),

  renamePinnedItem: (id, title) =>
    set((state) => ({
      pinnedItems: state.pinnedItems.map((item) =>
        item.id === id ? { ...item, title, automaticTitle: false } : item,
      ),
    })),

  movePinnedItem: (id, direction) => set(state => ({
    pinnedItems: reorderPins(state.pinnedItems, id, direction === 'up' ? -1 : 1),
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

  theme: initialTheme,
  setTheme: theme => {
    applyTheme(theme);
    savePreference(THEME_KEY, theme);
    set({ theme });
  },
  readingRulerEnabled: preference(RULER_KEY) === 'true',
  setReadingRulerEnabled: enabled => {
    savePreference(RULER_KEY, String(enabled));
    set({ readingRulerEnabled: enabled });
  },

  recordJump: (origin, target) => set(state => {
    const jumpHistory = [...state.jumpHistory.slice(0, state.historyCursor), { origin, target }].slice(-20);
    return { jumpHistory, historyCursor: jumpHistory.length, historyVisible: true };
  }),
  navigateHistory: direction => {
    const { jumpHistory, historyCursor } = get();
    const back = direction === 'back';
    const step = jumpHistory[back ? historyCursor - 1 : historyCursor];
    if (!step) return;
    set({ historyCursor: historyCursor + (back ? -1 : 1), historyVisible: true });
    return back ? step.origin : step.target;
  },
  dismissHistory: () => set({ historyVisible: false }),

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  setDrawerSection: (drawerSection) => set({ drawerSection }),
  toggleDrawerSection: (section) => set((state) => (
    state.drawerOpen && state.drawerSection === section
      ? { drawerOpen: false }
      : { drawerOpen: true, drawerSection: section }
  )),
  setSnipMode: (on) => set({ snipMode: on }),
  setDockPosition: (dockPosition) => {
    const { dockWidth, dockHeight, dockCollapsed } = get();
    saveDockLayout(dockPosition, dockWidth, dockHeight, dockCollapsed);
    set({ dockPosition });
  },
  setDockWidth: (width) => {
    const clamped = Math.max(220, Math.round(width));
    const { dockPosition, dockHeight, dockCollapsed } = get();
    saveDockLayout(dockPosition, clamped, dockHeight, dockCollapsed);
    set({ dockWidth: clamped });
  },
  setDockHeight: (height) => {
    const clamped = Math.max(148, Math.round(height));
    const { dockPosition, dockWidth, dockCollapsed } = get();
    saveDockLayout(dockPosition, dockWidth, clamped, dockCollapsed);
    set({ dockHeight: clamped });
  },
  setDockCollapsed: (dockCollapsed) => {
    const { dockPosition, dockWidth, dockHeight } = get();
    saveDockLayout(dockPosition, dockWidth, dockHeight, dockCollapsed);
    set({ dockCollapsed });
  },
  toggleDockCollapsed: () => {
    const state = get();
    if (state.narrowDock && state.dockPosition !== 'popout') set({ drawerCollapsed: !state.drawerCollapsed });
    else state.setDockCollapsed(!state.dockCollapsed);
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
      outline: [],
      assetsMap: {},
      referencesMap: {},
      citationsByPage: {},
      glossaryMap: {},
      glossaryMentionsByPage: {},
      backlinksMap: {},
      pinnedItems: [],
      highlights: [],
      snipMode: false,
      jumpHistory: [],
      historyCursor: 0,
      historyVisible: false,
      stats: initialStats,
    });
  },
}));

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', event => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key === THEME_KEY || event.key === null) {
      const saved = preference(THEME_KEY);
      const theme = saved === 'sepia' || saved === 'dark' ? saved : 'light';
      applyTheme(theme);
      useReaderStore.setState({ theme });
    }
    if (event.key === SCHOLAR_KEY || event.key === null) {
      useReaderStore.setState({ scholarLookupEnabled: preference(SCHOLAR_KEY) === 'true' });
    }
  });
}
