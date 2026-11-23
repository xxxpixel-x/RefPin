import { useRef, useState } from 'react';
import { formatMessage, message, t } from '../../i18n/core';
import type { LocalizedMessage } from '../../i18n/types';
import { translationFailure, type TranslateConfig, type TranslateConfigSummary } from '../../services/translator';

interface Props {
  config: TranslateConfig | TranslateConfigSummary;
  onTest: () => Promise<unknown>;
}

export function TranslateConnectionTest({ config, onTest }: Props) {
  const [attempt, setAttempt] = useState<{ config: Props['config']; result?: LocalizedMessage } | null>(null);
  const generation = useRef(0);
  const current = attempt?.config === config ? attempt : null;
  const testing = current !== null && !current.result;

  const test = async () => {
    const id = ++generation.current;
    setAttempt({ config });
    let result: LocalizedMessage;
    try {
      await onTest();
      result = message('translate.connectionSuccess');
    } catch (error) {
      result = translationFailure(error);
    }
    if (id === generation.current) setAttempt({ config, result });
  };

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[11px] leading-relaxed text-paper-muted">{t('translate.privacy')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={testing} onClick={() => void test()}
          className="rounded-md border border-paper-border px-2.5 py-1 text-xs text-paper-ink hover:bg-paper-bg disabled:opacity-60">
          {t(testing ? 'translate.testingConnection' : 'translate.testConnection')}
        </button>
        <span role="status" className="text-xs text-paper-ink">{formatMessage(current?.result)}</span>
      </div>
    </div>
  );
}
