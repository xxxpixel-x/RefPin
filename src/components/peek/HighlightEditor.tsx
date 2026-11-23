import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { Highlight } from '../../types/paper';

type Color = Highlight['color'];
export interface MenuPoint { x: number; y: number }

export function HighlightColors({ value, onChoose }: { value?: Color; onChoose: (color: Color) => void }) {
  const { t } = useI18n();
  return <div role="group" aria-label={t('highlight.colors')} className="flex items-center">
    {(['amber', 'green', 'blue', 'rose'] as const).map(color =>
      <button key={color} type="button" title={t(`highlight.${color}`)} aria-label={t(`highlight.${color}`)}
        aria-pressed={value === undefined ? undefined : value === color} onClick={() => onChoose(color)}
        className="grid h-8 w-8 place-items-center rounded hover:bg-paper-bg">
        <span data-ink={color} className="highlight-swatch grid h-5 w-5 place-items-center rounded-full">
          {value === color && <Check aria-hidden size={14} />}
        </span>
      </button>)}
  </div>;
}

interface Props {
  point: MenuPoint;
  highlight?: Highlight;
  onSave: (color: Color, note?: string) => void;
  onClose: () => void;
  onDelete?: () => void;
}

export function HighlightEditor({ point, highlight, onSave, onClose, onDelete }: Props) {
  const { t } = useI18n();
  const [color, setColor] = useState<Color>(highlight?.color ?? 'amber');
  const [note, setNote] = useState(highlight?.note ?? '');
  const menu = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    function place() {
      const rect = menu.current!.getBoundingClientRect();
      setPosition({
        x: Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(point.y + 6, window.innerHeight - rect.height - 8)),
      });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [point]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  return createPortal(<form ref={menu} role="dialog" aria-label={t('highlight.annotation')}
    style={{ left: position.x, top: position.y }}
    className="fixed z-[60] w-64 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-auto rounded-lg border border-paper-border bg-paper-card p-3 text-xs text-paper-ink shadow-float"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    onSubmit={event => { event.preventDefault(); onSave(color, note.trim() || undefined); }}>
    <label className="block font-medium">{t('highlight.annotation')}
      <textarea autoFocus rows={3} value={note} onChange={event => setNote(event.target.value)}
        className="mt-1.5 w-full resize-none rounded border border-paper-border bg-paper-bg p-2 font-normal focus:border-paper-gold" />
    </label>
    <div className="flex items-center justify-between">
      <HighlightColors value={color} onChoose={setColor} />
      {onDelete && <button type="button" title={t('highlight.delete')} aria-label={t('highlight.delete')}
        className="rounded p-2 text-paper-muted hover:bg-paper-bg" onClick={onDelete}><Trash2 size={15} /></button>}
    </div>
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" className="rounded px-2 py-1.5 hover:bg-paper-bg" onClick={onClose}>{t('common.cancel')}</button>
      <button className="rounded bg-paper-ink px-3 py-1.5 font-medium text-paper-card">{t('highlight.save')}</button>
    </div>
  </form>, document.body);
}
