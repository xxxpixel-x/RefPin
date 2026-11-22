import { t } from '../../i18n/core';
import clsx from 'clsx';
import type { TranslateConfig } from '../protocol';

interface TranslateSettingsBarProps {
  config: TranslateConfig;
  onChange: (next: TranslateConfig) => void;
  onClose: () => void;
}

export function TranslateSettingsBar({
  config,
  onChange,
  onClose,
}: TranslateSettingsBarProps) {
  return (
    <div className="shrink-0 border-b border-paper-border bg-paper-bg px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-paper-bg p-0.5 text-[11px]">
          <button
            type="button"
            aria-pressed={config.provider === 'free'}
            onClick={() => onChange({ ...config, provider: 'free' })}
            className={clsx(
              'rounded-md py-1 font-medium transition',
              config.provider === 'free'
                ? 'bg-paper-card text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            {t('translate.free')}
          </button>
          <button
            type="button"
            aria-pressed={config.provider === 'openai'}
            onClick={() => onChange({ ...config, provider: 'openai' })}
            className={clsx(
              'rounded-md py-1 font-medium transition',
              config.provider === 'openai'
                ? 'bg-paper-card text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            {t('translate.custom')}
          </button>
        </div>

        <div role="group" aria-label={t('translate.target')} title={t('translate.target')} className="grid grid-cols-2 gap-0.5 rounded-lg bg-paper-bg p-0.5 text-[10.5px]">
          <button
            type="button"
            aria-label={t('language.chinese')}
            aria-pressed={config.targetLang === 'zh-CN'}
            onClick={() => onChange({ ...config, targetLang: 'zh-CN' })}
            className={clsx(
              'rounded-md px-2 py-1 font-medium transition',
              config.targetLang === 'zh-CN'
                ? 'bg-paper-card text-paper-ink shadow-sm'
                : 'text-paper-muted',
            )}
          >
            {t('translate.zhShort')}
          </button>
          <button
            type="button"
            aria-label={t('language.english')}
            aria-pressed={config.targetLang === 'en'}
            onClick={() => onChange({ ...config, targetLang: 'en' })}
            className={clsx(
              'rounded-md px-2 py-1 font-medium transition',
              config.targetLang === 'en'
                ? 'bg-paper-card text-paper-ink shadow-sm'
                : 'text-paper-muted',
            )}
          >
            EN
          </button>
        </div>
      </div>

      {config.provider === 'free' && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-paper-muted">{t('translate.freeNotice')}</p>
      )}
      {config.provider === 'openai' && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            value={config.apiBaseUrl}
            onChange={(e) => onChange({ ...config, apiBaseUrl: e.target.value })}
            placeholder={t('translate.baseUrl')}
            className="w-full rounded-lg border border-paper-border bg-paper-card px-2.5 py-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-paper-gold"
          />
          <div className="flex gap-1.5">
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
              placeholder={t('translate.apiKey')}
              className="min-w-0 flex-1 rounded-lg border border-paper-border bg-paper-card px-2.5 py-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-paper-gold"
            />
            <input
              value={config.model}
              onChange={(e) => onChange({ ...config, model: e.target.value })}
              placeholder={t('translate.modelName')}
              className="w-28 rounded-lg border border-paper-border bg-paper-card px-2.5 py-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-paper-gold"
            />
          </div>
          {!config.apiKey.trim() && <p className="text-[10.5px] leading-relaxed text-paper-muted">{t('translate.keyFallback')}</p>}
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-paper-ink px-2.5 py-1 text-[10.5px] font-medium text-paper-card transition hover:opacity-90"
        >
          {t('common.done')}
        </button>
      </div>
    </div>
  );
}
