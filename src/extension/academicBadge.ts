import { getLocale, subscribeLocale, t } from '../i18n/core';
import { inspectTabUrl } from './urlRules';

export function mountAcademicBadge(activate: () => void): () => void {
  const paper = inspectTabUrl(location.href);
  if (paper.kind !== 'academic-html' && paper.kind !== 'academic-abstract') return () => {};
  let closed = false;
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = [
    ':host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483645;color-scheme:light dark}',
    '.bar{display:flex;align-items:center;padding:3px;border:1px solid #928c803e;border-radius:24px;background:Canvas;color:CanvasText;box-shadow:0 3px 16px #201c191b;font:500 12px/1.2 system-ui,sans-serif}',
    'button{all:unset;cursor:pointer;border-radius:18px;padding:7px;color:inherit}button:first-child{padding-left:11px}button:first-child::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#b28b41;margin-right:7px}',
    'button:hover,button:focus-visible{background:#a99c7822}button:focus-visible{outline:2px solid #aa8439}',
  ].join('');
  const bar = document.createElement('div');
  bar.className = 'bar';
  const primary = document.createElement('button'), pdf = document.createElement('button'), dismiss = document.createElement('button');
  const mutedKey = 'refpin.badgeMuted.' + location.hostname;
  function label() {
    host.lang = getLocale();
    primary.textContent = t('badge.read');
    pdf.textContent = '↗';
    pdf.title = t('badge.pdf');
    pdf.setAttribute('aria-label', pdf.title);
    dismiss.textContent = '×';
    dismiss.title = t('badge.dismiss');
    dismiss.setAttribute('aria-label', dismiss.title);
  }
  const unsubscribe = subscribeLocale(label);
  function close() { closed = true; unsubscribe(); host.remove(); }
  label();
  primary.onclick = event => {
    if (!event.isTrusted) return;
    void chrome.runtime.sendMessage({ type: 'REFPIN_OPEN_SIDEPANEL' }).catch(() => {});
    activate();
    close();
  };
  pdf.onclick = event => {
    if (event.isTrusted) void chrome.runtime.sendMessage({ type: 'REFPIN_BADGE_PDF' }).catch(() => {});
  };
  dismiss.onclick = event => {
    if (!event.isTrusted) return;
    if (event.shiftKey) void chrome.storage.local.set({ [mutedKey]: true }).catch(() => {});
    void chrome.runtime.sendMessage({ type: 'REFPIN_DISMISS_BADGE' }).catch(() => {});
    close();
  };
  bar.append(primary);
  if (paper.pdfUrl) bar.append(pdf);
  bar.append(dismiss);
  shadow.append(style, bar);
  void Promise.all([chrome.storage.local.get(mutedKey), chrome.runtime.sendMessage<{ dismissed: boolean }>({ type: 'REFPIN_BADGE_STATE' })])
    .then(([prefs, tab]) => {
      if (!closed && !prefs[mutedKey] && !tab?.dismissed) document.documentElement.append(host);
    }).catch(() => {});
  return close;
}
