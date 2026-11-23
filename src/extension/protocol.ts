import type { DisplayMessage } from '../i18n/types';
import type { TranslateConfig } from '../services/translator';
import type { AssetKind, CitationBacklink, GlossaryEntry, NormalizedRect, OutlineItem } from '../types/paper';

export type CompanionAssetKind = AssetKind;

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
  kind: CompanionAssetKind | 'reference' | 'snip' | 'glossary';
  source: 'dom' | 'pdf' | 'snip';
  title: string;
  automaticTitle?: boolean;
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

export interface CompanionIndex {
  backlinksMap: Record<string, CitationBacklink[]>;
  glossaryMap: Record<string, GlossaryEntry>;
  outline: OutlineItem[];
}

export interface DomPaperPayload extends CompanionIndex {
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
export { STORAGE_KEY_TRANSLATE_CONFIG } from '../services/translator';

export { DEFAULT_TRANSLATE_CONFIG } from '../services/translator';
export type { TranslateConfig, TranslateDisplayMode, TranslateProvider, TranslateTargetLang } from '../services/translator';
import type { TranslateDisplayMode } from '../services/translator';

export interface PageTranslateStatus {
  active: boolean;
  displayMode: TranslateDisplayMode;
  done: number;
  total: number;
  running: boolean;
  error?: DisplayMessage;
}

export interface PendingPinRecord {
  tabUrl: string;
  item: CompanionPinItem;
  timestamp: number;
}

export type ExtensionMessage =
  | { type: 'REFPIN_WEB_EXPLAIN'; text: string; targetLang: TranslateConfig['targetLang']; allowRemote: boolean }
  | { type: 'REFPIN_EXTRACT_DOM'; force?: boolean }
  | { type: 'REFPIN_SCROLL_TO_ANCHOR'; anchorId: string }
  | { type: 'REFPIN_START_PAGE_SNIP' }
  | { type: 'REFPIN_CAPTURE_VISIBLE_TAB'; windowId?: number }
  | {
      type: 'REFPIN_PIN_FROM_PAGE';
      tabUrl: string;
      item: CompanionPinItem;
      openSidePanel?: boolean;
    }
  | { type: 'REFPIN_READER_PING' | 'REFPIN_BADGE_STATE' | 'REFPIN_DISMISS_BADGE' }
  | { type: 'REFPIN_BADGE_PDF'; pdfUrl?: string }
  | { type: 'REFPIN_FETCH_REMOTE_PDF'; url: string }
  | { type: 'REFPIN_OPEN_SIDEPANEL' }
  | { type: 'REFPIN_SIDEPANEL_PUSH_PIN'; tabUrl: string; item: CompanionPinItem }
  | {
      type: 'REFPIN_TRANSLATE_BATCH';
      texts: string[];
      config?: Partial<TranslateConfig>;
      connectionTest?: boolean;
    }
  | { type: 'REFPIN_WEB_TRANSLATE_CONFIG' }
  | {
      type: 'REFPIN_WEB_TRANSLATE';
      texts: string[];
      connectionTest?: boolean;
      allowFreeChannel: boolean;
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
