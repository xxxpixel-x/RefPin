import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useReaderStore } from '../../store/useReaderStore';

export function ReturnBanner({ onNavigate }: { onNavigate: (direction: 'back' | 'forward') => void }) {
  const { t } = useI18n();
  const history = useReaderStore(state => state.jumpHistory);
  const cursor = useReaderStore(state => state.historyCursor);
  const visible = useReaderStore(state => state.historyVisible);
  const place = history[cursor - 1]?.origin ?? history[cursor]?.target;
  if (!visible || !place) return null;
  return <nav aria-label={t('reader.return')} className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
    <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-paper-border bg-paper-card/95 px-2 py-1 text-xs text-paper-ink shadow-float">
      {(['back', 'forward'] as const).map(direction => {
        const back = direction === 'back';
        const Icon = back ? ArrowLeft : ArrowRight;
        const title = t(back ? 'history.back' : 'history.forward');
        return <button key={direction} type="button" title={title} aria-label={title}
          disabled={back ? cursor === 0 : cursor === history.length} onClick={() => onNavigate(direction)}
          className="rounded-full p-1.5 hover:bg-paper-bg disabled:opacity-30"><Icon size={14} /></button>;
      })}
      <span className="max-w-40 truncate border-l border-paper-border px-2">{place.label && place.label + ' · '}{t('reader.page', { page: place.pageNumber })}</span>
      <kbd className="hidden text-[10px] text-paper-muted sm:inline">Alt+←/→</kbd>
      <button type="button" onClick={useReaderStore.getState().dismissHistory} aria-label={t('reader.dismissReturn')}
        className="rounded-full p-1.5 text-paper-muted hover:bg-paper-bg"><X size={12} /></button>
    </div>
  </nav>;
}
