import { IS_EXTENSION_PAGE } from '../../config/runtime';
import { describeError, formatMessage, message, t, type DisplayMessage } from '../../i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Languages, Settings } from 'lucide-react';
import { cleanPdfSelectedText } from '../../utils/textCleanup';
import {
  DEFAULT_TRANSLATE_CONFIG,
  grantFreeTranslateConsent,
  needsFreeTranslateConsent,
  selectionTranslator,
  type TranslateConfig,
} from '../../services/translator';

// PDF.js uses positioned spans and explicit <br> elements. Reading only those
// layers keeps page numbers and citation controls out of cross-page selections.
function readRange(range: Range, viewer: HTMLElement) {
  const parts: string[] = [];
  for (const layer of viewer.querySelectorAll('.textLayer')) {
    if (!range.intersectsNode(layer)) continue;
    const part = range.cloneRange();
    if (!layer.contains(part.startContainer)) part.setStart(layer, 0);
    if (!layer.contains(part.endContainer)) part.setEnd(layer, layer.childNodes.length);
    const content = part.cloneContents();
    content.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    parts.push(content.textContent ?? '');
  }
  return cleanPdfSelectedText(parts.join('\n'));
}

interface Anchor {
  text: string;
  left: number;
  edge: number;
  above: boolean;
}

interface SelectionToolbarProps {
  viewerRef: RefObject<HTMLElement>;
  /** Opens the shared translation settings so there is a single place to configure providers. */
  onOpenSettings: () => void;
}

export function SelectionToolbar({ viewerRef, onOpenSettings }: SelectionToolbarProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range>();
  useEffect(() => {
    const viewer = viewerRef.current?.querySelector<HTMLElement>('[data-pdf-viewer]');
    if (!viewer) return;
    let dragging = false;
    let frame = 0;
    let savedText = '';
    let backwards = false;

    function hide() {
      rangeRef.current = undefined;
      savedText = '';
      setAnchor(null);
    }

    function measure(range: Range, text: string) {
      if (!viewer || !viewer.contains(range.commonAncestorContainer)) return hide();
      const bounds = viewer.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).filter(rect =>
        rect.width && rect.height && rect.bottom > bounds.top && rect.top < bounds.bottom &&
        rect.right > bounds.left && rect.left < bounds.right);
      const rect = backwards ? rects[0] : rects[rects.length - 1];
      if (!rect) { setAnchor(null); return; }
      const above = window.innerHeight - rect.bottom < Math.min(320, rect.top);
      setAnchor({
        text, above, edge: above ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(320, window.innerWidth - 16) - 8)),
      });
    }

    function update() {
      if (dragging || !viewer) return;
      if (toolbar.current?.contains(document.activeElement) && rangeRef.current) {
        measure(rangeRef.current, savedText);
        return;
      }
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return hide();
      const range = selection.getRangeAt(0);
      if (!viewer.contains(range.commonAncestorContainer)) return hide();
      savedText = readRange(range, viewer);
      if (!savedText) return hide();
      backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
      rangeRef.current = range.cloneRange();
      measure(rangeRef.current, savedText);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    function pointerDown(event: PointerEvent) {
      if (toolbar.current?.contains(event.target as Node)) return;
      dragging = true;
      hide();
    }
    function pointerUp() {
      dragging = false;
      schedule();
    }
    function reposition(event: Event) {
      if (toolbar.current?.contains(event.target as Node)) return;
      if (rangeRef.current) measure(rangeRef.current, savedText);
    }

    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('pointercancel', pointerUp);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', schedule);
    };
  }, [viewerRef]);

  if (!anchor) return null;
  function restoreSelection() {
    // Focusing the endpoint/key inputs may replace the browser's PDF selection.
    const range = rangeRef.current;
    const selection = window.getSelection();
    if (!range || !selection || !viewerRef.current?.contains(range.commonAncestorContainer)) return;
    if (document.activeElement instanceof HTMLElement && toolbar.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return createPortal(
    <div ref={toolbar} className="fixed z-[60] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-paper-border bg-paper-card text-xs text-paper-ink shadow-float"
      style={{ left: anchor.left, [anchor.above ? 'bottom' : 'top']: anchor.edge, maxHeight: Math.max(48, window.innerHeight - anchor.edge - 8) }}
      onMouseDown={event => { if ((event.target as Element).closest('button')) event.preventDefault(); }}>
      <SelectionActions key={anchor.text} text={anchor.text} restoreSelection={restoreSelection} onOpenSettings={onOpenSettings} />
    </div>, document.body,
  );
}

const actionClass = 'inline-flex items-center gap-1.5 rounded px-2 py-1.5 hover:bg-paper-bg disabled:text-paper-muted';

interface SelectionActionsProps {
  text: string;
  restoreSelection: () => void;
  onOpenSettings: () => void;
}

function SelectionActions({ text, restoreSelection, onOpenSettings }: SelectionActionsProps) {
  const [config, setConfig] = useState<TranslateConfig>(DEFAULT_TRANSLATE_CONFIG);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const [translation, setTranslation] = useState('');
  const [notice, setNotice] = useState<DisplayMessage>('');
  const [copied, setCopied] = useState<'source' | 'translation' | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    let active = true;
    void selectionTranslator.loadTranslateConfig().then(saved => {
      if (!active) return;
      setConfig(IS_EXTENSION_PAGE && !saved.apiKey ? { ...saved, provider: 'free' as const } : saved);
      setReady(true);
    });
    const unsubscribe = selectionTranslator.subscribeConfig(next => {
      setConfig(next);
      setTranslation('');
    });
    return () => { active = false; unsubscribe(); window.clearTimeout(timer.current); };
  }, []);

  async function copy(value: string, kind: 'source' | 'translation') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setNotice('');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1400);
    } catch { setNotice(message('copy.failed')); }
  }

  async function translate(consented = false) {
    setNotice('');
    if (config.provider !== 'free' && (!config.apiBaseUrl || !config.model)) {
      setNotice(message('translate.configureFirst'));
      onOpenSettings();
      return;
    }
    if (!consented && needsFreeTranslateConsent(config)) {
      setAskConsent(true);
      return;
    }
    setAskConsent(false);
    restoreSelection();
    setBusy(true);
    try {
      const [value] = await selectionTranslator.translateTexts([text], config);
      setTranslation(value);
    } catch (error) {
      setNotice(error instanceof TypeError ? message('translate.unreachable') :
        describeError(error, message('translate.retry')));
    } finally { setBusy(false); }
  }

  return <>
    <div role="group" aria-label={t('selection.actions')} className="flex items-center gap-0.5 p-1">
      <button type="button" className={actionClass} onClick={() => void copy(text, 'source')}>
        {copied === 'source' ? <Check size={14} /> : <Copy size={14} />}{copied === 'source' ? t('common.copied') : t('copy.clean')}
      </button>
      <button type="button" className={actionClass} disabled={!ready || busy} onClick={() => void translate()}>
        <Languages size={15} />{busy ? t('translate.busy') : t('translate.selection')}
      </button>
      <button type="button" className={actionClass + ' ml-auto'} aria-label={t('translate.settings')} title={t('translate.settings')}
        onClick={onOpenSettings}>
        <Settings size={14} />
      </button>
    </div>
    {askConsent && <div role="dialog" aria-labelledby="selection-consent-title" className="w-80 max-w-full border-t border-paper-border p-3">
      <p id="selection-consent-title" className="font-semibold">{t('translate.consentTitle')}</p>
      <p className="mt-1 leading-relaxed text-paper-muted">{t('translate.consentBody')}</p>
      <div className="mt-2.5 flex justify-end gap-2">
        <button type="button" className="rounded-lg border border-paper-border px-3 py-1.5 hover:bg-paper-bg"
          onClick={() => { setAskConsent(false); onOpenSettings(); }}>{t('translate.consentConfigure')}</button>
        <button type="button" className="rounded-lg bg-paper-ink px-3 py-1.5 font-medium text-paper-card hover:opacity-90"
          onClick={() => { grantFreeTranslateConsent(); void translate(true); }}>{t('translate.consentContinue')}</button>
      </div>
    </div>}
    {translation && <div className="w-80 max-w-full border-t border-paper-border px-3 py-2">
      <p lang={config.targetLang} className="whitespace-pre-wrap break-words leading-relaxed">{translation}</p>
      <button className={actionClass + ' mt-1 text-paper-muted'} onClick={() => void copy(translation, 'translation')}>
        {copied === 'translation' ? <Check size={12} /> : <Copy size={12} />}{t('translate.copy')}
      </button>
    </div>}
    {notice && <p role="status" className="max-w-80 border-t border-paper-border px-3 py-2 text-paper-muted">{formatMessage(notice)}</p>}
  </>;
}
