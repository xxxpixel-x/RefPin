import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CornerDownRight,
  ExternalLink,
  Maximize2,
  Pin,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import { findAssetForCitation } from '../../engine/backlinks';
import type {
  InlineCitation,
  PaperAsset,
  ReferenceEntry,
} from '../../types/paper';

export interface PeekTrigger {
  citation: InlineCitation;
  anchorEl: HTMLElement;
}

interface HoverPeekCardProps {
  trigger: PeekTrigger | null;
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (reference: ReferenceEntry) => void;
  onJump: (
    pageNumber: number,
    targetRect?: InlineCitation['rect'],
    sourceRect?: InlineCitation['rect'],
  ) => void;
  onOpenLightbox: (asset: PaperAsset) => void;
  onPeek: (citation: InlineCitation) => void;
  fallbackPreview?: {
    citationId?: string;
    imageUrl: string;
    pageNumber: number;
    cropRect?: InlineCitation['rect'];
  } | null;
}

const KIND_LABEL: Record<InlineCitation['kind'], string> = {
  figure: 'Figure',
  table: 'Table',
  equation: 'Equation',
  reference: 'Reference',
};

const SHOW_DELAY = 120;
const HIDE_DELAY = 260;
const CARD_WIDTH = 344;

export function HoverPeekCard({
  trigger,
  assetsMap,
  referencesMap,
  onPinAsset,
  onPinReference,
  onJump,
  onOpenLightbox,
  onPeek,
  fallbackPreview,
}: HoverPeekCardProps) {
  const [activeTrigger, setActiveTrigger] = useState<PeekTrigger | null>(null);
  const [activeRefIndex, setActiveRefIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const enterTimer = useRef<number>();
  const leaveTimer = useRef<number>();
  const hoveringCard = useRef(false);
  const peekRef = useRef(onPeek);
  peekRef.current = onPeek;

  useEffect(() => {
    window.clearTimeout(enterTimer.current);
    window.clearTimeout(leaveTimer.current);
    if (!trigger) {
      if (!hoveringCard.current) {
        leaveTimer.current = window.setTimeout(() => setActiveTrigger(null), HIDE_DELAY);
      }
      return;
    }
    enterTimer.current = window.setTimeout(() => {
      setActiveTrigger(trigger);
      setActiveRefIndex(0);
      peekRef.current(trigger.citation);
    }, SHOW_DELAY);
    return () => window.clearTimeout(enterTimer.current);
  }, [trigger]);

  const citation = activeTrigger?.citation ?? null;

  const references = useMemo(() => {
    if (!citation || citation.kind !== 'reference') return [];
    return citation.targetKeys
      .map((key) => referencesMap[key])
      .filter((item): item is ReferenceEntry => Boolean(item));
  }, [citation, referencesMap]);

  const asset = useMemo(
    () => citation ? findAssetForCitation(citation, assetsMap) : undefined,
    [citation, assetsMap],
  );

  const activeReference = references[Math.min(activeRefIndex, references.length - 1)];

  const matchedFallback =
    fallbackPreview && (!fallbackPreview.citationId || fallbackPreview.citationId === citation?.id)
      ? fallbackPreview
      : null;

  const previewImage = asset?.imageUrl ?? matchedFallback?.imageUrl ?? null;

  const recalcPosition = useCallback(() => {
    if (!activeTrigger || !cardRef.current) return;
    const rect = activeTrigger.anchorEl.getBoundingClientRect();
    const height = cardRef.current.offsetHeight || 280;
    const gap = 10;
    const below = rect.bottom + gap + height < window.innerHeight - 12;
    const top = below ? rect.bottom + gap : Math.max(12, rect.top - height - gap);
    const left = Math.min(
      Math.max(12, rect.left - 16),
      window.innerWidth - CARD_WIDTH - 12,
    );
    setPosition({ left, top });
  }, [activeTrigger]);

  useEffect(() => {
    recalcPosition();
  }, [recalcPosition, activeRefIndex, asset, activeReference, fallbackPreview]);

  useEffect(() => {
    if (!activeTrigger) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hoveringCard.current = false;
        setActiveTrigger(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTrigger]);

  if (!activeTrigger || !citation) return null;

  const keepOpen = () => {
    hoveringCard.current = true;
    window.clearTimeout(leaveTimer.current);
  };

  const scheduleClose = () => {
    hoveringCard.current = false;
    leaveTimer.current = window.setTimeout(() => setActiveTrigger(null), HIDE_DELAY);
  };

  const closeNow = () => {
    hoveringCard.current = false;
    setActiveTrigger(null);
  };

  return createPortal(
    <div
      ref={cardRef}
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleClose}
      style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      className="animate-fade-in-up fixed z-50 overflow-hidden rounded-xl border border-paper-border bg-white shadow-float"
    >
      <div className="flex items-center gap-2 border-b border-paper-border bg-paper-bg/60 px-3 py-2">
        <span className="rounded bg-paper-goldbg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {KIND_LABEL[citation.kind]}
        </span>
        <span className="font-mono text-[10px] text-paper-muted">
          P.
          {asset?.pageNumber ??
            activeReference?.pageNumber ??
            citation.nativeDest?.pageNumber ??
            citation.pageNumber}
        </span>
        <span className="truncate text-[11px] text-paper-muted">{citation.rawText}</span>
        <button
          type="button"
          onClick={() => {
            closeNow();
            onJump(
              asset?.pageNumber ??
                activeReference?.pageNumber ??
                citation.nativeDest?.pageNumber ??
                citation.pageNumber,
              asset?.cropRect ?? fallbackPreview?.cropRect,
              citation.rect,
            );
          }}
          className="ml-auto rounded-md p-1 text-paper-muted transition hover:bg-white hover:text-paper-ink"
          title="跳去原页"
        >
          <CornerDownRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {citation.kind === 'reference' ? (
        <div className="p-3">
          {references.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {references.map((reference, index) => (
                <button
                  key={reference.key}
                  type="button"
                  onClick={() => setActiveRefIndex(index)}
                  className={clsx(
                    'rounded-md px-2 py-0.5 font-mono text-[10px] transition',
                    index === activeRefIndex
                      ? 'bg-paper-ink text-white'
                      : 'bg-paper-bg text-paper-muted hover:text-paper-ink',
                  )}
                >
                  [{reference.index}]
                </button>
              ))}
            </div>
          )}

          {activeReference ? (
            <>
              <p className="text-[13px] font-semibold leading-snug text-paper-ink">
                {activeReference.title || `参考文献 [${activeReference.index}]`}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                {activeReference.authors && (
                  <span className="rounded border border-paper-border px-1.5 py-0.5 text-paper-muted">
                    {activeReference.authors}
                  </span>
                )}
                {activeReference.year && (
                  <span className="rounded bg-paper-goldbg px-1.5 py-0.5 font-mono text-paper-goldtext">
                    {activeReference.year}
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-paper-muted">
                {activeReference.rawText}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPinReference(activeReference)}
                  className="flex items-center gap-1 rounded-lg bg-paper-gold px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-amber-700"
                >
                  <Pin className="h-3 w-3" />
                  钉住文献
                </button>
                <a
                  href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                    activeReference.title || activeReference.rawText,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-paper-border px-2.5 py-1.5 text-[11px] text-paper-ink transition hover:bg-paper-bg"
                >
                  <Search className="h-3 w-3" />
                  Google Scholar
                  <ExternalLink className="h-2.5 w-2.5 text-paper-muted" />
                </a>
              </div>
            </>
          ) : previewImage ? (
            <>
              <button
                type="button"
                onClick={() => {
                  closeNow();
                  onJump(
                    fallbackPreview?.pageNumber ??
                      citation.nativeDest?.pageNumber ??
                      citation.pageNumber,
                    fallbackPreview?.cropRect,
                    citation.rect,
                  );
                }}
                className="group block w-full overflow-hidden rounded-lg border border-paper-border bg-paper-bg"
              >
                <img
                  src={previewImage}
                  alt={citation.rawText}
                  onLoad={recalcPosition}
                  className="max-h-[300px] w-full object-contain transition group-hover:scale-[1.01]"
                />
                <span className="flex items-center justify-center gap-1 border-t border-paper-border bg-white py-1 text-[10px] text-paper-muted transition group-hover:text-paper-ink">
                  <CornerDownRight className="h-3 w-3" /> 点击前往目标位置
                </span>
              </button>
            </>
          ) : (
            <FallbackMessage citation={citation} />
          )}
        </div>
      ) : (
        <div className="p-3">
          {previewImage ? (
            <button
              type="button"
              onClick={() => {
                closeNow();
                if (asset) onOpenLightbox(asset);
                else if (fallbackPreview) onJump(fallbackPreview.pageNumber);
              }}
              className="group block w-full overflow-hidden rounded-lg border border-paper-border bg-paper-bg"
            >
              <img
                src={previewImage}
                alt={asset?.label ?? citation.rawText}
                onLoad={recalcPosition}
                className="max-h-[300px] w-full object-contain transition group-hover:scale-[1.01]"
              />
              <span className="flex items-center justify-center gap-1 border-t border-paper-border bg-white py-1 text-[10px] text-paper-muted transition group-hover:text-paper-ink">
                <Maximize2 className="h-3 w-3" /> 点击放大查看
              </span>
            </button>
          ) : (
            <FallbackMessage citation={citation} />
          )}

          {asset?.caption && (
            <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-paper-muted">
              {asset.caption}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={!asset}
              onClick={() => asset && onPinAsset(asset)}
              className="flex items-center gap-1 rounded-lg bg-paper-gold px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-paper-border disabled:text-paper-muted"
            >
              <Pin className="h-3 w-3" />
              钉到右侧对照
            </button>
            <button
              type="button"
              onClick={() => {
                closeNow();
                onJump(
                  asset?.pageNumber ?? citation.nativeDest?.pageNumber ?? citation.pageNumber,
                  asset?.cropRect ?? fallbackPreview?.cropRect,
                  citation.rect,
                );
              }}
              className="ml-auto rounded-lg border border-paper-border px-2.5 py-1.5 text-[11px] text-paper-ink transition hover:bg-paper-bg"
            >
              跳去原页
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function FallbackMessage({ citation }: { citation: InlineCitation }) {
  return (
    <p className="rounded-lg bg-paper-bg px-3 py-2.5 text-[11px] leading-relaxed text-paper-muted">
      未自动定位到图像内容。
      {citation.nativeDest
        ? `PDF 原生链接指向第 ${citation.nativeDest.pageNumber} 页，可点击前往原页或使用「框选钉住」。`
        : '点击前往原页，或用顶部「框选钉住」把目标区域钉到右侧。'}
    </p>
  );
}
