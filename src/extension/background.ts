import {
  STORAGE_KEY_PENDING_PIN,
  type ExtensionMessage,
  type PendingPinRecord,
} from './protocol';
import { translateTexts } from './translator';

const MENU_OPEN_PANEL = 'refpin-open-sidepanel';
const MENU_START_SNIP = 'refpin-start-snip';

// 点击工具栏图标直接展开/收起右侧 Chrome 原生 Side Panel
void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_OPEN_PANEL,
      title: '打开 RefPin 浮页伴读侧边栏',
      contexts: ['page', 'selection', 'link'],
    });
    chrome.contextMenus.create({
      id: MENU_START_SNIP,
      title: 'RefPin 自由框选截图并钉到右侧',
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

  if (info.menuItemId === MENU_OPEN_PANEL) {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }

  if (info.menuItemId === MENU_START_SNIP && tab.id !== undefined) {
    void chrome.tabs
      .sendMessage(tab.id, { type: 'REFPIN_START_PAGE_SNIP' })
      .catch(() => {
        // 原生 PDF 页无 Content Script，直接打开侧边栏使用侧栏框选
        void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      });
  }
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = rawMessage as Partial<ExtensionMessage> | null;
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'REFPIN_OPEN_SIDEPANEL') {
    const windowId = sender.tab?.windowId;
    if (windowId !== undefined) {
      void chrome.sidePanel.open({ windowId }).catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'REFPIN_CAPTURE_VISIBLE_TAB') {
    void (async () => {
      let windowId: number | undefined =
        typeof message.windowId === 'number'
          ? message.windowId
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
    message.type === 'REFPIN_PIN_FROM_PAGE' &&
    message.item &&
    typeof message.tabUrl === 'string'
  ) {
    // 必须在任何 await 之前同步调用 sidePanel.open 以保留用户手势上下文
    if (message.openSidePanel && sender.tab?.windowId !== undefined) {
      void chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }

    const record: PendingPinRecord = {
      tabUrl: message.tabUrl,
      item: message.item,
      timestamp: Date.now(),
    };

    // 立即推送给已打开的侧边栏（不依赖 storage.session 写入成功，避免大图触发配额失败）
    void chrome.runtime
      .sendMessage({
        type: 'REFPIN_SIDEPANEL_PUSH_PIN',
        tabUrl: message.tabUrl,
        item: message.item,
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

  if (message.type === 'REFPIN_TRANSLATE_BATCH' && Array.isArray(message.texts)) {
    void translateTexts(message.texts, message.config)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
});
