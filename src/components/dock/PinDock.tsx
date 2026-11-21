import { useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, Pin } from 'lucide-react';
import type { PinnedItem } from '../../types/paper';
import { PinnedCard } from './PinnedCard';

interface PinDockProps {
  items: PinnedItem[];
  onUnpin: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onJump: (pageNumber: number, cropRect?: PinnedItem['cropRect']) => void;
  onExpandCrop: (id: string, direction: 'up' | 'down') => void;
  onOpenLightbox: (item: PinnedItem) => void;
  onRename: (id: string, title: string) => void;
  onClear: () => void;
}

export function PinDock({
  items,
  onUnpin,
  onToggleCollapse,
  onJump,
  onExpandCrop,
  onOpenLightbox,
  onRename,
  onClear,
}: PinDockProps) {
  const [width, setWidth] = useState(388);
  const [order, setOrder] = useState<string[]>([]);
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setOrder((previous) => {
      const ids = items.map((item) => item.id);
      const kept = previous.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      return [...added, ...kept];
    });
  }, [items]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!resizing.current) return;
      const delta = resizing.current.startX - event.clientX;
      setWidth(Math.min(520, Math.max(320, resizing.current.startWidth + delta)));
    };
    const onUp = () => {
      resizing.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const orderedItems = useMemo(
    () =>
      order
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is PinnedItem => Boolean(item)),
    [order, items],
  );

  const move = (id: string, direction: -1 | 1) => {
    setOrder((previous) => {
      const index = previous.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <aside
      style={{ width }}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-paper-border bg-[#FBFAF8]"
    >
      <button
        type="button"
        aria-label="拖拽调整钉板宽度"
        className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize transition hover:bg-paper-goldborder/60"
        onMouseDown={(event) => {
          resizing.current = { startX: event.clientX, startWidth: width };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />

      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-paper-border px-3">
        <Pin className="h-3.5 w-3.5 text-paper-gold" />
        <span className="text-xs font-medium text-paper-ink">
          对照钉板
          <span className="ml-1 font-mono text-[10px] text-paper-muted">({items.length})</span>
        </span>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-paper-muted transition hover:bg-white hover:text-red-500"
          >
            <Eraser className="h-3 w-3" /> 清空
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {orderedItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-paper-border bg-white text-paper-muted">
              <Pin className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[11px] font-medium text-paper-ink">钉板还是空的</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-paper-muted">
              点击正文里的金色
              <span className="mx-0.5 rounded bg-paper-goldbg px-1 text-paper-goldtext">
                Fig. / Table / [14]
              </span>
              ，或用顶部「框选钉住」，把要对照的图钉在这里，边滚正文边看。
            </p>
          </div>
        ) : (
          orderedItems.map((item) => (
            <PinnedCard
              key={item.id}
              item={item}
              onUnpin={onUnpin}
              onToggleCollapse={onToggleCollapse}
              onJump={onJump}
              onExpandCrop={onExpandCrop}
              onOpenLightbox={onOpenLightbox}
              onRename={onRename}
              onMove={move}
            />
          ))
        )}
      </div>
    </aside>
  );
}
