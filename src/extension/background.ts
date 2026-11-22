import { describeError, message } from '../i18n/core';
import {
  STORAGE_KEY_PENDING_PIN,
  type ExtensionMessage,
  type PendingPinRecord,
} from './protocol';
import { translateTexts } from './translator';

import { dismissedKey, grantKey, handleBridge } from './pdfBridge';
import { inspectTabUrl } from './urlRules';

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
      id: MENU_ALLOW_READER,
      title: chrome.i18n.getMessage('menuAllowReader'),
      contexts: ['page'],
      documentUrlPatterns: ['https://*/*'],
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
  if (tab?.windowId === undefined) return;

  if (info.menuItemId === MENU_ALLOW_READER && tab.id !== undefined && tab.url?.startsWith('https://')) {
    void chrome.storage.session.set({ [grantKey(tab.id)]: new URL(tab.url).origin });
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
    if (paper.pdfUrl && paper.kind.startsWith('academic-')) {
      const target = new URL(chrome.runtime.getURL('pdf-translate.html'));
      target.searchParams.set('url', paper.pdfUrl);
      target.searchParams.set('mode', 'bilingual');
      void chrome.tabs.create({ url: target.href });
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

  if (request.type === 'REFPIN_TRANSLATE_BATCH' && Array.isArray(request.texts)) {
    void translateTexts(request.texts, request.config)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: describeError(error, message('translate.requestFailed')),
        }),
      );
    return true;
  }
});
