import type { NormalizedRect } from '../types/paper';

export type CompanionAssetKind = 'figure' | 'table' | 'equation';

export interface CompanionAsset {
  key: string;
  kind: CompanionAssetKind;
  label: string;
  caption: string;
  source: 'dom' | 'pdf';
  imageUrl?: string;
  tableHtml?: string;
  textPreview?: string;
  domAnchorId?: string;
  pageNumber?: number;
  cropRect?: NormalizedRect;
}

export interface CompanionReference {
  key: string;
  index: number;
  rawText: string;
  title: string;
  authors?: string;
  year?: string;
  href?: string;
  domAnchorId?: string;
  pageNumber?: number;
}

export interface CompanionPinItem {
  id: string;
  kind: CompanionAssetKind | 'reference' | 'snip';
  source: 'dom' | 'pdf' | 'snip';
  title: string;
  subtitle?: string;
  imageUrl?: string;
  tableHtml?: string;
  textPreview?: string;
  domAnchorId?: string;
  pageNumber?: number;
  cropRect?: NormalizedRect;
  originalCropRect?: NormalizedRect;
  originalImageUrl?: string;
  reference?: CompanionReference;
  collapsed?: boolean;
  pinnedAt: number;
}

export interface DomPaperPayload {
  title: string;
  url: string;
  siteLabel: string;
  isAcademicPage: boolean;
  pdfUrl?: string;
  assets: CompanionAsset[];
  references: CompanionReference[];
  citationCount: number;
}

export const STORAGE_KEY_PENDING_PIN = 'refpin_pending_pin';
export const STORAGE_KEY_TRANSLATE_CONFIG = 'refpin_translate_config';

export type TranslateProvider = 'free' | 'openai';
export type TranslateTargetLang = 'zh-CN' | 'en';
export type TranslateDisplayMode = 'off' | 'bilingual' | 'translated';

export interface TranslateConfig {
  provider: TranslateProvider;
  targetLang: TranslateTargetLang;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_TRANSLATE_CONFIG: TranslateConfig = {
  provider: 'free',
  targetLang: 'zh-CN',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export interface PageTranslateStatus {
  active: boolean;
  displayMode: TranslateDisplayMode;
  done: number;
  total: number;
  running: boolean;
  error?: string;
}

export interface PendingPinRecord {
  tabUrl: string;
  item: CompanionPinItem;
  timestamp: number;
}

export type ExtensionMessage =
  | { type: 'REFPIN_EXTRACT_DOM'; force?: boolean }
  | { type: 'REFPIN_SCROLL_TO_ANCHOR'; anchorId: string }
  | { type: 'REFPIN_START_PAGE_SNIP' }
  | {
      type: 'REFPIN_SHOW_ZOOM_PREVIEW';
      item: CompanionPinItem;
      anchorCenterRatio: number;
    }
  | { type: 'REFPIN_HIDE_ZOOM_PREVIEW' }
  | { type: 'REFPIN_CAPTURE_VISIBLE_TAB'; windowId?: number }
  | {
      type: 'REFPIN_PIN_FROM_PAGE';
      tabUrl: string;
      item: CompanionPinItem;
      openSidePanel?: boolean;
    }
  | { type: 'REFPIN_OPEN_SIDEPANEL' }
  | { type: 'REFPIN_SIDEPANEL_PUSH_PIN'; tabUrl: string; item: CompanionPinItem }
  | {
      type: 'REFPIN_TRANSLATE_BATCH';
      texts: string[];
      config?: Partial<TranslateConfig>;
    }
  | {
      type: 'REFPIN_PAGE_TRANSLATE_START';
      displayMode?: Exclude<TranslateDisplayMode, 'off'>;
    }
  | {
      type: 'REFPIN_PAGE_TRANSLATE_MODE';
      displayMode: TranslateDisplayMode;
    }
  | { type: 'REFPIN_PAGE_TRANSLATE_STOP' }
  | { type: 'REFPIN_PAGE_TRANSLATE_GET_STATUS' }
  | {
      type: 'REFPIN_PAGE_TRANSLATE_STATUS_PUSH';
      tabUrl: string;
      status: PageTranslateStatus;
    }
  | {
      type: 'REFPIN_PDF_TR_SET_MODE';
      pdfUrl: string;
      displayMode: TranslateDisplayMode;
    }
  | { type: 'REFPIN_PDF_TR_STOP'; pdfUrl: string }
  | { type: 'REFPIN_PDF_TR_GET_STATUS'; pdfUrl: string }
  | {
      type: 'REFPIN_PDF_TR_STATUS_PUSH';
      pdfUrl: string;
      status: PageTranslateStatus;
    };
