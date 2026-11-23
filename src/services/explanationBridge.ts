import { LocalizedError, message } from '../i18n/core';
import type { TranslateTargetLang } from './translator';

export function streamExtensionExplanation(text: string, targetLang: TranslateTargetLang, allowRemote: boolean,
  signal: AbortSignal, emit: (delta: string) => void): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const origin = location.origin;
    const send = (type: string, fields = {}) => window.postMessage({ source: 'refpin-web', type, requestId, ...fields }, origin);
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      window.removeEventListener('message', receive);
      send('REFPIN_EXT_EXPLAIN_STOP');
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new LocalizedError(message('translate.timeout'))), 120_000);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== origin || data?.source !== 'refpin-extension' ||
          data.type !== 'REFPIN_EXT_EXPLAIN' || data.requestId !== requestId) return;
      const part = data.payload;
      if (typeof part?.delta === 'string') { resetTimer(); emit(part.delta); }
      else if (part?.done) finish();
      else finish(new LocalizedError(part?.error ?? message('translate.requestFailed')));
    };
    signal.addEventListener('abort', abort, { once: true });
    window.addEventListener('message', receive);
    resetTimer();
    send('REFPIN_EXT_EXPLAIN', { text, targetLang, allowRemote });
  });
}
