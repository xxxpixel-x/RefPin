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
    <div className="shrink-0 border-b border-paper-border bg-stone-50/90 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-stone-200/70 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => onChange({ ...config, provider: 'free' })}
            className={clsx(
              'rounded-md py-1 font-medium transition',
              config.provider === 'free'
                ? 'bg-white text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            免费内置
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, provider: 'openai' })}
            className={clsx(
              'rounded-md py-1 font-medium transition',
              config.provider === 'openai'
                ? 'bg-white text-paper-ink shadow-sm'
                : 'text-paper-muted hover:text-paper-ink',
            )}
          >
            自定义 API
          </button>
        </div>

        <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-stone-200/70 p-0.5 text-[10.5px]">
          <button
            type="button"
            onClick={() => onChange({ ...config, targetLang: 'zh-CN' })}
            className={clsx(
              'rounded-md px-2 py-1 font-medium transition',
              config.targetLang === 'zh-CN'
                ? 'bg-white text-paper-ink shadow-sm'
                : 'text-paper-muted',
            )}
          >
            中
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, targetLang: 'en' })}
            className={clsx(
              'rounded-md px-2 py-1 font-medium transition',
              config.targetLang === 'en'
                ? 'bg-white text-paper-ink shadow-sm'
                : 'text-paper-muted',
            )}
          >
            EN
          </button>
        </div>
      </div>

      {config.provider === 'openai' && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            value={config.apiBaseUrl}
            onChange={(e) => onChange({ ...config, apiBaseUrl: e.target.value })}
            placeholder="Base URL（如 https://api.deepseek.com/v1）"
            className="w-full rounded-lg border border-paper-border bg-white px-2.5 py-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-amber-300"
          />
          <div className="flex gap-1.5">
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
              placeholder="API Key"
              className="min-w-0 flex-1 rounded-lg border border-paper-border bg-white px-2.5 py-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-amber-300"
            />
            <input
              value={config.model}
              onChange={(e) => onChange({ ...config, model: e.target.value })}
              placeholder="模型名"
              className="w-28 rounded-lg border border-paper-border bg-white px-2.5 py-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-amber-300"
            />
          </div>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-paper-ink px-2.5 py-1 text-[10.5px] font-medium text-white transition hover:bg-stone-800"
        >
          完成
        </button>
      </div>
    </div>
  );
}
