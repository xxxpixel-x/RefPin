import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useReaderStore } from '../../store/useReaderStore';
import type { NormalizedRect, OutlineItem, PaperAsset, ReferenceEntry } from '../../types/paper';
import { pageQuery, rankCommands, type SearchableCommand } from './commandMatcher';

interface Command extends SearchableCommand { category: string; run: () => void; pin?: () => void }
interface Props {
  onClose: () => void;
  onJump: (page: number, rect?: NormalizedRect, label?: string) => void;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (ref: ReferenceEntry) => void;
  onExport: (mode: 'copy' | 'zip') => void;
  onHome: () => void;
  onSearch: () => void;
}

export function CommandPalette({ onClose, onJump, onPinAsset, onPinReference, onExport, onHome, onSearch }: Props) {
  const { t, locale, setLocale } = useI18n();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const assets = useReaderStore(s => s.assetsMap);
  const refs = useReaderStore(s => s.referencesMap);
  const outline = useReaderStore(s => s.outline);
  const glossary = useReaderStore(s => s.glossaryMap);
  const numPages = useReaderStore(s => s.numPages);
  const commands = useMemo(() => {
    const state = useReaderStore.getState;
    const actions = [
      ['snip.free', () => state().setSnipMode(!state().snipMode)],
      ['dock.autoSync', () => state().setAutoSyncEnabled(!state().autoSyncEnabled)],
      ['ruler.toggle', () => state().setReadingRulerEnabled(!state().readingRulerEnabled)],
      ...(['light','sepia','dark'] as const).map(theme => [`theme.${theme}`, () => state().setTheme(theme)] as const),
      ['scholar.toggle', () => state().setScholarLookupEnabled(!state().scholarLookupEnabled)],
      ['notes.copy', () => onExport('copy')], ['notes.zip', () => onExport('zip')],
      ['language.switch', () => setLocale(locale === 'en' ? 'zh-CN' : 'en')],
      ['search.find', onSearch], ['assets.title', () => state().setDrawerOpen(!state().drawerOpen)],
      ['dock.clearAll', () => state().clearPinnedItems()], ['reader.home', onHome],
    ] as const;
    const rows: Command[] = [];
    for (const [key, run] of actions) {
      if (!numPages && !key.startsWith('theme.') && key !== 'language.switch' && key !== 'scholar.toggle') continue;
      rows.push({ id: key, label: t(key), keywords: key, category: t('palette.actions'), run });
    }
    for (const asset of Object.values(assets)) rows.push({
      id: asset.key, label: asset.label, shortcut: asset.key, keywords: asset.caption,
      category: t('reader.page', { page: asset.pageNumber }),
      run: () => onJump(asset.pageNumber, asset.cropRect, asset.label), pin: () => onPinAsset(asset),
    });
    function addHeadings(items: OutlineItem[]) {
      for (const item of items) {
        const page = item.pageNumber;
        if (page !== null) rows.push({ id: 'outline-' + item.id, label: item.title, category: t('outline.title'),
          run: () => onJump(page, item.destY === undefined ? undefined : { x: 0.05, y: item.destY, width: 0.9, height: 0.018 }, item.title) });
        addHeadings(item.children);
      }
    }
    addHeadings(outline);
    for (const ref of Object.values(refs)) rows.push({
      id: ref.key, label: t('reference.number', { index: ref.index }) + ' · ' + (ref.title || ref.rawText), shortcut: 'ref-' + ref.index,
      keywords: [ref.authors, ref.year, ref.rawText].join(' '), category: t('kind.reference'),
      run: () => onJump(ref.pageNumber, undefined, t('reference.number', { index: ref.index })), pin: () => onPinReference(ref),
    });
    for (const entry of Object.values(glossary)) rows.push({
      id: 'term-' + entry.term, label: entry.term + ' · ' + entry.expansion, category: t('glossary.title'),
      run: () => onJump(entry.definedPage, entry.definedRect, entry.term),
    });
    return rows;
  }, [assets, refs, outline, glossary, numPages, locale, setLocale, t, onJump, onPinAsset, onPinReference, onExport, onSearch, onHome]);

  const results = useMemo(() => {
    const page = pageQuery(query);
    if (page !== undefined) return page <= numPages ? [{ id: 'page', label: t('palette.page', { page }),
      category: '', run: () => onJump(page) } as Command] : [];
    return rankCommands(commands, query).slice(0, 100);
  }, [commands, query, numPages, onJump, t]);
  const index = Math.min(selected, results.length - 1);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  useEffect(() => { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }); }, [index]);
  const execute = (command: Command | undefined, pin: boolean) => {
    if (!command || (pin && !command.pin)) return;
    onClose();
    if (pin) command.pin?.(); else command.run();
  };

  return <dialog ref={dialog} aria-label={t('palette.title')} onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === dialog.current) onClose(); }}
    className="fixed inset-x-0 bottom-auto top-[12vh] m-0 mx-auto w-[min(34rem,94vw)] rounded-xl border border-paper-border bg-paper-card p-0 text-paper-ink shadow-float backdrop:bg-black/30">
    <div onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length) setSelected((index + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault(); execute(results[index], e.shiftKey);
      }
    }}>
      <div className="flex items-center gap-3 border-b border-paper-border px-4 py-3">
        <Search size={16} className="text-paper-muted" />
        <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} role="combobox"
          aria-label={t('palette.title')} aria-expanded aria-controls="command-list" aria-autocomplete="list"
          aria-activedescendant={index < 0 ? undefined : 'command-' + index} placeholder={t('palette.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <button onClick={onClose} aria-label={t('common.close')} className="rounded p-1 text-paper-muted hover:bg-paper-bg"><X size={14} /></button>
      </div>
      <div ref={list} role="listbox" id="command-list" aria-label={t('palette.title')} className="max-h-[50vh] overflow-y-auto p-1.5">
        {results.map((command, i) => <button type="button" tabIndex={-1} id={'command-' + i} role="option" aria-selected={i === index}
          key={command.id} onMouseDown={e => e.preventDefault()} onClick={e => execute(command, e.shiftKey)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs hover:bg-paper-bg aria-selected:bg-paper-goldbg">
          <span className="flex-1 truncate">{command.label}</span><span className="text-[10px] text-paper-muted">{command.category}</span>
        </button>)}
      </div>
      {!results.length && <p className="px-4 pb-4 text-xs text-paper-muted">{t('palette.empty')}</p>}
      <footer className="border-t border-paper-border px-4 py-2 text-[10px] text-paper-muted">{t('palette.keys')}</footer>
    </div>
  </dialog>;
}
