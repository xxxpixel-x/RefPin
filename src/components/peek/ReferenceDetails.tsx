import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/core';
import { buildFallbackBibtex, getCachedScholarMetadata, lookupScholarMetadata } from '../../services/scholarLookup';
import { useReaderStore } from '../../store/useReaderStore';
import type { ReferenceEntry } from '../../types/paper';

export function ReferenceDetails({ reference, deferUntilVisible = false }: { reference: ReferenceEntry; deferUntilVisible?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const enabled = useReaderStore(state => state.scholarLookupEnabled);
  const setEnabled = useReaderStore(state => state.setScholarLookupEnabled);
  const [metadata, setMetadata] = useState(() => getCachedScholarMetadata(reference));
  const [copied, setCopied] = useState<'ready' | 'done' | 'failed'>('ready');
  useEffect(() => {
    setMetadata(getCachedScholarMetadata(reference));
    if (!enabled) return;
    const controller = new AbortController();
    const lookup = () => {
      void lookupScholarMetadata(reference, controller.signal).then(result => {
        if (!controller.signal.aborted && result) setMetadata(result);
      });
    };
    // A panel can contain hundreds of references. Enrich each card when it is read.
    let observer: IntersectionObserver | undefined;
    if (deferUntilVisible && card.current && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          lookup();
        }
      });
      observer.observe(card.current);
    } else lookup();
    return () => { observer?.disconnect(); controller.abort(); };
  }, [reference, enabled, deferUntilVisible]);
  useEffect(() => {
    if (copied === 'ready') return;
    const timer = setTimeout(() => setCopied('ready'), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return <div ref={card} className="mt-2 space-y-2 border-t border-paper-border pt-2 text-[11px]">
    <label className="flex cursor-pointer items-center gap-1.5 text-paper-muted">
      <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}
        className="accent-paper-gold" />{t('scholar.toggle')}
    </label>
    {enabled && metadata && <div className="flex flex-wrap items-center gap-1.5 text-paper-muted">
      {metadata.citedByCount !== undefined && <span className="rounded-full bg-paper-goldbg px-2 py-0.5 text-paper-goldtext">
        {t('scholar.cited', { count: metadata.citedByCount })}</span>}
      {metadata.venue && <span>{metadata.venue}</span>}
      {metadata.openAccessPdfUrl?.startsWith('https://') && <a href={metadata.openAccessPdfUrl} target="_blank" rel="noreferrer"
        className="text-paper-goldtext underline">{t('scholar.pdf')}</a>}
      {metadata.abstractText && <details className="group/abstract w-full"><summary className="cursor-pointer">
        {t('scholar.abstract')}<span className="mt-1 line-clamp-3 group-open/abstract:hidden">{metadata.abstractText}</span>
      </summary><p className="mt-1 leading-relaxed">{metadata.abstractText}</p></details>}
    </div>}
    <button type="button" className="rounded border border-paper-border bg-paper-card px-2 py-1 text-paper-ink hover:bg-paper-goldbg"
      onClick={async () => {
        try { await navigator.clipboard.writeText(metadata?.bibtex || buildFallbackBibtex(reference)); setCopied('done'); }
        catch { setCopied('failed'); }
      }}>{t(copied === 'done' ? 'common.copied' : copied === 'failed' ? 'notes.copyFailed' : 'reference.copyBibtex')}</button>
  </div>;
}
