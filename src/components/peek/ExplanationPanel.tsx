import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getCachedPageLines } from '../../engine/pageLinesCache';
import { formatMessage, t } from '../../i18n/core';
import type { LocalizedMessage } from '../../i18n/types';
import { buildExplanationContext, explanationCacheKey, type ExplanationTarget } from '../../services/explanationContext';
import { cachedExplanation, explanationService, grantExplanationConsent, hasExplanationConsent, nativeExplanationReady,
  streamChatExplanation, streamNativeExplanation, subscribeExplanation, type ExplanationResult } from '../../services/explainer';
import { streamExtensionExplanation } from '../../services/explanationBridge';
import type { PaperTranslationController } from '../../services/usePaperTranslation';
import { useReaderStore } from '../../store/useReaderStore';
import type { NormalizedRect } from '../../types/paper';

interface Settings extends Pick<PaperTranslationController, 'config' | 'extensionSettings' | 'setSettingsOpen'> {
  onJump: (page: number, rect?: NormalizedRect) => void;
}
const Reader = createContext<(Settings & { nativeReady: boolean }) | null>(null);

export function ExplanationProvider({ children, ...settings }: Settings & { children: ReactNode }) {
  const lang = settings.extensionSettings?.summary.targetLang ?? settings.config.targetLang;
  const [nativeLang, setNativeLang] = useState<string>();
  useEffect(() => {
    let active = true;
    void nativeExplanationReady(lang).then(ready => { if (active) setNativeLang(ready ? lang : undefined); });
    return () => { active = false; };
  }, [lang]);
  return <Reader.Provider value={{ ...settings, nativeReady: nativeLang === lang }}>{children}</Reader.Provider>;
}

export function isExplanationKind(kind: string) { return ['figure', 'table', 'equation'].includes(kind); }

export function ExplanationPanel({ target, onInteract }: { target: ExplanationTarget; onInteract?: () => void }) {
  const reader = useContext(Reader);
  const paperHash = useReaderStore(state => state.paperHash);
  if (!paperHash || !reader) return null;
  const lang = reader.extensionSettings?.summary.targetLang ?? reader.config.targetLang;
  const cacheKey = explanationCacheKey(paperHash, target, lang);
  return <Panel key={JSON.stringify([cacheKey, reader.extensionSettings?.explanationService, reader.config.provider,
    reader.config.apiBaseUrl, reader.config.model])} reader={reader} target={target} cacheKey={cacheKey} onInteract={onInteract} />;
}

const buttonClass = 'rounded-md border border-paper-border px-2 py-1 text-xs text-paper-ink hover:border-paper-goldborder hover:bg-paper-bg';

function Panel({ reader, target, cacheKey, onInteract }: {
  reader: NonNullable<React.ContextType<typeof Reader>>; target: ExplanationTarget; cacheKey: string; onInteract?: () => void;
}) {
  const { config, extensionSettings, nativeReady } = reader;
  const lang = extensionSettings?.summary.targetLang ?? config.targetLang;
  const service = extensionSettings ? extensionSettings.explanationService : explanationService(config);
  const remote = service === 'remote';
  const destination = remote ? extensionSettings ? 'extension' : new URL(config.apiBaseUrl).origin : '';
  const [status, setStatus] = useState<'idle' | 'consent' | 'running' | 'done' | 'stopped' | 'error'>('idle');
  const [result, setResult] = useState<ExplanationResult>();
  const [error, setError] = useState<LocalizedMessage>();
  const detach = useRef<() => void>();
  const parsing = useReaderStore(state => state.isParsing);
  const cached = cachedExplanation(cacheKey);
  useEffect(() => () => detach.current?.(), []);

  function start(native = false) {
    onInteract?.();
    const ready = cachedExplanation(cacheKey);
    if (ready) { setResult(ready); setStatus('done'); return; }
    if (!native && !service) {
      if (!document.hasFocus()) window.focus();
      reader.setSettingsOpen(true);
      return;
    }
    if (!native && remote && !hasExplanationConsent(destination)) { setStatus('consent'); return; }
    const { pdfDoc, backlinksMap, glossaryMap } = useReaderStore.getState();
    if (!pdfDoc) return;
    const context = buildExplanationContext(target, getCachedPageLines(pdfDoc) ?? {}, backlinksMap, glossaryMap);
    setError(undefined);
    detach.current?.();
    detach.current = subscribeExplanation(cacheKey, context.sources, (signal, emit) => {
      if (native) return streamNativeExplanation(lang, context.text, signal, emit);
      if (extensionSettings) return streamExtensionExplanation(context.text, lang, remote, signal, emit);
      return streamChatExplanation(config, context.text, signal, emit);
    }, state => {
      setResult(state);
      setError(state.error);
      setStatus(state.error ? 'error' : state.done ? 'done' : 'running');
    });
  }
  const showActions = status === 'idle' || status === 'error' || status === 'stopped';
  return <div className="min-h-0 overflow-y-auto p-1 text-xs text-paper-ink">
    {showActions && <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={buttonClass} disabled={!!service && parsing && !cached} onClick={() => start()}>
        {t(cached ? 'explain.action' : !service ? 'explain.configure' : parsing ? 'assets.parsing' : 'explain.action')}
      </button>
      {nativeReady && <button type="button" className={buttonClass} disabled={parsing && !cached} onClick={() => start(true)}>{t('explain.native')}</button>}
    </div>}
    {status === 'consent' && <div role="dialog" aria-label={t('explain.consentTitle')} className="max-w-80 rounded-lg bg-paper-bg p-2.5">
      <p className="font-semibold">{t('explain.consentTitle')}</p>
      <p className="my-2 leading-relaxed">{t('explain.consentBody')}</p>
      <p className="mb-2 break-all text-paper-muted">{t('explain.consentDestination', {
        destination: destination === 'extension' ? t('explain.extensionService') : destination })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => setStatus('idle')}>{t('common.cancel')}</button>
        <button type="button" className={buttonClass} onClick={() => { grantExplanationConsent(destination); start(); }}>
          {t('explain.allow')}
        </button>
      </div>
    </div>}
    {result && status !== 'consent' && status !== 'idle' && <section aria-label={t('explain.action')}
      className="mt-1 max-h-72 max-w-80 overflow-y-auto rounded-lg bg-paper-bg p-2.5">
      <div className="flex items-center justify-between gap-2">
        <strong>{t(status === 'running' ? 'explain.running' : status === 'stopped' ? 'explain.stopped' : 'explain.action')}</strong>
        {status === 'running'
          ? <button type="button" className={buttonClass} onClick={() => { detach.current?.(); setStatus('stopped'); }}>{t('explain.stop')}</button>
          : <button type="button" className={buttonClass} onClick={() => setStatus('idle')}>{t('common.collapse')}</button>}
      </div>
      {result.text && <p lang={lang} className="my-2 whitespace-pre-wrap break-words leading-relaxed">{result.text}</p>}
      {error && <p role="alert" className="my-2 text-paper-muted">{formatMessage(error)}</p>}
      <div className="mt-2 border-t border-paper-border pt-1.5 text-[11px] text-paper-muted">
        <p>{t('explain.disclaimer')}</p>
        {!!result.sources.length && <div className="mt-1 flex flex-wrap items-center gap-1">
          <span>{t('explain.sources')}</span>
          {result.sources.map(({ pageNumber, rect }) => <button key={pageNumber} type="button"
            className="rounded px-1 text-paper-goldtext underline hover:bg-paper-goldbg"
            onClick={() => reader.onJump(pageNumber, rect)}>{t('reader.page', { page: pageNumber })}</button>)}
        </div>}
      </div>
    </section>}
  </div>;
}
