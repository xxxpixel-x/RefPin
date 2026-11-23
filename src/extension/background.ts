import { openFullReader } from './fullReader';
import { message } from '../i18n/core';
import {
  STORAGE_KEY_PENDING_PIN,
  type ExtensionMessage,
  type PendingPinRecord,
} from './protocol';
import { loadTranslateConfig, testConnection, translateTexts } from './translator';
import {
  DEFAULT_TRANSLATE_CONFIG, MAX_BRIDGE_TEXT_LENGTH, MAX_BRIDGE_TEXTS, summarizeTranslateConfig, translationFailure,
  usesFreeTranslateChannel,
} from '../services/translator';

import { canGrantReader, canSpendSavedApiKey, dismissedKey, grantKey, handleBridge, trustedReader } from './pdfBridge';
import { inspectTabUrl } from './urlRules';
import { explanationService, MAX_CONTEXT_LENGTH, streamChatExplanation } from '../services/explainer';

const MENU_FULL_READER = 'refpin-open-full-reader';
const MENU_ALLOW_READER = 'refpin-allow-reader';
const MENU_OPEN_PANEL = 'refpin-open-sidepanel';
const MENU_START_SNIP = 'refpin-start-snip';

// 点击工具栏图标直接展开/收起右侧 Chrome 原生 Side Panel
void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_FULL_READER,
      title: chrome.i18n.getMessage('menuOpenFullReader'),
      contexts: ['page', 'link'],
    });
    chrome.contextMenus.create({
      id: MENU_ALLOW_READER,
      title: chrome.i18n.getMessage('menuAllowReader'),
      contexts: ['page'],
      documentUrlPatterns: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_PANEL,
      title: chrome.i18n.getMessage('menuOpenPanel') || 'Open RefPin Companion Side Panel',
      contexts: ['page', 'selection', 'link'],
    });
    chrome.contextMenus.create({
      id: MENU_START_SNIP,
      title: chrome.i18n.getMessage('menuStartSnip') || 'RefPin: Free-Snip Region to Dock',
      contexts: ['page', 'selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
  setupContextMenus();
});

setupContextMenus();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_FULL_READER) {
    const target = inspectTabUrl(info.linkUrl || '').pdfUrl ?? inspectTabUrl(tab?.url || '').pdfUrl;
    void openFullReader(target);
    return;
  }
  if (tab?.windowId === undefined) return;

  if (info.menuItemId === MENU_ALLOW_READER && tab.id !== undefined && canGrantReader(tab.url)) {
    void chrome.storage.session.set({ [grantKey(tab.id)]: new URL(tab.url!).origin });
    return;
  }
  if (info.menuItemId === MENU_OPEN_PANEL) {
    void chrome.sidePanel.open?.({ windowId: tab.windowId }).catch(() => {});
    return;
  }

  if (info.menuItemId === MENU_START_SNIP && tab.id !== undefined) {
    void chrome.tabs
      .sendMessage(tab.id, { type: 'REFPIN_START_PAGE_SNIP' })
      .catch(() => {
        // 原生 PDF 页无 Content Script，直接打开侧边栏使用侧栏框选
        void chrome.sidePanel.open?.({ windowId: tab.windowId }).catch(() => {});
      });
  }
});

chrome.tabs.onRemoved.addListener(id => {
  void chrome.storage.session.remove([dismissedKey(id), grantKey(id)]).catch(() => {});
});

chrome.runtime.onConnect?.addListener(port => {
  if (port.name !== 'REFPIN_WEB_EXPLAIN') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  let started = false;
  port.onMessage.addListener(raw => {
    if (started) return;
    started = true;
    const request = raw as Partial<Extract<ExtensionMessage, { type: 'REFPIN_WEB_EXPLAIN' }>> | null;
    void (async () => {
      if (!port.sender || !await trustedReader(port.sender) || request?.type !== 'REFPIN_WEB_EXPLAIN' ||
          typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_CONTEXT_LENGTH) {
        port.postMessage({ error: message('translate.requestFailed') }); return;
      }
      const config = await loadTranslateConfig();
      const service = explanationService(config);
      if (!service || (config.apiKey && !await canSpendSavedApiKey(port.sender)) || config.targetLang !== request.targetLang) {
        port.postMessage({ error: message('explain.configure') }); return;
      }
      if (service === 'remote' && request.allowRemote !== true) {
        port.postMessage({ error: message('explain.consentTitle') }); return;
      }
      controller.signal.throwIfAborted();
      await streamChatExplanation(config, request.text, controller.signal, delta => port.postMessage({ delta }));
      port.postMessage({ done: true });
    })().catch(error => {
      if (!controller.signal.aborted) port.postMessage({ error: translationFailure(error) });
    });
  });
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) return;
  const request = rawMessage as Partial<ExtensionMessage> | null;
  if (!request || typeof request.type !== 'string') return;

  const tabId = sender.tab?.id;
  if (request.type === 'REFPIN_READER_PING' || request.type === 'REFPIN_FETCH_REMOTE_PDF') {
    const url = request.type === 'REFPIN_FETCH_REMOTE_PDF' ? request.url : undefined;
    if (request.type === 'REFPIN_FETCH_REMOTE_PDF' && typeof url !== 'string') return;
    void handleBridge(sender, url).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (tabId !== undefined && (request.type === 'REFPIN_BADGE_STATE' || request.type === 'REFPIN_DISMISS_BADGE')) {
    const key = dismissedKey(tabId);
    const result = request.type === 'REFPIN_BADGE_STATE' ? chrome.storage.session.get(key).then(row => !!row[key]) :
      chrome.storage.session.set({ [key]: true }).then(() => true);
    void result.then(dismissed => sendResponse({ dismissed })).catch(() => sendResponse({ dismissed: false }));
    return true;
  }
  if (request.type === 'REFPIN_BADGE_PDF' && sender.tab?.url) {
    const paper = inspectTabUrl(sender.tab.url);
    const target = paper.pdfUrl || request.pdfUrl;
    if (paper.kind.startsWith('academic-') && typeof target === 'string' && /^https?:\/\//i.test(target)) {
      void openFullReader(target);
    }
    return;
  }
  if (request.type === 'REFPIN_OPEN_SIDEPANEL') {
    const windowId = sender.tab?.windowId;
    if (windowId !== undefined) {
      void chrome.sidePanel.open?.({ windowId }).catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }

  if (request.type === 'REFPIN_CAPTURE_VISIBLE_TAB') {
    void (async () => {
      let windowId: number | undefined =
        typeof request.windowId === 'number'
          ? request.windowId
          : sender.tab?.windowId;

      if (windowId === undefined) {
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        windowId = tabs[0]?.windowId;
      }

      const dataUrl =
        typeof windowId === 'number'
          ? await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
          : await chrome.tabs.captureVisibleTab({ format: 'png' });

      sendResponse({ ok: true, dataUrl });
    })().catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  }

  if (
    request.type === 'REFPIN_PIN_FROM_PAGE' &&
    request.item &&
    typeof request.tabUrl === 'string'
  ) {
    // 必须在任何 await 之前同步调用 sidePanel.open 以保留用户手势上下文
    if (request.openSidePanel && sender.tab?.windowId !== undefined) {
      void chrome.sidePanel.open?.({ windowId: sender.tab.windowId }).catch(() => {});
    }

    const record: PendingPinRecord = {
      tabUrl: request.tabUrl,
      item: request.item,
      timestamp: Date.now(),
    };

    // 立即推送给已打开的侧边栏（不依赖 storage.session 写入成功，避免大图触发配额失败）
    void chrome.runtime
      .sendMessage({
        type: 'REFPIN_SIDEPANEL_PUSH_PIN',
        tabUrl: request.tabUrl,
        item: request.item,
      })
      .catch(() => {});

    // 同时写入 session storage，兼容侧边栏刚被唤醒尚未挂载的场景
    void chrome.storage.session
      .set({ [STORAGE_KEY_PENDING_PIN]: record })
      .catch(() => {})
      .finally(() => {
        sendResponse({ ok: true });
      });
    return true;
  }

  if (request.type === 'REFPIN_WEB_TRANSLATE' || request.type === 'REFPIN_WEB_TRANSLATE_CONFIG') {
    void (async () => {
      if (!(await trustedReader(sender))) {
        sendResponse({ ok: false });
        return;
      }
      const saved = await loadTranslateConfig();
      // 带密钥的配置会花用户的额度：未经右键授权的本机页面只能用公共通道。
      const config = !saved.apiKey || await canSpendSavedApiKey(sender)
        ? saved
        : { ...DEFAULT_TRANSLATE_CONFIG, targetLang: saved.targetLang };
      if (request.type !== 'REFPIN_WEB_TRANSLATE') {
        sendResponse({ ok: true, summary: summarizeTranslateConfig(config), usesFreeChannel: usesFreeTranslateChannel(config),
          explanationService: explanationService(config) });
        return;
      }
      if (request.connectionTest === true) {
        await testConnection(config);
        sendResponse({ ok: true });
        return;
      }
      const texts = request.texts;
      if (!Array.isArray(texts) || !texts.length || texts.length > MAX_BRIDGE_TEXTS ||
          !texts.every(item => typeof item === 'string' && item.length <= MAX_BRIDGE_TEXT_LENGTH)) {
        sendResponse({ ok: false });
        return;
      }
      if (usesFreeTranslateChannel(config) && request.allowFreeChannel !== true) {
        sendResponse({ ok: false, error: message('translate.freeConsentRequired') });
        return;
      }
      const translations = await translateTexts(texts, config);
      if (config.apiKey && translations.some(value => value.includes(config.apiKey))) {
        sendResponse({ ok: false, error: message('translate.invalidResponse') });
        return;
      }
      sendResponse({ ok: true, translations });
    })().catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: translationFailure(error),
      }),
    );
    return true;
  }

  if (request.type === 'REFPIN_TRANSLATE_BATCH' && Array.isArray(request.texts)) {
    const result = request.connectionTest
      ? loadTranslateConfig().then(config => testConnection({ ...config, ...request.config }))
      : translateTexts(request.texts, request.config);
    void result.then((translations) => sendResponse({ ok: true, translations }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: translationFailure(error),
        }),
      );
    return true;
  }
});
