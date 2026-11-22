import { pinTitle, timedSnipTitle } from '../i18n/pinTitle';
import type { DisplayMessage } from '../i18n/types';
import { describeError, getLocale, message, subscribeLocale, t } from '../i18n/core';
import {
  extractDomPaper,
  isLikelyAcademicHtmlPage,
  type ParsedDomPaper,
} from './domPaperParser';
import type {
  CompanionAsset,
  CompanionPinItem,
  CompanionReference,
  ExtensionMessage,
  PageTranslateStatus,
  TranslateDisplayMode,
} from './protocol';

const STYLE_ID = 'refpin-page-inline-style';
const UI_HOST_ID = 'refpin-shadow-ui-host';

interface CitationBinding {
  asset?: CompanionAsset;
  references?: CompanionReference[];
}

let parsedPaper: ParsedDomPaper | null = null;
let citationCount = 0;
let isActivated = false;

// ---- Shadow DOM UI state ----
let shadowRoot: ShadowRoot | null = null;
let peekEl: HTMLDivElement | null = null;
let dockZoomEl: HTMLDivElement | null = null;
let returnEl: HTMLDivElement | null = null;
let lightboxEl: HTMLDivElement | null = null;
let toastEl: HTMLDivElement | null = null;
let snipEl: HTMLDivElement | null = null;

let openTimer: number | null = null;
let closeTimer: number | null = null;
let dockZoomUnmountTimer: number | null = null;
let toastTimer: number | null = null;
let toastMessage: (() => string) | undefined;
let dockPreview: { item: CompanionPinItem; anchorCenterRatio: number } | undefined;
let savedScrollY: number | null = null;
let activeRefTabIndex = 0;
let activeBinding: CitationBinding | null = null;
let activeAnchorEl: HTMLElement | null = null;

function injectHostStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .refpin-cite-mark {
      border-bottom: 1.5px dotted #D97706 !important;
      border-radius: 2px;
      cursor: pointer;
      transition: background-color 0.14s ease, color 0.14s ease;
    }
    .refpin-cite-mark:hover {
      background-color: rgba(254, 243, 199, 0.85) !important;
      color: #92400E !important;
    }
    @keyframes refpinTargetPulse {
      0% { outline: 3px solid rgba(217, 119, 6, 0.95); outline-offset: 4px; background-color: rgba(254, 243, 199, 0.45); }
      70% { outline: 3px solid rgba(217, 119, 6, 0.4); outline-offset: 6px; background-color: rgba(254, 243, 199, 0.15); }
      100% { outline: 3px solid rgba(217, 119, 6, 0); outline-offset: 8px; background-color: transparent; }
    }
    .refpin-target-flash {
      animation: refpinTargetPulse 1.7s ease-out;
      border-radius: 6px;
    }
    .refpin-tr-block {
      font-family: 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', Inter, -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.72;
      word-break: break-word;
    }
    .refpin-tr-heading {
      font-weight: 600;
      line-height: 1.38;
    }
    .refpin-tr-caption {
      font-size: 0.92em;
      color: #57534E;
    }
    html[data-refpin-tr-mode="off"] .refpin-tr-block {
      display: none !important;
    }
    html[data-refpin-tr-mode="bilingual"] .refpin-tr-block {
      display: block;
      margin: 6px 0 12px;
      padding: 6px 10px;
      border-left: 2.5px solid #D97706;
      background: rgba(255, 251, 235, 0.72);
      border-radius: 0 6px 6px 0;
      color: #1C1917;
    }
    html[data-refpin-tr-mode="translated"] .refpin-tr-orig-done {
      display: none !important;
    }
    html[data-refpin-tr-mode="translated"] .refpin-tr-block {
      display: block;
      margin: 0.45em 0 0.8em;
      color: inherit;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function ensureShadowUi(): ShadowRoot {
  if (shadowRoot && document.getElementById(UI_HOST_ID)) return shadowRoot;

  const host = document.createElement('div');
  host.id = UI_HOST_ID;
  host.lang = getLocale();
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '2147483647';

  shadowRoot = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font-family: Inter, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif; }
    .peek {
      position: fixed;
      pointer-events: auto;
      width: 390px;
      max-width: calc(100vw - 24px);
      background: #FFFFFF;
      border: 1px solid #E7E5E4;
      border-radius: 14px;
      box-shadow: 0 16px 44px rgba(28, 25, 23, 0.18), 0 2px 8px rgba(28, 25, 23, 0.08);
      color: #1C1917;
      overflow: hidden;
      display: none;
      animation: refpinFade 0.14s ease-out;
    }
    @keyframes refpinFade {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .peek-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      border-bottom: 1px solid #F0EEEC;
      background: #FAF9F7;
    }
    .peek-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 600;
      color: #B45309;
      background: #FFFBEB;
      border: 1px solid #FDE68A;
      border-radius: 6px;
      padding: 2px 7px;
    }
    .peek-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn {
      border: 1px solid #E7E5E4;
      background: #FFFFFF;
      color: #1C1917;
      border-radius: 7px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-decoration: none;
      transition: all 0.12s ease;
    }
    .btn:hover { background: #F7F6F3; border-color: #D6D3D1; }
    .btn-gold {
      background: #D97706;
      border-color: #D97706;
      color: #FFFFFF;
    }
    .btn-gold:hover { background: #B45309; border-color: #B45309; }
    .peek-body {
      padding: 11px 12px;
      max-height: 360px;
      overflow-y: auto;
    }
    .peek-img-wrap {
      background: #F7F6F3;
      border: 1px solid #EFECE9;
      border-radius: 9px;
      padding: 6px;
      text-align: center;
      cursor: zoom-in;
    }
    .peek-img {
      max-width: 100%;
      max-height: 220px;
      object-fit: contain;
      border-radius: 5px;
      display: block;
      margin: 0 auto;
    }
    .peek-caption {
      margin-top: 8px;
      font-size: 11.5px;
      line-height: 1.5;
      color: #57534E;
    }
    .peek-table-wrap {
      overflow: auto;
      max-height: 210px;
      border: 1px solid #E7E5E4;
      border-radius: 8px;
      background: #FFFFFF;
    }
    .peek-table-wrap table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    .peek-table-wrap th, .peek-table-wrap td {
      border: 1px solid #EFECE9;
      padding: 4px 6px;
      text-align: left;
      white-space: nowrap;
    }
    .peek-table-wrap th {
      background: #F7F6F3;
      font-weight: 600;
      color: #1C1917;
    }
    .peek-eq {
      padding: 10px 12px;
      border-radius: 8px;
      background: #F7F6F3;
      border: 1px solid #E7E5E4;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #1C1917;
      word-break: break-word;
    }
    .ref-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .ref-tab {
      border: 1px solid #E7E5E4;
      background: #F7F6F3;
      color: #57534E;
      border-radius: 6px;
      padding: 2px 7px;
      font-size: 11px;
      cursor: pointer;
    }
    .ref-tab.active {
      background: #FFFBEB;
      border-color: #FDE68A;
      color: #B45309;
      font-weight: 600;
    }
    .ref-title {
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.45;
      color: #1C1917;
    }
    .ref-meta {
      margin-top: 5px;
      font-size: 11px;
      line-height: 1.45;
      color: #78716C;
    }
    .ref-raw {
      margin-top: 6px;
      font-size: 11px;
      line-height: 1.5;
      color: #57534E;
      background: #FAF9F7;
      border: 1px solid #F0EEEC;
      border-radius: 8px;
      padding: 7px 9px;
    }
    .return-banner {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: auto;
      display: none;
      align-items: center;
      gap: 6px;
      background: #1C1917;
      color: #FFFFFF;
      padding: 6px 8px 6px 12px;
      border-radius: 999px;
      box-shadow: 0 10px 30px rgba(28, 25, 23, 0.25);
      font-size: 12px;
    }
    .return-btn {
      border: none;
      background: transparent;
      color: #FDE68A;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      padding: 2px 4px;
    }
    .return-close {
      border: none;
      background: rgba(255,255,255,0.12);
      color: #E7E5E4;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 12px;
    }
    .lightbox {
      position: fixed;
      inset: 0;
      pointer-events: auto;
      background: rgba(28, 25, 23, 0.78);
      backdrop-filter: blur(4px);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 28px;
    }
    .lightbox-card {
      background: #FFFFFF;
      border-radius: 14px;
      max-width: 90vw;
      max-height: 86vh;
      overflow: auto;
      padding: 14px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
      text-align: center;
    }
    .lightbox-img {
      max-width: 84vw;
      max-height: 70vh;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .lightbox-cap {
      margin-top: 10px;
      font-size: 12px;
      color: #57534E;
      max-width: 760px;
      line-height: 1.5;
      text-align: left;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: none;
      background: #1C1917;
      color: #FFFFFF;
      font-size: 12px;
      padding: 7px 14px;
      border-radius: 999px;
      box-shadow: 0 10px 28px rgba(28, 25, 23, 0.25);
      display: none;
    }
    .snip-overlay {
      position: fixed;
      inset: 0;
      pointer-events: auto;
      background: rgba(28, 25, 23, 0.24);
      cursor: crosshair;
      display: none;
      user-select: none;
    }
    .snip-hint {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      background: #1C1917;
      color: #FFFFFF;
      font-size: 12px;
      padding: 7px 14px;
      border-radius: 999px;
      box-shadow: 0 10px 28px rgba(28, 25, 23, 0.28);
      pointer-events: none;
    }
    .snip-box {
      position: fixed;
      border: 2px solid #D97706;
      background: rgba(254, 243, 199, 0.22);
      border-radius: 4px;
      pointer-events: none;
      display: none;
    }
    .dock-zoom {
      position: fixed;
      right: 16px;
      pointer-events: none;
      width: min(680px, calc(100vw - 32px));
      background: #FFFFFF;
      border: 1px solid #FDE68A;
      border-radius: 14px;
      box-shadow: 0 24px 64px -8px rgba(28, 25, 23, 0.24), 0 8px 20px -4px rgba(28, 25, 23, 0.12);
      color: #1C1917;
      overflow: hidden;
      display: none;
      opacity: 0;
      transform: scale(0.86) translate3d(12px, 0, 0);
      transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out;
      will-change: transform, opacity;
    }
    .dock-zoom.open {
      opacity: 1;
      transform: scale(1) translate3d(0, 0, 0);
    }
    .dock-zoom-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 13px;
      border-bottom: 1px solid #F0EEEC;
      background: #FAF9F7;
    }
    .dock-zoom-title {
      font-size: 12.5px;
      font-weight: 600;
      color: #1C1917;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .dock-zoom-body {
      padding: 12px 14px;
      max-height: 76vh;
      overflow: hidden;
    }
    .dock-zoom-img-wrap {
      background: #F7F6F3;
      border: 1px solid #EFECE9;
      border-radius: 10px;
      padding: 8px;
      text-align: center;
    }
    .dock-zoom-img {
      max-width: 100%;
      max-height: min(60vh, 540px);
      object-fit: contain;
      display: block;
      margin: 0 auto;
      border-radius: 6px;
    }
    .dock-zoom-cap {
      margin-top: 9px;
      font-size: 12px;
      line-height: 1.55;
      color: #57534E;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `;

  peekEl = document.createElement('div');
  peekEl.className = 'peek';
  peekEl.addEventListener('mouseenter', () => {
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  });
  peekEl.addEventListener('mouseleave', scheduleHidePeek);

  dockZoomEl = document.createElement('div');
  dockZoomEl.className = 'dock-zoom';

  returnEl = document.createElement('div');
  returnEl.className = 'return-banner';
  returnEl.innerHTML = `<button type="button" class="return-btn">${t('reader.return')}</button><button type="button" class="return-close" aria-label="${t('common.close')}">×</button>`;
  returnEl.querySelector('.return-btn')?.addEventListener('click', () => {
    if (savedScrollY !== null) {
      window.scrollTo({ top: savedScrollY, behavior: 'smooth' });
      savedScrollY = null;
    }
    if (returnEl) returnEl.style.display = 'none';
  });
  returnEl.querySelector('.return-close')?.addEventListener('click', () => {
    savedScrollY = null;
    if (returnEl) returnEl.style.display = 'none';
  });

  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox';
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl && lightboxEl) {
      lightboxEl.style.display = 'none';
    }
  });

  toastEl = document.createElement('div');
  toastEl.className = 'toast';

  snipEl = document.createElement('div');
  snipEl.className = 'snip-overlay';

  shadowRoot.append(style, peekEl, dockZoomEl, returnEl, lightboxEl, toastEl, snipEl);
  document.documentElement.appendChild(host);
  return shadowRoot;
}

function showToast(message: () => string): void {
  ensureShadowUi();
  if (!toastEl) return;
  toastMessage = message;
  toastEl.textContent = message();
  toastEl.style.display = 'block';
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMessage = undefined;
    if (toastEl) toastEl.style.display = 'none';
  }, 1900);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jumpToAnchor(anchorId: string | undefined): void {
  if (!anchorId || !parsedPaper) return;
  const target =
    parsedPaper.anchorElements.get(anchorId) ||
    document.getElementById(anchorId) ||
    document.querySelector<HTMLElement>(`[data-refpin-anchor="${CSS.escape(anchorId)}"]`);
  if (!target) return;

  savedScrollY = window.scrollY;
  hidePeekImmediately();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  target.classList.remove('refpin-target-flash');
  void target.offsetWidth;
  target.classList.add('refpin-target-flash');

  ensureShadowUi();
  if (returnEl) returnEl.style.display = 'inline-flex';
}

function openInPageLightbox(imageUrl: string, caption: string): void {
  ensureShadowUi();
  if (!lightboxEl) return;
  lightboxEl.innerHTML = `
    <div class="lightbox-card">
      <img class="lightbox-img" src="${escapeHtml(imageUrl)}" alt="" />
      <div class="lightbox-cap">${escapeHtml(caption)}</div>
    </div>
  `;
  lightboxEl.style.display = 'flex';
}

function pinAssetToSidePanel(asset: CompanionAsset): void {
  const item: CompanionPinItem = {
    id: asset.key,
    kind: asset.kind,
    source: 'dom',
    title: asset.label,
    subtitle: asset.caption,
    imageUrl: asset.imageUrl,
    tableHtml: asset.tableHtml,
    textPreview: asset.textPreview,
    domAnchorId: asset.domAnchorId,
    pinnedAt: Date.now(),
  };

  void chrome.runtime.sendMessage({
    type: 'REFPIN_PIN_FROM_PAGE',
    tabUrl: window.location.href,
    item,
    openSidePanel: true,
  });
  showToast(() => t('panel.assetPinned', { name: asset.label }));
}

function pinReferenceToSidePanel(ref: CompanionReference): void {
  const item: CompanionPinItem = {
    id: ref.key,
    kind: 'reference',
    source: 'dom',
    title: `[${ref.index}] ${ref.title}`,
    subtitle: [ref.authors, ref.year].filter(Boolean).join(' · '),
    domAnchorId: ref.domAnchorId,
    reference: ref,
    pinnedAt: Date.now(),
  };

  void chrome.runtime.sendMessage({
    type: 'REFPIN_PIN_FROM_PAGE',
    tabUrl: window.location.href,
    item,
    openSidePanel: true,
  });
  showToast(() => t('panel.refPinned', { index: ref.index }));
}

function hidePeekImmediately(): void {
  if (openTimer) {
    window.clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (peekEl) peekEl.style.display = 'none';
  activeBinding = null;
  activeAnchorEl = null;
}

function scheduleHidePeek(): void {
  if (openTimer) {
    window.clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer) window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    if (peekEl) peekEl.style.display = 'none';
    activeBinding = null;
    activeAnchorEl = null;
  }, 260);
}

function positionPeekCard(anchorEl: HTMLElement): void {
  if (!peekEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const cardWidth = Math.min(390, window.innerWidth - 24);
  const cardHeight = peekEl.offsetHeight || 280;

  let left = rect.left + rect.width / 2 - cardWidth / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - cardWidth - 12));

  let top = rect.bottom + 8;
  if (top + cardHeight > window.innerHeight - 12) {
    top = Math.max(12, rect.top - cardHeight - 8);
  }

  peekEl.style.left = `${Math.round(left)}px`;
  peekEl.style.top = `${Math.round(top)}px`;
}

function renderPeekCard(): void {
  if (!peekEl || !activeBinding || !activeAnchorEl) return;

  if (activeBinding.asset) {
    const asset = activeBinding.asset;
    const bodyHtml = asset.imageUrl
      ? `<div class="peek-img-wrap" data-action="zoom"><img class="peek-img" src="${escapeHtml(asset.imageUrl)}" alt="${escapeHtml(asset.label)}" /></div>`
      : asset.tableHtml
        ? `<div class="peek-table-wrap">${asset.tableHtml}</div>`
        : `<div class="peek-eq">${escapeHtml(asset.textPreview || asset.caption)}</div>`;

    peekEl.innerHTML = `
      <div class="peek-head">
        <span class="peek-badge">${escapeHtml(asset.label)}</span>
        <div class="peek-actions">
          ${asset.imageUrl ? `<button type="button" class="btn" data-action="zoom">${t('reader.zoomIn')}</button>` : ''}
          ${asset.domAnchorId ? `<button type="button" class="btn" data-action="jump">${t('pin.locate')}</button>` : ''}
          <button type="button" class="btn btn-gold" data-action="pin">${t('assets.pin')}</button>
        </div>
      </div>
      <div class="peek-body">
        ${bodyHtml}
        <div class="peek-caption">${escapeHtml(asset.caption)}</div>
      </div>
    `;

    peekEl.querySelectorAll('[data-action="zoom"]').forEach((el) => {
      el.addEventListener('click', () => {
        if (asset.imageUrl) openInPageLightbox(asset.imageUrl, asset.caption);
      });
    });
    peekEl.querySelector('[data-action="jump"]')?.addEventListener('click', () => {
      jumpToAnchor(asset.domAnchorId);
    });
    peekEl.querySelector('[data-action="pin"]')?.addEventListener('click', () => {
      pinAssetToSidePanel(asset);
    });
  } else if (activeBinding.references && activeBinding.references.length > 0) {
    const refs = activeBinding.references;
    const safeIdx = Math.min(activeRefTabIndex, refs.length - 1);
    const ref = refs[safeIdx];
    const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(ref.title || ref.rawText)}`;

    const tabsHtml =
      refs.length > 1
        ? `<div class="ref-tabs">${refs
            .map(
              (r, idx) =>
                `<button type="button" class="ref-tab ${idx === safeIdx ? 'active' : ''}" data-ref-tab="${idx}">[${r.index}]</button>`,
            )
            .join('')}</div>`
        : '';

    peekEl.innerHTML = `
      <div class="peek-head">
        <span class="peek-badge">${t('reference.number', { index: ref.index })}</span>
        <div class="peek-actions">
          <a class="btn" href="${escapeHtml(ref.href || scholarUrl)}" target="_blank" rel="noopener noreferrer">Scholar ↗</a>
          ${ref.domAnchorId ? `<button type="button" class="btn" data-action="jump">${t('pin.locate')}</button>` : ''}
          <button type="button" class="btn btn-gold" data-action="pin">${t('assets.pin')}</button>
        </div>
      </div>
      <div class="peek-body">
        ${tabsHtml}
        <div class="ref-title">${escapeHtml(ref.title)}</div>
        ${ref.authors || ref.year ? `<div class="ref-meta">${escapeHtml([ref.authors, ref.year].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="ref-raw">${escapeHtml(ref.rawText)}</div>
      </div>
    `;

    peekEl.querySelectorAll<HTMLButtonElement>('[data-ref-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeRefTabIndex = Number(btn.dataset.refTab) || 0;
        renderPeekCard();
      });
    });
    peekEl.querySelector('[data-action="jump"]')?.addEventListener('click', () => {
      jumpToAnchor(ref.domAnchorId);
    });
    peekEl.querySelector('[data-action="pin"]')?.addEventListener('click', () => {
      pinReferenceToSidePanel(ref);
    });
  }

  peekEl.style.display = 'block';
  positionPeekCard(activeAnchorEl);
}

function bindInteractiveCitation(el: HTMLElement, binding: CitationBinding): void {
  if (el.dataset.refpinBound === '1') return;
  el.dataset.refpinBound = '1';
  el.classList.add('refpin-cite-mark');
  citationCount += 1;

  el.addEventListener('mouseenter', () => {
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (openTimer) window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => {
      ensureShadowUi();
      activeBinding = binding;
      activeAnchorEl = el;
      activeRefTabIndex = 0;
      renderPeekCard();
    }, 120);
  });

  el.addEventListener('mouseleave', scheduleHidePeek);
}

function expandNumericList(spec: string): number[] {
  const result: number[] = [];
  for (const part of spec.split(/[,，]/)) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 12) {
        for (let i = start; i <= end; i += 1) result.push(i);
      }
      continue;
    }
    const single = trimmed.match(/^\d+$/);
    if (single) result.push(Number(single[0]));
  }
  return result;
}

function resolveBindingFromText(
  text: string,
  paper: ParsedDomPaper,
): CitationBinding | null {
  const figMatch = text.match(
    /(?:Fig(?:ure)?\.?\s*([A-Z]?\d+(?:\.\d+)?[a-z]?)|(?:附图|图)\s*(\d+(?:\.\d+)?[a-z]?))/i,
  );
  if (figMatch) {
    const num = (figMatch[1] || figMatch[2]).toLowerCase();
    const asset =
      paper.assetsByKey.get(`fig:${num}`) ||
      paper.assetsByKey.get(`fig:${num.replace(/[a-z]$/, '')}`);
    if (asset) return { asset };
  }

  const tblMatch = text.match(
    /(?:Tab(?:le)?\.?\s*([A-Z]?\d+(?:\.\d+)?|[IVX]+)|(?:附表|表)\s*(\d+(?:\.\d+)?))/i,
  );
  if (tblMatch) {
    const num = (tblMatch[1] || tblMatch[2]).toLowerCase();
    const asset = paper.assetsByKey.get(`table:${num}`);
    if (asset) return { asset };
  }

  const eqMatch = text.match(
    /(?:Eq(?:uation)?\.?\s*\(?(\d+(?:\.\d+)?)\)?|(?:公式|式)\s*[（(]?(\d+(?:\.\d+)?)[）)]?)/i,
  );
  if (eqMatch) {
    const num = eqMatch[1] || eqMatch[2];
    const asset = paper.assetsByKey.get(`eq:${num}`);
    if (asset) return { asset };
  }

  const refMatch = text.match(/^[\[\【]\s*(\d+(?:\s*[-–—,，]\s*\d+)*)\s*[\]\】]$/);
  if (refMatch) {
    const nums = expandNumericList(refMatch[1]);
    const refs = nums
      .map((n) => paper.refsByIndex.get(n))
      .filter((r): r is CompanionReference => Boolean(r));
    if (refs.length > 0) return { references: refs };
  }

  return null;
}

function annotateInPageCitations(paper: ParsedDomPaper): void {
  if (paper.assetsByKey.size === 0 && paper.refsByIndex.size === 0) return;
  injectHostStyles();

  // 路线 1：优先挂接原网页已有的内部锚点 <a>（零 DOM 侵入）
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="#"]'));
  for (const a of anchors) {
    if (a.dataset.refpinBound === '1') continue;
    if (a.closest('nav, header, footer, figure, figcaption, .ltx_bibliography, #references')) {
      continue;
    }

    const hashIndex = a.href.indexOf('#');
    if (hashIndex < 0) continue;
    const targetId = decodeURIComponent(a.href.slice(hashIndex + 1));

    const assetById = paper.assetsByElementId.get(targetId);
    if (assetById) {
      bindInteractiveCitation(a, { asset: assetById });
      continue;
    }

    const refById = paper.refsByElementId.get(targetId);
    if (refById) {
      bindInteractiveCitation(a, { references: [refById] });
      continue;
    }

    const text = (a.textContent || '').trim();
    if (text.length > 0 && text.length <= 28) {
      const byText = resolveBindingFromText(text, paper);
      if (byText) {
        bindInteractiveCitation(a, byText);
      }
    }
  }

  // 路线 2：无超链接的纯文本引用兜底（仅匹配已提取到的真实图表/文献，零误伤）
  const root =
    document.querySelector<HTMLElement>(
      'main, article, .ltx_page_main, [role="main"]',
    ) || document.body;
  if (!root) return;

  const citeRegex =
    /(?:\b(?:Fig(?:ure)?\.?|Tab(?:le)?\.?|Eq(?:uation)?\.?)\s*\(?[A-Z]?\d+(?:\.\d+)?[a-z]?\)?|(?:附图|附表|图|表)\s*\d+(?:\.\d+)?[a-z]?|(?:公式|式)\s*[（(]?\d+(?:\.\d+)?[）)]?|[\[\【]\s*\d+(?:\s*[-–—,，]\s*\d+)*\s*[\]\】])/g;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (
        parent.closest(
          'script, style, noscript, code, pre, textarea, input, button, a, figure, figcaption, nav, header, footer, aside, .ltx_bibliography, #references, .references, [data-refpin-bound="1"]',
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      const val = node.nodeValue;
      if (!val || val.length < 2) return NodeFilter.FILTER_REJECT;
      return citeRegex.test(val) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current && textNodes.length < 1500) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const raw = textNode.nodeValue || '';
    citeRegex.lastIndex = 0;
    let lastIdx = 0;
    let matchedAny = false;
    const frag = document.createDocumentFragment();

    let match = citeRegex.exec(raw);
    while (match) {
      const token = match[0];
      const binding = resolveBindingFromText(token, paper);
      if (binding) {
        matchedAny = true;
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(raw.slice(lastIdx, match.index)));
        }
        const span = document.createElement('span');
        span.textContent = token;
        bindInteractiveCitation(span, binding);
        frag.appendChild(span);
        lastIdx = match.index + token.length;
      }
      match = citeRegex.exec(raw);
    }

    if (matchedAny && textNode.parentNode) {
      if (lastIdx < raw.length) {
        frag.appendChild(document.createTextNode(raw.slice(lastIdx)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
}

// ---- 页内自由框选截图（Free Snip）----
async function cropDataUrl(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
      const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);
      const sx = Math.max(0, Math.round(rect.x * scaleX));
      const sy = Math.max(0, Math.round(rect.y * scaleY));
      const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(rect.width * scaleX)));
      const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(rect.height * scaleY)));

      const maxEdge = 1600;
      const ratio = Math.min(1, maxEdge / Math.max(sw, sh));
      const outW = Math.max(1, Math.round(sw * ratio));
      const outH = Math.max(1, Math.round(sh * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error(t('reader.canvasError')));
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const webp = canvas.toDataURL('image/webp', 0.92);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(t('snip.screenshotFailed')));
    img.src = dataUrl;
  });
}

function startPageSnipMode(): void {
  ensureShadowUi();
  if (!snipEl) return;
  hidePeekImmediately();
  hideDockZoomPreview();

  snipEl.innerHTML = `
    <div class="snip-hint">${t('snip.hud')}</div>
    <div class="snip-box"></div>
  `;
  const boxEl = snipEl.querySelector<HTMLDivElement>('.snip-box')!;
  snipEl.style.display = 'block';

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const cx = Math.max(0, Math.min(window.innerWidth, e.clientX));
    const cy = Math.max(0, Math.min(window.innerHeight, e.clientY));
    const x = Math.min(startX, cx);
    const y = Math.min(startY, cy);
    const w = Math.abs(cx - startX);
    const h = Math.abs(cy - startY);
    boxEl.style.left = `${x}px`;
    boxEl.style.top = `${y}px`;
    boxEl.style.width = `${w}px`;
    boxEl.style.height = `${h}px`;
  };

  const onUp = (e: MouseEvent) => {
    if (!dragging) return;
    dragging = false;
    const cx = Math.max(0, Math.min(window.innerWidth, e.clientX));
    const cy = Math.max(0, Math.min(window.innerHeight, e.clientY));
    const rect = {
      x: Math.min(startX, cx),
      y: Math.min(startY, cy),
      width: Math.abs(cx - startX),
      height: Math.abs(cy - startY),
    };
    cleanup();

    if (rect.width < 12 || rect.height < 12) return;

    // 等待两帧确保遮罩完全消失后再截图
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void (async () => {
          try {
            const resp = (await chrome.runtime.sendMessage({
              type: 'REFPIN_CAPTURE_VISIBLE_TAB',
            })) as { ok?: boolean; dataUrl?: string; error?: string } | undefined;

            if (!resp?.ok || !resp.dataUrl) {
              showToast(() => t('snip.captureError', { reason: resp?.error || t('panel.refreshPage') }));
              return;
            }

            const croppedUrl = await cropDataUrl(resp.dataUrl, rect);
            const pinnedAt = Date.now();
            const item: CompanionPinItem = {
              id: `snip:${pinnedAt}`,
              kind: 'snip',
              source: 'snip',
              title: timedSnipTitle(pinnedAt),
              automaticTitle: true,
              subtitle: document.title || window.location.hostname,
              imageUrl: croppedUrl,
              pinnedAt,
            };

            await chrome.runtime.sendMessage({
              type: 'REFPIN_PIN_FROM_PAGE',
              tabUrl: window.location.href,
              item,
              openSidePanel: true,
            });
            showToast(() => t('snip.pinned'));
          } catch {
            showToast(() => t('snip.failed'));
          }
        })();
      });
    });
  };

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  };

  const cleanup = () => {
    dragging = false;
    if (snipEl) {
      snipEl.style.display = 'none';
      snipEl.onmousedown = null;
    }
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onEsc, true);
  };

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onEsc, true);

  snipEl.onmousedown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    boxEl.style.display = 'block';
    boxEl.style.left = `${startX}px`;
    boxEl.style.top = `${startY}px`;
    boxEl.style.width = '0px';
    boxEl.style.height = '0px';
  };
}

function runExtraction(force = false): ParsedDomPaper {
  parsedPaper = extractDomPaper(force);
  if (parsedPaper.payload.isAcademicPage || force) {
    isActivated = true;
    annotateInPageCitations(parsedPaper);
    parsedPaper.payload.citationCount = citationCount;
  }
  return parsedPaper;
}

// 学术 HTML 页面自动无感激活；普通网站零开销休眠
if (isLikelyAcademicHtmlPage()) {
  runExtraction(false);
}

function showDockZoomPreview(
  item: CompanionPinItem,
  anchorCenterRatio: number,
): void {
  ensureShadowUi();
  if (!dockZoomEl) return;

  if (dockZoomUnmountTimer !== null) {
    window.clearTimeout(dockZoomUnmountTimer);
    dockZoomUnmountTimer = null;
  }

  dockPreview = { item, anchorCenterRatio };
  const kindLabel = t(`kind.${item.kind}`);
  const pageTag = item.pageNumber
    ? `<span style="font-family: ui-monospace, monospace; font-size: 11px; color: #78716C;"> ${t('reader.page', { page: item.pageNumber })}</span>`
    : '';

  let bodyHtml = '';
  if (item.imageUrl) {
    bodyHtml = `
      <div class="dock-zoom-img-wrap">
        <img class="dock-zoom-img" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(pinTitle(item))}" />
      </div>
      ${item.subtitle ? `<div class="dock-zoom-cap">${escapeHtml(item.subtitle)}</div>` : ''}
    `;
  } else if (item.tableHtml) {
    bodyHtml = `
      <div class="peek-table-wrap" style="max-height: 52vh;">${item.tableHtml}</div>
      ${item.subtitle ? `<div class="dock-zoom-cap">${escapeHtml(item.subtitle)}</div>` : ''}
    `;
  } else if (item.reference) {
    const meta = [item.reference.authors, item.reference.year].filter(Boolean).join(' · ');
    bodyHtml = `
      <div class="ref-title" style="font-size: 13.5px;">${escapeHtml(item.reference.title)}</div>
      ${meta ? `<div class="ref-meta">${escapeHtml(meta)}</div>` : ''}
      <div class="ref-raw" style="font-size: 12px; max-height: 44vh; overflow: hidden;">${escapeHtml(item.reference.rawText)}</div>
    `;
  } else if (item.textPreview || item.subtitle) {
    bodyHtml = `<div class="peek-eq">${escapeHtml(item.textPreview || item.subtitle || '')}</div>`;
  }

  dockZoomEl.innerHTML = `
    <div class="dock-zoom-head">
      <span class="peek-badge">${escapeHtml(kindLabel)}</span>
      <span class="dock-zoom-title">${escapeHtml(pinTitle(item))}</span>
      ${pageTag}
    </div>
    <div class="dock-zoom-body">${bodyHtml}</div>
  `;

  const anchorBottom = anchorCenterRatio > 0.54;
  if (anchorBottom) {
    dockZoomEl.style.top = 'auto';
    dockZoomEl.style.bottom = '18px';
    dockZoomEl.style.transformOrigin = 'right bottom';
  } else {
    dockZoomEl.style.bottom = 'auto';
    dockZoomEl.style.top = `${Math.max(18, Math.round(window.innerHeight * Math.min(0.45, Math.max(0.06, anchorCenterRatio - 0.14))))}px`;
    dockZoomEl.style.transformOrigin = 'right top';
  }

  dockZoomEl.style.display = 'block';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dockZoomEl?.classList.add('open');
    });
  });
}

function hideDockZoomPreview(): void {
  dockPreview = undefined;
  if (!dockZoomEl) return;
  dockZoomEl.classList.remove('open');
  if (dockZoomUnmountTimer !== null) window.clearTimeout(dockZoomUnmountTimer);
  dockZoomUnmountTimer = window.setTimeout(() => {
    dockZoomUnmountTimer = null;
    if (dockZoomEl) dockZoomEl.style.display = 'none';
  }, 200);
}

// ---- 原网页整篇翻译引擎（默认仅看译文，支持双语 / 原文秒切，完整保护行内公式不乱码）----
interface TranslatableBlock {
  el: HTMLElement;
  trEl: HTMLElement;
  sourceText: string;
  mathNodes: Node[];
  done: boolean;
}

function extractProtectedBlockText(el: HTMLElement): {
  text: string;
  mathNodes: Node[];
} {
  const clone = el.cloneNode(true) as HTMLElement;
  // 先移除所有隐藏的 LaTeX/MathML 重复语义层，彻底杜绝 arXiv/Nature/IEEE 公式双份乱码
  clone
    .querySelectorAll(
      'annotation, annotation-xml, .katex-mathml, .MJX_Assistive_MathML, mjx-assistive-mml, script, style, .sr-only',
    )
    .forEach((node) => node.remove());

  const mathNodes: Node[] = [];
  const mathCandidates = Array.from(
    clone.querySelectorAll('math, .katex, mjx-container, .MathJax, .ltx_Math'),
  );

  for (const node of mathCandidates) {
    // 跳过已被外层公式容器替换掉的子节点
    if (!clone.contains(node)) continue;
    const idx = mathNodes.length;
    mathNodes.push(node.cloneNode(true));
    node.replaceWith(document.createTextNode(` [[M${idx}]] `));
  }

  const text = (clone.textContent || '')
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { text, mathNodes };
}

function renderTranslatedBlockWithMath(
  container: HTMLElement,
  translated: string,
  mathNodes: Node[],
): void {
  container.textContent = '';
  if (mathNodes.length === 0) {
    container.textContent = translated;
    return;
  }

  const tokenRegex = /\[\[\s*M\s*(\d+)\s*\]\]/gi;
  let lastIdx = 0;
  let match = tokenRegex.exec(translated);

  while (match) {
    if (match.index > lastIdx) {
      container.appendChild(document.createTextNode(translated.slice(lastIdx, match.index)));
    }
    const idx = Number(match[1]);
    const mathNode = mathNodes[idx];
    if (mathNode) {
      container.appendChild(mathNode.cloneNode(true));
    }
    lastIdx = match.index + match[0].length;
    match = tokenRegex.exec(translated);
  }

  if (lastIdx < translated.length) {
    container.appendChild(document.createTextNode(translated.slice(lastIdx)));
  }
}

let trBlocks: TranslatableBlock[] = [];
let trDisplayMode: TranslateDisplayMode = 'off';
let trRunning = false;
let trRunToken = 0;
let trLastError: DisplayMessage | undefined;

function getPageTranslateStatus(): PageTranslateStatus {
  const done = trBlocks.filter((b) => b.done).length;
  return {
    active: trDisplayMode !== 'off',
    displayMode: trDisplayMode,
    done,
    total: trBlocks.length,
    running: trRunning,
    error: trLastError,
  };
}

function pushPageTranslateStatus(): void {
  void chrome.runtime
    .sendMessage({
      type: 'REFPIN_PAGE_TRANSLATE_STATUS_PUSH',
      tabUrl: window.location.href,
      status: getPageTranslateStatus(),
    })
    .catch(() => {});
}

function annotateTranslatedBlockCitations(container: HTMLElement): void {
  if (!parsedPaper) return;
  if (parsedPaper.assetsByKey.size === 0 && parsedPaper.refsByIndex.size === 0) return;

  const citeRegex =
    /(?:\b(?:Fig(?:ure)?\.?|Tab(?:le)?\.?|Eq(?:uation)?\.?)\s*\(?[A-Z]?\d+(?:\.\d+)?[a-z]?\)?|(?:附图|附表|图|表)\s*\d+(?:\.\d+)?[a-z]?|(?:公式|式)\s*[（(]?\d+(?:\.\d+)?[）)]?|[\[\【]\s*\d+(?:\s*[-–—,，]\s*\d+)*\s*[\]\】])/g;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let cur = walker.nextNode();
  while (cur) {
    nodes.push(cur as Text);
    cur = walker.nextNode();
  }

  for (const textNode of nodes) {
    const raw = textNode.nodeValue || '';
    citeRegex.lastIndex = 0;
    let lastIdx = 0;
    let matched = false;
    const frag = document.createDocumentFragment();
    let m = citeRegex.exec(raw);
    while (m) {
      const binding = resolveBindingFromText(m[0], parsedPaper);
      if (binding) {
        matched = true;
        if (m.index > lastIdx) {
          frag.appendChild(document.createTextNode(raw.slice(lastIdx, m.index)));
        }
        const span = document.createElement('span');
        span.textContent = m[0];
        bindInteractiveCitation(span, binding);
        frag.appendChild(span);
        lastIdx = m.index + m[0].length;
      }
      m = citeRegex.exec(raw);
    }
    if (matched && textNode.parentNode) {
      if (lastIdx < raw.length) {
        frag.appendChild(document.createTextNode(raw.slice(lastIdx)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
}

function collectTranslatableBlocks(): TranslatableBlock[] {
  if (trBlocks.length > 0 && trBlocks.some((b) => b.el.isConnected)) {
    return trBlocks.filter((b) => b.el.isConnected);
  }

  injectHostStyles();
  const root =
    document.querySelector<HTMLElement>(
      'main, article, .ltx_page_main, [role="main"]',
    ) || document.body;
  if (!root) return [];

  const selector = [
    'h1',
    'h2',
    'h3',
    'h4',
    'p',
    'figcaption',
    '.ltx_caption',
    '.ltx_abstract',
    'li',
  ].join(',');

  const rawEls = Array.from(root.querySelectorAll<HTMLElement>(selector));
  const selected: HTMLElement[] = [];
  const selectedSet = new Set<HTMLElement>();

  for (const el of rawEls) {
    if (el.classList.contains('refpin-tr-block')) continue;
    if (
      el.closest(
        'nav, header, footer, aside, pre, code, script, style, form, .ltx_bibliography, #references, .references, .ref-list, [role="doc-biblioentry"], table',
      )
    ) {
      continue;
    }
    // 如果祖先已经在待翻列表里，跳过避免重复翻译
    let ancestor: HTMLElement | null = el.parentElement;
    let nested = false;
    while (ancestor) {
      if (selectedSet.has(ancestor)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nested) continue;

    // 跳过包含嵌套 <p> 的大容器（只翻最内层段落）
    if (el.tagName !== 'P' && el.querySelector('p')) continue;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4) continue;
    // 纯数字/符号行跳过
    if (/^[\d\s.,;:()[\]{}+\-*/=<>%]+$/.test(text)) continue;

    selected.push(el);
    selectedSet.add(el);
  }

  const blocks: TranslatableBlock[] = [];
  for (const el of selected) {
    const { text, mathNodes } = extractProtectedBlockText(el);
    if (!text || text.replace(/\[\[M\d+\]\]/g, '').trim().length < 3) continue;

    let trEl = el.nextElementSibling as HTMLElement | null;
    if (!trEl || !trEl.classList.contains('refpin-tr-block')) {
      const tag = /^H[1-4]$/.test(el.tagName) ? el.tagName.toLowerCase() : 'div';
      trEl = document.createElement(tag);
      trEl.className = 'refpin-tr-block';
      if (/^H[1-4]$/.test(el.tagName)) {
        trEl.classList.add('refpin-tr-heading');
        const computed = window.getComputedStyle(el);
        trEl.style.fontSize = computed.fontSize;
      } else if (el.tagName === 'FIGCAPTION' || el.classList.contains('ltx_caption')) {
        trEl.classList.add('refpin-tr-caption');
      }
      el.insertAdjacentElement('afterend', trEl);
    }

    blocks.push({
      el,
      trEl,
      sourceText: text,
      mathNodes,
      done: trEl.dataset.refpinTrDone === '1',
    });
  }

  trBlocks = blocks;
  return blocks;
}

function setPageTranslateMode(mode: TranslateDisplayMode): PageTranslateStatus {
  injectHostStyles();
  trDisplayMode = mode;
  document.documentElement.setAttribute('data-refpin-tr-mode', mode);
  if (mode === 'off') {
    trRunToken += 1;
    trRunning = false;
  }
  pushPageTranslateStatus();
  return getPageTranslateStatus();
}

function stopPageTranslation(): PageTranslateStatus {
  trRunToken += 1;
  trRunning = false;
  pushPageTranslateStatus();
  return getPageTranslateStatus();
}

async function startPageTranslation(
  preferredMode: Exclude<TranslateDisplayMode, 'off'> = 'translated',
): Promise<void> {
  if (!parsedPaper) {
    runExtraction(true);
  }
  const blocks = collectTranslatableBlocks();
  trLastError = undefined;
  trDisplayMode = preferredMode;
  document.documentElement.setAttribute('data-refpin-tr-mode', preferredMode);

  const pending = blocks.filter((b) => !b.done);
  if (pending.length === 0) {
    trRunning = false;
    pushPageTranslateStatus();
    return;
  }

  // 当前视口内段落优先排序，1 秒内先看到眼前中文，再流式补齐整篇
  const vh = window.innerHeight || 800;
  pending.sort((a, b) => {
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    const aVis = ra.bottom >= -120 && ra.top <= vh + 240 ? 0 : 1;
    const bVis = rb.bottom >= -120 && rb.top <= vh + 240 ? 0 : 1;
    if (aVis !== bVis) return aVis - bVis;
    return Math.abs(ra.top) - Math.abs(rb.top);
  });

  const token = ++trRunToken;
  trRunning = true;
  pushPageTranslateStatus();

  const BATCH_SIZE = 4;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (token !== trRunToken) return;
    const batch = pending.slice(i, i + BATCH_SIZE);
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: 'REFPIN_TRANSLATE_BATCH',
        texts: batch.map((b) => b.sourceText),
      })) as { ok?: boolean; translations?: string[]; error?: DisplayMessage } | undefined;

      if (token !== trRunToken) return;
      if (!resp?.ok || !Array.isArray(resp.translations)) {
        trLastError = resp?.error || message('translate.requestFailed');
        trRunning = false;
        pushPageTranslateStatus();
        return;
      }

      batch.forEach((block, idx) => {
        const translated = resp.translations?.[idx] || '';
        if (!translated) return;
        renderTranslatedBlockWithMath(block.trEl, translated, block.mathNodes);
        block.trEl.dataset.refpinTrDone = '1';
        block.el.classList.add('refpin-tr-orig-done');
        block.done = true;
        annotateTranslatedBlockCitations(block.trEl);
      });
      pushPageTranslateStatus();
    } catch (error) {
      if (token !== trRunToken) return;
      trLastError = describeError(error, message('translate.requestFailed'));
      trRunning = false;
      pushPageTranslateStatus();
      return;
    }
  }

  if (token === trRunToken) {
    trRunning = false;
    pushPageTranslateStatus();
  }
}

// 快捷键：Esc 收起浮窗/灯箱；Alt+S 在已激活论文页触发自由框选
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hidePeekImmediately();
    hideDockZoomPreview();
    if (lightboxEl) lightboxEl.style.display = 'none';
    return;
  }
  if (event.altKey && (event.key === 's' || event.key === 'S') && isActivated) {
    event.preventDefault();
    startPageSnipMode();
  }
});

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const message = rawMessage as Partial<ExtensionMessage> | null;
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'REFPIN_EXTRACT_DOM') {
    const result = runExtraction(Boolean(message.force));
    sendResponse({ ok: true, payload: result.payload });
    return;
  }

  if (message.type === 'REFPIN_SCROLL_TO_ANCHOR' && typeof message.anchorId === 'string') {
    jumpToAnchor(message.anchorId);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'REFPIN_START_PAGE_SNIP') {
    startPageSnipMode();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'REFPIN_SHOW_ZOOM_PREVIEW' && message.item) {
    showDockZoomPreview(
      message.item,
      typeof message.anchorCenterRatio === 'number' ? message.anchorCenterRatio : 0.3,
    );
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'REFPIN_HIDE_ZOOM_PREVIEW') {
    hideDockZoomPreview();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'REFPIN_PAGE_TRANSLATE_START') {
    const mode = message.displayMode === 'bilingual' ? 'bilingual' : 'translated';
    void startPageTranslation(mode);
    sendResponse({ ok: true, status: getPageTranslateStatus() });
    return;
  }

  if (message.type === 'REFPIN_PAGE_TRANSLATE_MODE' && message.displayMode) {
    const status = setPageTranslateMode(message.displayMode);
    sendResponse({ ok: true, status });
    return;
  }

  if (message.type === 'REFPIN_PAGE_TRANSLATE_STOP') {
    const status = stopPageTranslation();
    sendResponse({ ok: true, status });
    return;
  }

  if (message.type === 'REFPIN_PAGE_TRANSLATE_GET_STATUS') {
    sendResponse({ ok: true, status: getPageTranslateStatus() });
  }
});

subscribeLocale(() => {
  if (!shadowRoot) return;
  shadowRoot.host.setAttribute('lang', getLocale());
  const back = returnEl?.querySelector('.return-btn');
  if (back) back.textContent = t('reader.return');
  returnEl?.querySelector('.return-close')?.setAttribute('aria-label', t('common.close'));
  const hint = snipEl?.querySelector('.snip-hint');
  if (hint) hint.textContent = t('snip.hud');
  if (toastEl && toastMessage) toastEl.textContent = toastMessage();
  if (dockPreview) showDockZoomPreview(dockPreview.item, dockPreview.anchorCenterRatio);
  if (peekEl?.style.display === 'block') renderPeekCard();
});
