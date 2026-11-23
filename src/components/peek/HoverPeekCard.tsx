import { ReferenceDetails } from './ReferenceDetails';
import { usePreviewColor } from './usePreviewColor';
import { t } from '../../i18n/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  CornerDownRight,
  ExternalLink,
  Maximize2,
  Pin,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { findAssetForCitation, glossaryPinId } from '../../engine/backlinks';
import { useOnboarding } from '../../store/onboarding';
import { useReaderStore } from '../../store/useReaderStore';
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
  /** Opened by a click: stays open until dismissed instead of following the pointer. */
  locked?: boolean;
}

interface HoverPeekCardProps {
  trigger: PeekTrigger | null;
  assetsMap: Record<string, PaperAsset>;
  referencesMap: Record<string, ReferenceEntry>;
  glossaryMap?: Record<string, GlossaryEntry>;
  onPinAsset: (asset: PaperAsset) => void;
  onPinReference: (reference: ReferenceEntry) => void;
  onPinGlossary?: (entry: GlossaryEntry) => void;
  onJump: (
    pageNumber: number,
    targetRect?: InlineCitation['rect'],
    sourceRect?: InlineCitation['rect'],
    sourcePage?: number,
  ) => void;
  onOpenLightbox: (asset: PaperAsset) => void;
  onPeek: (mention: ReaderMention) => void;
  /** Called whenever the card closes itself (Esc, outside press, close button). */
  onDismiss?: () => void;
  pinnedIds?: string[];
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
  onPinGlossary,
  onJump,
  onOpenLightbox,
  onPeek,
  onDismiss,
  pinnedIds = [],
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
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const activeRef = useRef<PeekTrigger | null>(null);
  activeRef.current = activeTrigger;

  useEffect(() => {
    // Any press outside the card (including starting a text selection) closes it,
    // so a click-locked card never lingers after the reader moves on.
    const dismissOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-coach-bubble]')) return;
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
      hoveringCard.current = false;
      if (activeRef.current) dismissRef.current?.();
      setActiveTrigger(null);
    };
    document.addEventListener('pointerdown', dismissOnOutsidePress, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePress, true);
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
    };
  }, []);

  useEffect(() => {
    window.clearTimeout(enterTimer.current);
    window.clearTimeout(leaveTimer.current);
    if (!trigger) {
      if (activeRef.current?.locked) setActiveTrigger(null);
      else if (!hoveringCard.current) {
        leaveTimer.current = window.setTimeout(() => setActiveTrigger(null), HIDE_DELAY);
      }
      return;
    }
    const show = () => {
      const sameMention = activeRef.current?.mention.id === trigger.mention.id;
      setActiveTrigger(trigger);
      if (sameMention) return;
      setActiveRefIndex(0);
      peekRef.current(trigger.mention);
    };
    if (trigger.locked) {
      show();
      return;
    }
    enterTimer.current = window.setTimeout(show, SHOW_DELAY);
    return () => window.clearTimeout(enterTimer.current);
  }, [trigger]);

  const mention = activeTrigger?.mention;
  const coachCitation = useOnboarding(state => state.run?.step === 'pin' ? state.run.citation.id : undefined);
  useEffect(() => {
    useOnboarding.getState().send({ type: 'preview', citationId: mention?.id });
  }, [mention?.id]);
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

  const { filter, colorToggle } = usePreviewColor(asset?.key ?? citation?.id);
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
    if (!cardRef.current) return;
    const observer = new ResizeObserver(recalcPosition);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [recalcPosition, activeRefIndex, asset, activeReference, fallbackPreview]);

  useEffect(() => {
    if (!activeTrigger) return;
    const close = () => {
      hoveringCard.current = false;
      setActiveTrigger(null);
      dismissRef.current?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // The card follows its citation while the page scrolls and closes once the citation leaves view.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      const rect = activeTrigger.anchorEl.getBoundingClientRect();
      if (!activeTrigger.anchorEl.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) close();
      else recalcPosition();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [activeTrigger, recalcPosition]);

  if (!activeTrigger || !mention || (!citation && !definition)) return null;

  const keepOpen = () => {
    hoveringCard.current = true;
    window.clearTimeout(leaveTimer.current);
  };

  const scheduleClose = () => {
    hoveringCard.current = false;
    if (activeTrigger.locked) return;
    leaveTimer.current = window.setTimeout(() => setActiveTrigger(null), HIDE_DELAY);
  };

  const closeNow = () => {
    hoveringCard.current = false;
    setActiveTrigger(null);
    onDismiss?.();
  };

  const closeButton = (
    <button type="button" onClick={closeNow} aria-label={t('common.close')} title={t('common.close')}
      className="rounded-md p-1 text-paper-muted transition hover:bg-paper-card hover:text-paper-ink">
      <X className="h-3.5 w-3.5" />
    </button>
  );

  const pinButton = (pinned: boolean, label: string, onClick: () => void, disabled = false, assetId?: string) => (
    <button
      type="button"
      data-coach-pin={assetId}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:bg-paper-border disabled:text-paper-muted',
        pinned
          ? 'border border-paper-goldborder bg-paper-goldbg text-paper-goldtext'
          : 'bg-paper-gold text-paper-card hover:bg-paper-gold/90',
      )}
    >
      {pinned ? <Check className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      {pinned ? t('pin.pinned') : label}
    </button>
  );

  return createPortal(
    <div
      ref={cardRef}
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleClose}
      onFocus={keepOpen}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}
      style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      className="animate-fade-in-up fixed z-50 max-h-[calc(100vh-24px)] overflow-y-auto rounded-xl border border-paper-border bg-paper-card shadow-float"
    >
      {definition && (
        <>
          <div className="flex items-center gap-2 border-b border-paper-border bg-paper-bg px-3 py-2">
            <span className="rounded border border-paper-border bg-paper-card px-1.5 py-0.5 font-mono text-xs font-semibold text-paper-ink">{definition.term}</span>
            <span className="rounded-full border border-paper-border px-1.5 text-[11px] text-paper-muted">{t('glossary.title')}</span>
            <span className="ml-auto text-[11px] text-paper-muted">{t('glossary.definedOn', { page: definition.definedPage })}</span>
            {closeButton}
          </div>
          <div className="p-3">
            <p className="text-[13px] font-semibold text-paper-ink">{definition.expansion}</p>
            <p className="mt-2 text-xs leading-relaxed text-paper-muted">{definition.contextSentence}</p>
            <div className="mt-3 flex items-center gap-2">
              {onPinGlossary && pinButton(
                pinnedIds.includes(glossaryPinId(definition.term)), t('glossary.pin'), () => onPinGlossary(definition),
              )}
              <button type="button" className="flex items-center gap-1 rounded-lg border border-paper-border px-2.5 py-1.5 text-xs text-paper-ink hover:bg-paper-bg"
                onClick={() => {
                  closeNow();
                  onJump(definition.definedPage, definition.definedRect, mention.rect, mention.pageNumber);
                }}>
                <CornerDownRight size={13} />{t('glossary.jump')}
              </button>
            </div>
          </div>
        </>
      )}
      {citation && <>
      <div className="flex items-center gap-2 border-b border-paper-border bg-paper-bg/60 px-3 py-2">
        <span className="rounded bg-paper-goldbg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-paper-goldtext">
          {t(`kind.${citation.kind}`)}
        </span>
        <span className="font-mono text-[11px] text-paper-muted">
          {t('reader.page', { page: asset?.pageNumber ??
            activeReference?.pageNumber ??
            citation.nativeDest?.pageNumber ??
            citation.pageNumber })}
        </span>
        <span className="truncate text-xs text-paper-muted">{citation.rawText}</span>
        {previewImage && colorToggle}
        <button
          type="button"
          onClick={() => {
            closeNow();
            onJump(
              asset?.pageNumber ??
                activeReference?.pageNumber ??
                citation.nativeDest?.pageNumber ??
                citation.pageNumber,
              asset?.cropRect ?? matchedFallback?.cropRect,
              citation.rect,
              citation.pageNumber,
            );
          }}
          className="ml-auto rounded-md p-1 text-paper-muted transition hover:bg-paper-card hover:text-paper-ink"
          title={t('peek.source')}
          aria-label={t('peek.source')}
        >
          <CornerDownRight className="h-3.5 w-3.5" />
        </button>
        {closeButton}
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
                    'rounded-md px-2 py-0.5 font-mono text-[11px] transition',
                    index === activeRefIndex
                      ? 'bg-paper-ink text-paper-card'
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
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
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
              <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-paper-muted">
                {activeReference.rawText}
              </p>
              <ReferenceDetails key={activeReference.key} reference={activeReference} />
              <div className="mt-3 flex items-center gap-2">
                {pinButton(pinnedIds.includes(activeReference.key), t('reference.pin'), () => onPinReference(activeReference))}
                <a
                  href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                    activeReference.title || activeReference.rawText,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-paper-border px-2.5 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg"
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
                    matchedFallback?.pageNumber ??
                      citation.nativeDest?.pageNumber ??
                      citation.pageNumber,
                    matchedFallback?.cropRect,
                    citation.rect,
                    citation.pageNumber,
                  );
                }}
                className="group block w-full overflow-hidden rounded-lg border border-paper-border bg-paper-bg"
              >
                <img
                  src={previewImage}
                  style={{ filter }}
                  alt={citation.rawText}
                  onLoad={recalcPosition}
                  className="max-h-[300px] w-full object-contain transition group-hover:scale-[1.01]"
                />
                <span className="flex items-center justify-center gap-1 border-t border-paper-border bg-paper-card py-1 text-[11px] text-paper-muted transition group-hover:text-paper-ink">
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
                else if (matchedFallback) onJump(matchedFallback.pageNumber, matchedFallback.cropRect, citation.rect, citation.pageNumber);
              }}
              className="group block w-full overflow-hidden rounded-lg border border-paper-border bg-paper-bg"
            >
              <img
                src={previewImage}
                style={{ filter }}
                alt={asset?.label ?? citation.rawText}
                onLoad={recalcPosition}
                className="max-h-[300px] w-full object-contain transition group-hover:scale-[1.01]"
              />
              <span className="flex items-center justify-center gap-1 border-t border-paper-border bg-paper-card py-1 text-[11px] text-paper-muted transition group-hover:text-paper-ink">
                {asset ? <Maximize2 className="h-3 w-3" /> : <CornerDownRight className="h-3 w-3" />}
                {t(asset ? 'peek.enlarge' : 'peek.follow')}
              </span>
            </button>
          ) : (
            <FallbackMessage citation={citation} />
          )}

          {asset?.caption && (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-paper-muted">
              {asset.caption}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            {asset && coachCitation === citation.id && pinnedIds.includes(asset.key)
              ? <button type="button" data-coach-pin={asset.key}
                  className="rounded-lg border border-paper-border px-2.5 py-1.5 text-xs text-paper-ink hover:bg-paper-bg"
                  onClick={() => useReaderStore.getState().unpinItem(asset.key)}>{t('coach.unpin')}</button>
              : pinButton(!!asset && pinnedIds.includes(asset.key), t('peek.pin'), () => { if (asset) onPinAsset(asset); }, !asset, asset?.key)}
            <button
              type="button"
              onClick={() => {
                closeNow();
                onJump(
                  asset?.pageNumber ?? citation.nativeDest?.pageNumber ?? citation.pageNumber,
                  asset?.cropRect ?? matchedFallback?.cropRect,
                  citation.rect,
                  citation.pageNumber,
                );
              }}
              className="ml-auto rounded-lg border border-paper-border px-2.5 py-1.5 text-xs text-paper-ink transition hover:bg-paper-bg"
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
    <p className="rounded-lg bg-paper-bg px-3 py-2.5 text-xs leading-relaxed text-paper-muted">
      {citation.nativeDest
        ? t('peek.fallbackPage', { page: citation.nativeDest.pageNumber })
        : t('peek.fallback')}
    </p>
  );
}
