import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Maximize2,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { PinnedItem } from '../../types/paper';

interface PinnedCardProps {
  item: PinnedItem;
  onUnpin: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onJump: (pageNumber: number, cropRect?: PinnedItem['cropRect']) => void;
  onExpandCrop: (id: string, direction: 'up' | 'down') => void;
  onOpenLightbox: (item: PinnedItem) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

export function PinnedCard({
  item,
  onUnpin,
  onToggleCollapse,
  onJump,
  onExpandCrop,
  onOpenLightbox,
  onRename,
  onMove,
}: PinnedCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [copied, setCopied] = useState(false);

  useEffect(() => setDraft(item.title), [item.title]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const reference = item.reference;
  const isSnip = item.kind === 'snip';

  const bibtex = reference
    ? `@inproceedings{${reference.key},\n  title={${reference.title ?? ''}},\n  author={${reference.authors ?? ''}},\n  year={${reference.year ?? ''}}\n}`
    : '';

  return (
    <article className="group overflow-hidden rounded-xl border border-paper-border bg-white shadow-paper transition hover:shadow-float">
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className="shrink-0 rounded bg-paper-goldbg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {item.kind === 'snip' ? 'Snip' : item.kind}
        </span>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              onRename(item.id, draft.trim() || item.title);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onRename(item.id, draft.trim() || item.title);
                setEditing(false);
              }
              if (event.key === 'Escape') {
                setDraft(item.title);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 text-[11px] text-paper-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => isSnip && setEditing(true)}
            onClick={() => onJump(item.pageNumber, item.cropRect)}
            className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-paper-ink hover:text-paper-gold"
            title={isSnip ? '双击可重命名 · 点击跳回原页' : '点击跳回原页'}
          >
            {item.title}
          </button>
        )}

        <span className="shrink-0 font-mono text-[10px] text-paper-muted">P.{item.pageNumber}</span>
        <button
          type="button"
          onClick={() => onMove(item.id, -1)}
          className="rounded p-0.5 text-paper-muted opacity-0 transition hover:text-paper-ink group-hover:opacity-100"
          aria-label="上移"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onToggleCollapse(item.id)}
          className="rounded p-0.5 text-paper-muted transition hover:text-paper-ink"
          aria-label={item.collapsed ? '展开' : '收起'}
        >
          <ChevronDown
            className={clsx('h-3.5 w-3.5 transition-transform', item.collapsed && '-rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={() => onUnpin(item.id)}
          className="rounded p-0.5 text-paper-muted transition hover:text-red-500"
          aria-label="移除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!item.collapsed && (
        <div className="px-2.5 pb-2.5">
          {item.imageUrl ? (
            <div className="group/image relative overflow-hidden rounded-lg border border-paper-border bg-paper-bg">
              <img
                src={item.imageUrl}
                alt={item.title}
                className="max-h-[220px] w-full cursor-zoom-in object-contain"
                onClick={() => onOpenLightbox(item)}
              />
              <div className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 opacity-0 transition group-hover/image:opacity-100">
                <button
                  type="button"
                  onClick={() => onExpandCrop(item.id, 'up')}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-white/95 px-1.5 py-1 text-[9px] text-paper-ink shadow-sm transition hover:bg-white"
                >
                  <ArrowUpToLine className="h-2.5 w-2.5" /> 扩上
                </button>
                <button
                  type="button"
                  onClick={() => onExpandCrop(item.id, 'down')}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-white/95 px-1.5 py-1 text-[9px] text-paper-ink shadow-sm transition hover:bg-white"
                >
                  <ArrowDownToLine className="h-2.5 w-2.5" /> 扩下
                </button>
                <button
                  type="button"
                  onClick={() => onOpenLightbox(item)}
                  className="flex items-center gap-0.5 rounded-md border border-paper-border bg-white/95 px-1.5 py-1 text-[9px] text-paper-ink shadow-sm transition hover:bg-white"
                >
                  <Maximize2 className="h-2.5 w-2.5" /> 放大
                </button>
              </div>
            </div>
          ) : reference ? (
            <div className="rounded-lg bg-paper-bg px-2.5 py-2">
              <p className="text-[11px] font-medium leading-snug text-paper-ink">
                {reference.title || `参考文献 [${reference.index}]`}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                {reference.authors && (
                  <span className="text-paper-muted">{reference.authors}</span>
                )}
                {reference.year && (
                  <span className="rounded bg-paper-goldbg px-1 py-0.5 font-mono text-paper-goldtext">
                    {reference.year}
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-paper-muted">
                {reference.rawText}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(bibtex || reference.rawText);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                  className="flex items-center gap-1 rounded-md border border-paper-border bg-white px-1.5 py-1 text-[9px] text-paper-ink transition hover:bg-paper-goldbg"
                >
                  {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                  {copied ? '已复制' : '复制 BibTeX'}
                </button>
                <a
                  href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                    reference.title || reference.rawText,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md border border-paper-border bg-white px-1.5 py-1 text-[9px] text-paper-ink transition hover:bg-paper-goldbg"
                >
                  <Search className="h-2.5 w-2.5" /> Scholar
                  <ExternalLink className="h-2 w-2 text-paper-muted" />
                </a>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-paper-bg px-2.5 py-2 text-[10px] text-paper-muted">
              {item.subtitle || '暂无预览图'}
            </p>
          )}

          {item.imageUrl && item.subtitle && (
            <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-paper-muted">
              {item.subtitle}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
