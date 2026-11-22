import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useI18n } from '../../i18n';

interface Props {
  query: string;
  index: number;
  count: number;
  onQuery: (query: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
}

export function SearchBar({ query, index, count, onQuery, onStep, onClose }: Props) {
  const { t } = useI18n();
  return <form role="search" aria-label={t('search.find')} onSubmit={event => event.preventDefault()}
    className="absolute right-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border border-paper-border bg-paper-card px-2 py-1.5 text-paper-ink shadow-float">
    <Search size={14} className="shrink-0 text-paper-muted" />
    <input autoFocus value={query} onChange={event => onQuery(event.target.value)}
      aria-label={t('search.find')} placeholder={t('search.find')}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
      }}
      className="w-40 min-w-0 bg-transparent px-1 text-xs outline-none placeholder:text-paper-muted" />
    <output aria-live="polite" className="whitespace-nowrap px-1 font-mono text-[11px] text-paper-muted">{count ? (index + 1) + ' / ' + count : '0'}</output>
    {([-1, 1] as const).map(delta => {
      const Icon = delta < 0 ? ChevronUp : ChevronDown;
      const title = t(delta < 0 ? 'search.previous' : 'search.next');
      return <button key={delta} type="button" title={title} aria-label={title} disabled={!count}
        onClick={() => onStep(delta)} className="rounded p-1 hover:bg-paper-bg disabled:opacity-30"><Icon size={14} /></button>;
    })}
    <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded p-1 hover:bg-paper-bg"><X size={13} /></button>
  </form>;
}
