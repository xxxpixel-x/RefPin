import { IS_EXTENSION_PAGE } from '../../config/runtime';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react';
import { describeError, formatMessage, message, t, type DisplayMessage } from '../../i18n';
import { openRemotePdf, parsePaperLocation, publicHttpsUrl, type PaperLocation } from '../../services/arxivFetch';

interface Props {
  initialArxiv?: string;
  onOpenFile: (file: File) => void;
  onConsumeLink?: () => void;
}

const proxyKey = 'refpin.proxyPrefix.v1';
export function RemotePaperInput({ initialArxiv, onOpenFile, onConsumeLink }: Props) {
  const [input, setInput] = useState(initialArxiv || '');
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<DisplayMessage>();
  const [failed, setFailed] = useState<PaperLocation | null>(null);
  const [proxy, setProxy] = useState(() => {
    try { return localStorage.getItem(proxyKey) || ''; } catch { return ''; }
  });
  const active = useRef<AbortController>();
  const open = useCallback(async (value: string, prefix = '') => {
    active.current?.abort();
    const paper = parsePaperLocation(value);
    setInvalid(!paper);
    setFailed(null);
    setLoading(!!paper);
    if (!paper) return;
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const file = await openRemotePdf(paper, controller.signal, prefix);
      if (!controller.signal.aborted) onOpenFile(file);
    } catch (reason) {
      if (active.current === controller) {
        setError(describeError(reason, message('panel.fetchFailed')));
        setFailed(paper);
      }
    } finally {
      clearTimeout(timer);
      if (active.current === controller) setLoading(false);
    }
  }, [onOpenFile]);

  useEffect(() => () => {
    active.current?.abort();
    active.current = undefined;
  }, []);
  useEffect(() => {
    if (!initialArxiv) return;
    // Defer until mount settles so StrictMode cannot dispatch a duplicate request.
    const timer = setTimeout(() => {
      onConsumeLink?.();
      const paper = parsePaperLocation(initialArxiv);
      if (paper?.canonicalAbsUrl?.startsWith('https://arxiv.org/abs/')) void open(initialArxiv);
      else setInvalid(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialArxiv, onConsumeLink, open]);

  return <section className="mt-3">
    <form onSubmit={e => { e.preventDefault(); void open(input); }}>
      <label htmlFor="paper-address" className="sr-only">{t('remote.label')}</label>
      <div className="flex items-center gap-2 rounded-lg border border-paper-border bg-paper-card p-1 focus-within:border-paper-gold">
        <input id="paper-address" type="text" value={input} autoComplete="off" spellCheck={false}
          placeholder={t(IS_EXTENSION_PAGE ? 'remote.extensionPlaceholder' : 'remote.placeholder')} aria-invalid={invalid}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-paper-ink outline-none"
          onChange={e => {
            active.current?.abort(); active.current = undefined;
            setLoading(false); setInput(e.target.value); setFailed(null); setInvalid(false);
          }} />
        <button disabled={loading || !input.trim()} className="flex items-center gap-2 rounded-md bg-paper-bg px-3 py-1.5 text-xs text-paper-ink disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
          {t(loading ? 'remote.loading' : 'remote.open')}
        </button>
      </div>
    </form>
    {invalid && <p role="alert" className="mt-2 text-xs text-paper-goldtext">{t(IS_EXTENSION_PAGE ? 'remote.extensionInvalid' : 'remote.invalid')}</p>}
    {failed && <div className="mt-2 rounded-lg border border-paper-border bg-paper-card p-3 text-xs text-paper-muted">
      <p role="status">{IS_EXTENSION_PAGE ? formatMessage(error) : t('remote.help')}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-paper-goldtext">
        {/^https?:/.test(failed.pdfUrl) && <a href={failed.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
          {t('remote.download', { host: new URL(failed.pdfUrl).hostname })}<ExternalLink size={11} /></a>}
        {!IS_EXTENSION_PAGE && <a href="https://github.com/xxxpixel-x/RefPin/releases/latest" target="_blank" rel="noreferrer">{t('remote.install')}</a>}
      </div>
      {!IS_EXTENSION_PAGE && <details className="mt-3"><summary className="cursor-pointer">{t('remote.proxy')}</summary>
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={e => {
          e.preventDefault();
          const prefix = proxy.trim();
          if (!publicHttpsUrl(prefix)) return;
          try { localStorage.setItem(proxyKey, prefix); } catch { /* Optional storage. */ }
          void open(input, prefix);
        }}>
          <label htmlFor="proxy-prefix" className="sr-only">{t('remote.proxyHint')}</label>
          <input id="proxy-prefix" type="url" value={proxy} onChange={e => setProxy(e.target.value)} placeholder="https://…/?url="
            className="min-w-0 flex-1 rounded border border-paper-border bg-paper-bg px-2 py-1 text-paper-ink" />
          <button disabled={!publicHttpsUrl(proxy.trim())} className="rounded px-2 py-1 text-paper-goldtext disabled:opacity-50">{t('remote.retry')}</button>
        </form>
      </details>}
    </div>}
  </section>;
}
