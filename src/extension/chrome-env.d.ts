/// <reference types="vite/client" />

declare namespace chrome {
  namespace i18n {
    function getUILanguage(): string;
    function getMessage(name: string): string;
  }

  namespace runtime {
    interface Port {
      name: string;
      sender?: MessageSender;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(callback: (message: unknown) => void): void };
      onDisconnect: { addListener(callback: () => void): void };
    }
    function connect(options: { name: string }): Port;
    const onConnect: { addListener(callback: (port: Port) => void): void };
    const id: string;
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function sendMessage<TResponse = unknown>(
      message: unknown,
      callback?: (response: TResponse) => void,
    ): Promise<TResponse>;
    interface MessageSender {
      id?: string;
      tab?: tabs.Tab;
      frameId?: number;
      url?: string;
    }
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
      removeListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    const onInstalled: {
      addListener(callback: (details: { reason: string }) => void): void;
    };
  }

  namespace storage {
    interface StorageArea {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
      ): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const onChanged: {
      addListener(callback: (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ) => void): void;
    };
    const local: StorageArea;
    const session: StorageArea;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
      windowId?: number;
      status?: string;
    }
    function get(tabId: number): Promise<Tab>;
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
      lastFocusedWindow?: boolean;
    }): Promise<Tab[]>;
    function create(createProperties: {
      url: string;
      active?: boolean;
    }): Promise<Tab>;
    function update(
      tabId: number,
      updateProperties: { url?: string; active?: boolean },
    ): Promise<Tab>;
    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
    ): Promise<TResponse>;
    function captureVisibleTab(
      options?: { format?: 'jpeg' | 'png'; quality?: number },
    ): Promise<string>;
    function captureVisibleTab(
      windowId: number,
      options?: { format?: 'jpeg' | 'png'; quality?: number },
    ): Promise<string>;
    const onRemoved: { addListener(callback: (tabId: number) => void): void };
    const onActivated: {
      addListener(
        callback: (activeInfo: { tabId: number; windowId: number }) => void,
      ): void;
      removeListener(
        callback: (activeInfo: { tabId: number; windowId: number }) => void,
      ): void;
    };
    const onUpdated: {
      addListener(
        callback: (
          tabId: number,
          changeInfo: { status?: string; url?: string; title?: string },
          tab: Tab,
        ) => void,
      ): void;
      removeListener(
        callback: (
          tabId: number,
          changeInfo: { status?: string; url?: string; title?: string },
          tab: Tab,
        ) => void,
      ): void;
    };
  }

  namespace sidePanel {
    function setPanelBehavior(options: {
      openPanelOnActionClick?: boolean;
    }): Promise<void>;
    function open(options: { tabId?: number; windowId?: number }): Promise<void>;
  }

  namespace contextMenus {
    type ContextType = 'all' | 'page' | 'link' | 'frame' | 'selection';
    interface CreateProperties {
      id: string;
      title: string;
      contexts: ContextType[];
      documentUrlPatterns?: string[];
    }
    interface OnClickData {
      menuItemId: string | number;
      linkUrl?: string;
      pageUrl?: string;
    }
    function removeAll(callback?: () => void): void;
    function create(
      createProperties: CreateProperties,
      callback?: () => void,
    ): void;
    const onClicked: {
      addListener(callback: (info: OnClickData, tab?: tabs.Tab) => void): void;
    };
  }

  namespace extension {
    function isAllowedFileSchemeAccess(): Promise<boolean>;
  }
}
