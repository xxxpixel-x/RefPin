import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Languages, Loader2, Settings, Square } from 'lucide-react';
import clsx from 'clsx';
import { IS_EXTENSION_PAGE } from '../../config/runtime';
import { formatMessage, message, t, type DisplayMessage } from '../../i18n';
import type { PaperTranslationController } from '../../services/usePaperTranslation';
import {
  TRANSLATE_PRESETS,
  type TranslateConfig,
  type TranslateDisplayMode,
} from '../../services/translator';

interface TranslateControlProps {
  translation: PaperTranslationController;
  numPages: number;
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-paper-border bg-paper-card px-2.5 py-1.5 text-xs text-paper-ink outline-none focus:border-paper-gold';

export function TranslateControl({ translation, numPages }: TranslateControlProps) {
  const {
    displayMode,
    doneCount,
    running,
    config,
    settingsOpen,
    setSettingsOpen,
    updateConfig,
    setMode,
    toggleTranslate,
    consentPending,
    acceptConsent,
    dismissConsent,
    resume,
    stop,
  } = translation;

  const [draft, setDraft] = useState<TranslateConfig>(config);
  const [notice, setNotice] = useState<DisplayMessage | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
        setNotice(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setNotice(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen, setSettingsOpen]);

  useEffect(() => {
    if (!consentPending) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) dismissConsent();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissConsent();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [consentPending, dismissConsent]);

  const openCustomApiSettings = () => {
    dismissConsent();
    setDraft({ ...config, provider: 'openai' });
    setNotice(null);
    setSettingsOpen(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const next: TranslateConfig = {
      ...draft,
      apiBaseUrl: draft.apiBaseUrl.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
    };
    if (next.provider !== 'free' && (!/^https?:\/\//i.test(next.apiBaseUrl) || !next.model)) {
      setNotice(message('translate.invalidConfig'));
      return;
    }
    try {
      await updateConfig(next);
      setNotice(null);
      setSettingsOpen(false);
    } catch {
      setNotice(message('settings.saveFailed'));
    }
  };

  const handleClearKey = async () => {
    try {
      const next = { ...config, apiKey: '' };
      await updateConfig(next);
      setDraft((prev) => ({ ...prev, apiKey: '' }));
      setNotice(message('settings.keyCleared'));
    } catch {
      setNotice(message('settings.clearFailed'));
    }
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      {displayMode === 'off' ? (
        <div className="flex items-center overflow-hidden rounded-lg border border-paper-border bg-paper-card">
          <button
            type="button"
            onClick={toggleTranslate}
            className="flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg"
            title={t('translate.oneClickHint')}
          >
            <Languages className="h-3.5 w-3.5 text-paper-gold" />
            <span className="hidden xl:inline">{t('translate.oneClick')}</span>
          </button>
          <button
            type="button"
            aria-expanded={settingsOpen}
            aria-label={t('translate.settings')}
            title={t('translate.settings')}
            onClick={() => {
              setDraft(config);
              setNotice(null);
              setSettingsOpen(!settingsOpen);
            }}
            className={clsx(
              'border-l border-paper-border px-1.5 py-1.5 transition',
              settingsOpen
                ? 'bg-paper-goldbg text-paper-goldtext'
                : 'text-paper-muted hover:bg-paper-bg hover:text-paper-ink',
            )}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 rounded-lg border border-paper-goldborder bg-paper-goldbg/60 p-0.5">
          <div className="flex items-center rounded-md bg-paper-card p-0.5 text-xs shadow-sm">
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
                aria-pressed={displayMode === opt.id}
                onClick={() => setMode(opt.id)}
                className={clsx(
                  'rounded px-2 py-0.5 font-medium transition',
                  displayMode === opt.id
                    ? 'bg-paper-ink text-paper-card'
                    : 'text-paper-muted hover:text-paper-ink',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {running ? (
            <button
              type="button"
              onClick={stop}
              title={t('translate.stop')}
              aria-label={t('translate.stop')}
              className="inline-flex items-center gap-1 rounded-md bg-paper-ink px-2 py-1 font-mono text-[11px] font-medium text-paper-card"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>
                {doneCount}/{numPages}
              </span>
              <Square className="h-2 w-2 fill-current" />
            </button>
          ) : doneCount < numPages ? (
            <button
              type="button"
              onClick={resume}
              className="inline-flex items-center gap-1 rounded-md bg-paper-gold px-2 py-1 text-[11px] font-medium text-paper-card transition hover:opacity-90"
            >
              <Languages className="h-3 w-3" />
              <span>{t('translate.resume')}</span>
              <span className="font-mono text-[11px]">
                {doneCount}/{numPages}
              </span>
            </button>
          ) : (
            numPages > 0 && (
              <span
                className="px-1.5 font-mono text-[11px] text-paper-goldtext"
                title={t('translate.done', { done: doneCount, total: numPages })}
              >
                {doneCount}/{numPages}
              </span>
            )
          )}

          <button
            type="button"
            aria-expanded={settingsOpen}
            aria-label={t('translate.settings')}
            title={t('translate.settings')}
            onClick={() => {
              setDraft(config);
              setNotice(null);
              setSettingsOpen(!settingsOpen);
            }}
            className={clsx(
              'rounded-md p-1 transition',
              settingsOpen
                ? 'bg-paper-card text-paper-goldtext shadow-sm'
                : 'text-paper-muted hover:bg-paper-card hover:text-paper-ink',
            )}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {consentPending && !settingsOpen && (
        <div
          role="dialog"
          aria-labelledby="translate-consent-title"
          className="absolute left-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-paper-border bg-paper-card p-3.5 text-paper-ink shadow-float"
        >
          <p id="translate-consent-title" className="text-sm font-semibold">{t('translate.consentTitle')}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-paper-muted">{t('translate.consentBody')}</p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={openCustomApiSettings}
              className="rounded-lg border border-paper-border px-3 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg">
              {t('translate.consentConfigure')}
            </button>
            <button type="button" autoFocus onClick={acceptConsent}
              className="rounded-lg bg-paper-ink px-3 py-1.5 text-xs font-medium text-paper-card transition hover:opacity-90">
              {t('translate.consentContinue')}
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <form
          onSubmit={(e) => void handleSave(e)}
          className="absolute left-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-paper-border bg-paper-card p-3 text-xs text-paper-ink shadow-float"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-paper-bg p-0.5 text-xs">
              <button
                type="button"
                aria-pressed={draft.provider === 'free'}
                onClick={() => setDraft({ ...draft, provider: 'free' })}
                className={clsx(
                  'rounded-md py-1 font-medium transition',
                  draft.provider === 'free'
                    ? 'bg-paper-card text-paper-ink shadow-sm'
                    : 'text-paper-muted hover:text-paper-ink',
                )}
              >
                {t('translate.free')}
              </button>
              <button
                type="button"
                aria-pressed={draft.provider === 'openai'}
                onClick={() => setDraft({ ...draft, provider: 'openai' })}
                className={clsx(
                  'rounded-md py-1 font-medium transition',
                  draft.provider === 'openai'
                    ? 'bg-paper-card text-paper-ink shadow-sm'
                    : 'text-paper-muted hover:text-paper-ink',
                )}
              >
                {t('translate.custom')}
              </button>
            </div>

            <div
              role="group"
              aria-label={t('translate.target')}
              className="grid grid-cols-2 gap-0.5 rounded-lg bg-paper-bg p-0.5 text-[11px]"
            >
              <button
                type="button"
                aria-pressed={draft.targetLang === 'zh-CN'}
                onClick={() => setDraft({ ...draft, targetLang: 'zh-CN' })}
                className={clsx(
                  'rounded-md px-2 py-1 font-medium transition',
                  draft.targetLang === 'zh-CN'
                    ? 'bg-paper-card text-paper-ink shadow-sm'
                    : 'text-paper-muted hover:text-paper-ink',
                )}
              >
                {t('translate.zhShort')}
              </button>
              <button
                type="button"
                aria-pressed={draft.targetLang === 'en'}
                onClick={() => setDraft({ ...draft, targetLang: 'en' })}
                className={clsx(
                  'rounded-md px-2 py-1 font-medium transition',
                  draft.targetLang === 'en'
                    ? 'bg-paper-card text-paper-ink shadow-sm'
                    : 'text-paper-muted hover:text-paper-ink',
                )}
              >
                EN
              </button>
            </div>
          </div>

          {draft.provider === 'openai' && (
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5 text-[11px] text-paper-muted">{t('translate.presets')}</span>
                {TRANSLATE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        provider: 'openai',
                        apiBaseUrl: preset.apiBaseUrl,
                        model: preset.model,
                      })
                    }
                    className="rounded border border-paper-border bg-paper-bg px-1.5 py-0.5 text-[11px] text-paper-ink transition hover:border-paper-gold"
                  >
                    {t(preset.labelKey)}
                  </button>
                ))}
              </div>
              <label className="block text-xs text-paper-muted">
                {t('translate.endpoint')}
                <input
                  type="url"
                  required
                  value={draft.apiBaseUrl}
                  onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })}
                  placeholder={t('translate.baseUrl')}
                  className={fieldClass}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-paper-muted">
                  {t('translate.model')}
                  <input
                    required
                    value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    placeholder={t('translate.modelHint')}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs text-paper-muted">
                  {t('translate.optionalKey')}
                  <input
                    type="password"
                    autoComplete="off"
                    value={draft.apiKey}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                    placeholder={t('translate.apiKey')}
                    className={fieldClass}
                  />
                </label>
              </div>
            </div>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-paper-muted">
            {t(
              draft.provider === 'free'
                ? IS_EXTENSION_PAGE
                  ? 'translate.freeNotice'
                  : 'translate.webFreeNotice'
                : !draft.apiKey && !/^http:\/\/(?:localhost|127\.0\.0\.1)\b/i.test(draft.apiBaseUrl)
                  ? 'translate.keyFallback'
                  : 'translate.privacy',
            )}
          </p>

          {notice && (
            <p role="status" className="mt-1.5 text-xs text-paper-goldtext">
              {formatMessage(notice)}
            </p>
          )}

          <div className="mt-2.5 flex items-center justify-between">
            <button
              type="button"
              disabled={!config.apiKey}
              onClick={() => void handleClearKey()}
              className="rounded px-2 py-1 text-xs text-paper-muted hover:bg-paper-bg disabled:opacity-40"
            >
              {t('settings.clearKey')}
            </button>
            <button
              type="submit"
              className="rounded-lg bg-paper-ink px-3 py-1.5 text-xs font-medium text-paper-card transition hover:opacity-90"
            >
              {t('settings.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
