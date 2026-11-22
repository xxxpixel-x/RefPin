import { useEffect, useRef, useState, type RefObject, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Languages, Settings } from 'lucide-react';
import { cleanPdfSelectedText } from '../../utils/textCleanup';
import { webTranslator, WEB_TRANSLATE_CONFIG, type TranslateConfig } from '../../services/translator';

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

export function SelectionToolbar({ viewerRef }: { viewerRef: RefObject<HTMLElement> }) {
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
    <div ref={toolbar} className="fixed z-[60] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-paper-border bg-white text-xs text-paper-ink shadow-float"
      style={{ left: anchor.left, [anchor.above ? 'bottom' : 'top']: anchor.edge, maxHeight: Math.max(48, window.innerHeight - anchor.edge - 8) }}
      onMouseDown={event => { if ((event.target as Element).closest('button')) event.preventDefault(); }}>
      <SelectionActions key={anchor.text} text={anchor.text} restoreSelection={restoreSelection} />
    </div>, document.body,
  );
}

const actionClass = 'inline-flex items-center gap-1.5 rounded px-2 py-1.5 hover:bg-paper-bg disabled:text-paper-muted';
const fieldClass = 'mt-1 w-full rounded-md border border-paper-border bg-white px-2 py-1.5 text-paper-ink focus:border-paper-gold focus:outline-none';

function SelectionActions({ text, restoreSelection }: { text: string; restoreSelection: () => void }) {
  const [config, setConfig] = useState<TranslateConfig>(WEB_TRANSLATE_CONFIG);
  const [draft, setDraft] = useState(config);
  const [settings, setSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [translation, setTranslation] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState<'source' | 'translation' | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    let active = true;
    void webTranslator.loadTranslateConfig().then(saved => {
      if (!active) return;
      setConfig(saved);
      setDraft(saved);
      setReady(true);
    });
    return () => { active = false; window.clearTimeout(timer.current); };
  }, []);

  async function copy(value: string, kind: 'source' | 'translation') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setNotice('');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1400);
    } catch { setNotice('复制失败，请检查浏览器剪贴板权限。'); }
  }

  async function translate() {
    setNotice('');
    if (!config.apiBaseUrl || !config.model) {
      setSettings(true);
      setNotice('先配置翻译端点和模型，再翻译这段选文。');
      return;
    }
    setSettings(false);
    restoreSelection();
    setBusy(true);
    try {
      const [value] = await webTranslator.translateTexts([text], config);
      setTranslation(value);
    } catch (error) {
      setNotice(error instanceof TypeError ? '无法连接端点，请检查地址、服务状态及跨域设置。' :
        error instanceof Error ? error.message : '翻译失败，请重试。');
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = { ...draft, apiBaseUrl: draft.apiBaseUrl.trim(), model: draft.model.trim(), apiKey: draft.apiKey.trim() };
    if (!/^https?:\/\//i.test(next.apiBaseUrl) || !next.model) {
      setNotice('请填写 HTTP(S) 端点和模型名。');
      return;
    }
    try {
      await webTranslator.saveTranslateConfig(next);
      restoreSelection();
      setConfig(next);
      setDraft(next);
      setSettings(false);
      setTranslation('');
      setNotice('设置已保存');
    } catch { setNotice('浏览器未能保存设置，请检查本地存储权限。'); }
  }
  async function clearKey() {
    try {
      const next = { ...config, apiKey: '' };
      await webTranslator.saveTranslateConfig(next);
      setConfig(next);
      setDraft(value => ({ ...value, apiKey: '' }));
      setNotice('密钥已清除');
    } catch { setNotice('密钥清除失败，请检查本地存储权限。'); }
  }

  return <>
    <div role="group" aria-label="选中文字" className="flex items-center gap-0.5 p-1">
      <button type="button" className={actionClass} onClick={() => void copy(text, 'source')}>
        {copied === 'source' ? <Check size={14} /> : <Copy size={14} />}{copied === 'source' ? '已复制' : '净化复制'}
      </button>
      <button type="button" className={actionClass} disabled={!ready || busy} onClick={() => void translate()}>
        <Languages size={15} />{busy ? '翻译中…' : '划词翻译'}
      </button>
      <button type="button" className={actionClass + ' ml-auto'} aria-expanded={settings} aria-label="翻译设置" title="翻译设置"
        disabled={!ready || busy} onClick={() => {
          if (settings) restoreSelection();
          setDraft(config); setSettings(!settings); setNotice('');
        }}>
        <Settings size={14} />
      </button>
    </div>
    {settings && <form onSubmit={save} className="grid w-80 max-w-full gap-2.5 border-t border-paper-border p-3">
      <label>OpenAI 兼容端点 · 支持 Ollama
        <input type="url" required className={fieldClass} placeholder="http://localhost:11434/v1" value={draft.apiBaseUrl}
          onChange={e => setDraft({ ...draft, apiBaseUrl: e.target.value })} />
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label>模型<input required className={fieldClass} placeholder="本地或服务端模型名" value={draft.model}
          onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
        <label>目标语言<select className={fieldClass} value={draft.targetLang}
          onChange={e => setDraft({ ...draft, targetLang: e.target.value as TranslateConfig['targetLang'] })}>
          <option value="zh-CN">简体中文</option><option value="en">English</option>
        </select></label>
      </div>
      <label>API Key（可选）<input type="password" autoComplete="off" className={fieldClass} value={draft.apiKey}
        onChange={e => setDraft({ ...draft, apiKey: e.target.value })} /></label>
      <p className="text-[11px] leading-relaxed text-paper-muted">密钥仅保存在本机浏览器。点击翻译时，选文和认证信息会发送到上方端点。</p>
      <div className="flex justify-between">
        <button type="button" className={actionClass} onClick={() => void clearKey()}>清除密钥</button>
        <button type="submit" className="rounded bg-paper-ink px-3 py-1.5 text-white">保存设置</button>
      </div>
    </form>}
    {!settings && translation && <div className="w-80 max-w-full border-t border-paper-border px-3 py-2">
      <p lang={config.targetLang} className="whitespace-pre-wrap break-words leading-relaxed">{translation}</p>
      <button className={actionClass + ' mt-1 text-paper-muted'} onClick={() => void copy(translation, 'translation')}>
        {copied === 'translation' ? <Check size={12} /> : <Copy size={12} />}复制译文
      </button>
    </div>}
    {notice && <p role="status" className="max-w-80 border-t border-paper-border px-3 py-2 text-paper-muted">{notice}</p>}
  </>;
}
