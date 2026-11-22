import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPdfPageBlocks, type TranslatedBlock } from '../engine/pdfParagraphs';
import { describeError, message, type DisplayMessage } from '../i18n';
import {
  DEFAULT_TRANSLATE_CONFIG,
  grantFreeTranslateConsent,
  needsFreeTranslateConsent,
  readerTranslator,
  type TranslateConfig,
  type TranslateDisplayMode,
} from './translator';

export interface PaperTranslationController {
  displayMode: TranslateDisplayMode;
  blocksByPage: Record<number, TranslatedBlock[]>;
  doneCount: number;
  running: boolean;
  error: DisplayMessage | null;
  config: TranslateConfig;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  updateConfig: (next: TranslateConfig) => Promise<void>;
  setMode: (mode: TranslateDisplayMode) => void;
  toggleTranslate: () => void;
  /** True while waiting for the reader to acknowledge the public translation service. */
  consentPending: boolean;
  acceptConsent: () => void;
  dismissConsent: () => void;
  resume: () => void;
  stop: () => void;
}

const BATCH_SIZE = 5;

function configSignature(cfg: TranslateConfig): string {
  return JSON.stringify([cfg.provider, cfg.targetLang, cfg.apiBaseUrl, cfg.model, Boolean(cfg.apiKey)]);
}

export function usePaperTranslation(
  pdfDoc: PDFDocumentProxy | null,
  numPages: number,
  currentPage: number,
  visiblePages: ReadonlySet<number>,
): PaperTranslationController {
  const [displayMode, setDisplayMode] = useState<TranslateDisplayMode>('off');
  const [blocksByPage, setBlocksByPage] = useState<Record<number, TranslatedBlock[]>>({});
  const [doneCount, setDoneCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  const [config, setConfig] = useState<TranslateConfig>(DEFAULT_TRANSLATE_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consentMode, setConsentMode] = useState<Exclude<TranslateDisplayMode, 'off'> | null>(null);

  const lastActiveModeRef = useRef<Exclude<TranslateDisplayMode, 'off'>>('translated');
  const displayModeRef = useRef<TranslateDisplayMode>('off');
  const currentPageRef = useRef(currentPage);
  const visiblePagesRef = useRef(visiblePages);
  const configRef = useRef(config);
  const configSigRef = useRef(configSignature(config));
  const blocksCacheRef = useRef<Map<number, TranslatedBlock[]>>(new Map());
  const donePagesRef = useRef<Set<number>>(new Set());
  const runTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  displayModeRef.current = displayMode;
  currentPageRef.current = currentPage;
  visiblePagesRef.current = visiblePages;
  configRef.current = config;

  const stop = useCallback(() => {
    runTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }, []);

  const clearTranslatedTextOnly = useCallback(() => {
    for (const [page, list] of blocksCacheRef.current.entries()) {
      blocksCacheRef.current.set(
        page,
        list.map((b) => ({ ...b, translated: undefined })),
      );
    }
    donePagesRef.current = new Set();
    setDoneCount(0);
    setBlocksByPage({});
  }, []);

  const runLoop = useCallback(
    async (doc: PDFDocumentProxy, totalPages: number) => {
      if (!doc || totalPages <= 0) return;
      const cfg = configRef.current;
      if (cfg.provider !== 'free' && (!cfg.apiBaseUrl.trim() || !cfg.model.trim())) {
        setSettingsOpen(true);
        setError(message('translate.configureFirst'));
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const token = ++runTokenRef.current;
      runningRef.current = true;
      setRunning(true);
      setError(null);

      const pickNextPage = (): number | null => {
        const cur = currentPageRef.current;
        if (cur >= 1 && cur <= totalPages && !donePagesRef.current.has(cur)) return cur;

        const vis = Array.from(visiblePagesRef.current)
          .filter((p) => p >= 1 && p <= totalPages && !donePagesRef.current.has(p))
          .sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur) || a - b);
        if (vis.length > 0) return vis[0];

        for (let p = 1; p <= totalPages; p += 1) {
          if (!donePagesRef.current.has(p)) return p;
        }
        return null;
      };

      while (token === runTokenRef.current && !controller.signal.aborted) {
        const pageNumber = pickNextPage();
        if (pageNumber === null) break;

        try {
          let pageBlocks = blocksCacheRef.current.get(pageNumber);
          if (!pageBlocks) {
            const extracted = await extractPdfPageBlocks(doc, pageNumber, controller.signal);
            if (token !== runTokenRef.current || controller.signal.aborted) return;
            pageBlocks = extracted.map((b) => ({ ...b }));
            blocksCacheRef.current.set(pageNumber, pageBlocks);
          }

          const pending = pageBlocks.filter((b) => !b.translated);
          for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            if (token !== runTokenRef.current || controller.signal.aborted) return;
            const slice = pending.slice(i, i + BATCH_SIZE);
            const translations = await readerTranslator.translateTexts(
              slice.map((b) => b.text),
              configRef.current,
            );
            if (token !== runTokenRef.current || controller.signal.aborted) return;

            slice.forEach((b, idx) => {
              b.translated = translations[idx] || b.text;
            });

            const snapshot = pageBlocks.map((b) => ({ ...b }));
            blocksCacheRef.current.set(pageNumber, snapshot);
            setBlocksByPage((prev) => ({ ...prev, [pageNumber]: snapshot }));
          }

          const nextDone = new Set(donePagesRef.current);
          nextDone.add(pageNumber);
          donePagesRef.current = nextDone;
          setDoneCount(nextDone.size);
        } catch (err) {
          if (token !== runTokenRef.current || controller.signal.aborted) return;
          const notice =
            err instanceof TypeError
              ? message('translate.unreachable')
              : describeError(err, message('translate.failed'));
          setError(notice);
          runningRef.current = false;
          setRunning(false);
          return;
        }
      }

      if (token === runTokenRef.current) {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void readerTranslator.loadTranslateConfig().then((saved) => {
      if (!active) return;
      setConfig(saved);
      configRef.current = saved;
      configSigRef.current = configSignature(saved);
    });
    const unsubscribe = readerTranslator.subscribeConfig((next) => {
      const nextSig = configSignature(next);
      const changed = nextSig !== configSigRef.current;
      configSigRef.current = nextSig;
      configRef.current = next;
      setConfig(next);
      if (changed && pdfDoc) {
        stop();
        clearTranslatedTextOnly();
        if (displayModeRef.current !== 'off') {
          void runLoop(pdfDoc, numPages);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [pdfDoc, numPages, stop, clearTranslatedTextOnly, runLoop]);

  useEffect(() => {
    stop();
    blocksCacheRef.current.clear();
    donePagesRef.current = new Set();
    setDoneCount(0);
    setBlocksByPage({});
    setError(null);
    setConsentMode(null);
    setDisplayMode('off');
    displayModeRef.current = 'off';
  }, [pdfDoc, stop]);

  const startMode = useCallback(
    (mode: TranslateDisplayMode, consented = false) => {
      if (mode === 'off') {
        stop();
        setError(null);
        setDisplayMode('off');
        displayModeRef.current = 'off';
        return;
      }
      const cfg = configRef.current;
      if (cfg.provider !== 'free' && (!cfg.apiBaseUrl.trim() || !cfg.model.trim())) {
        setSettingsOpen(true);
        setError(message('translate.configureFirst'));
        return;
      }
      if (!consented && displayModeRef.current === 'off' && needsFreeTranslateConsent(cfg)) {
        setConsentMode(mode);
        return;
      }
      lastActiveModeRef.current = mode;
      setDisplayMode(mode);
      displayModeRef.current = mode;
      if (pdfDoc && !runningRef.current && donePagesRef.current.size < numPages) {
        void runLoop(pdfDoc, numPages);
      }
    },
    [pdfDoc, numPages, runLoop, stop],
  );

  const setMode = useCallback((mode: TranslateDisplayMode) => startMode(mode), [startMode]);

  const acceptConsent = useCallback(() => {
    grantFreeTranslateConsent();
    const mode = consentMode;
    setConsentMode(null);
    if (mode) startMode(mode, true);
  }, [consentMode, startMode]);

  const dismissConsent = useCallback(() => setConsentMode(null), []);

  const toggleTranslate = useCallback(() => {
    if (displayModeRef.current === 'off') {
      setMode(lastActiveModeRef.current);
    } else {
      setMode('off');
    }
  }, [setMode]);

  const resume = useCallback(() => {
    if (!pdfDoc || displayModeRef.current === 'off') return;
    if (!runningRef.current && donePagesRef.current.size < numPages) {
      void runLoop(pdfDoc, numPages);
    }
  }, [pdfDoc, numPages, runLoop]);

  const updateConfig = useCallback(async (next: TranslateConfig) => {
    const clean: TranslateConfig = {
      ...next,
      apiBaseUrl: next.apiBaseUrl.trim(),
      model: next.model.trim(),
      apiKey: next.apiKey.trim(),
    };
    await readerTranslator.saveTranslateConfig(clean);
  }, []);

  return {
    displayMode,
    blocksByPage,
    doneCount,
    running,
    error,
    config,
    settingsOpen,
    setSettingsOpen,
    updateConfig,
    setMode,
    toggleTranslate,
    consentPending: consentMode !== null,
    acceptConsent,
    dismissConsent,
    resume,
    stop,
  };
}
