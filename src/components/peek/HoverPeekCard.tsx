import { t } from '../../i18n/core';
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
  GlossaryEntry,
  InlineCitation,
  PaperAsset,
  ReaderMention,
  ReferenceEntry,
} from '../../types/paper';

export interface PeekTrigger {
  mention: ReaderMention;
  anchorEl: HTMLElement;
}

interface HoverPeekCardProps {
  trigger: PeekTrigger | null;
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  glossaryMap?: Record<string, GlossaryEntry>;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (reference: ReferenceEntry) => void;
  onJump: (
    pageNumber: number,
    targetRect?: InlineCitation['rect'],
    sourceRect?: InlineCitation['rect'],
    sourcePage?: number,
  ) => void;
  onOpenLightbox: (asset: PaperAsset) => void;
  onPeek: (mention: ReaderMention) => void;
  fallbackPreview?: {
    citationId?: string;
    imageUrl: string;
    pageNumber: number;
    cropRect?: InlineCitation['rect'];
  } | null;
}


const SHOW_DELAY = 120;
const HIDE_DELAY = 260;
const CARD_WIDTH = 344;

export function HoverPeekCard({
  trigger,
  assetsMap,
  referencesMap,
  glossaryMap,
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
    // Starting a selection must immediately clear even a delayed/floating peek.
    const dismissForSelection = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-pdf-viewer]')) return;
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
      hoveringCard.current = false;
      setActiveTrigger(null);
    };
    document.addEventListener('pointerdown', dismissForSelection, true);
    return () => {
      document.removeEventListener('pointerdown', dismissForSelection, true);
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
    };
  }, []);

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
      peekRef.current(trigger.mention);
    }, SHOW_DELAY);
    return () => window.clearTimeout(enterTimer.current);
  }, [trigger]);

  const mention = activeTrigger?.mention;
  const citation = mention && 'kind' in mention ? mention : null;
  const definition = mention && 'term' in mention ? glossaryMap?.[mention.term] : undefined;

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

  if (!activeTrigger || !mention || (!citation && !definition)) return null;

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
      onFocus={keepOpen}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}
      style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      className="animate-fade-in-up fixed z-50 overflow-hidden rounded-xl border border-paper-border bg-white shadow-float"
    >
      {definition && (
        <>
          <div className="flex items-center gap-2 border-b border-paper-border bg-paper-bg px-3 py-2">
            <span className="rounded border border-paper-border bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-paper-ink">{definition.term}</span>
            <span className="rounded-full border border-paper-border px-1.5 text-[10px] text-paper-muted">{t('glossary.title')}</span>
            <span className="ml-auto text-[10px] text-paper-muted">{t('glossary.definedOn', { page: definition.definedPage })}</span>
          </div>
          <div className="p-3">
            <p className="text-[13px] font-semibold text-paper-ink">{definition.expansion}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-paper-muted">{definition.contextSentence}</p>
            <button type="button" className="mt-3 flex items-center gap-1 rounded-md border border-paper-border px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-bg"
              onClick={() => {
                closeNow();
                onJump(definition.definedPage, definition.definedRect, mention.rect, mention.pageNumber);
              }}>
              <CornerDownRight size={13} />{t('glossary.jump')}
            </button>
          </div>
        </>
      )}
      {citation && <>
      <div className="flex items-center gap-2 border-b border-paper-border bg-paper-bg/60 px-3 py-2">
        <span className="rounded bg-paper-goldbg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {t(`kind.${citation.kind}`)}
        </span>
        <span className="font-mono text-[10px] text-paper-muted">
          {t('reader.page', { page: asset?.pageNumber ??
            activeReference?.pageNumber ??
            citation.nativeDest?.pageNumber ??
            citation.pageNumber })}
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
          title={t('peek.source')}
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
                  {reference.key.startsWith('ref-ay-') ? `${reference.firstAuthorLastName} ${reference.year}` : `[${reference.index}]`}
                </button>
              ))}
            </div>
          )}

          {activeReference ? (
            <>
              <p className="text-[13px] font-semibold leading-snug text-paper-ink">
                {activeReference.title || t('reference.number', { index: activeReference.index })}
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
                  {t('reference.pin')}
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
                  <CornerDownRight className="h-3 w-3" /> {t('peek.follow')}
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
                <Maximize2 className="h-3 w-3" /> {t('peek.enlarge')}
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
              {t('peek.pin')}
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
              {t('peek.source')}
            </button>
          </div>
        </div>
      )}
      </>}
    </div>,
    document.body,
  );
}

function FallbackMessage({ citation }: { citation: InlineCitation }) {
  return (
    <p className="rounded-lg bg-paper-bg px-3 py-2.5 text-[11px] leading-relaxed text-paper-muted">
      {citation.nativeDest
        ? t('peek.fallbackPage', { page: citation.nativeDest.pageNumber })
        : t('peek.fallback')}
    </p>
  );
}
