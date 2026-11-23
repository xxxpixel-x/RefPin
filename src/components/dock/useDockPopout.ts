import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { message, t, type DisplayMessage } from '../../i18n';
import { useReaderStore } from '../../store/useReaderStore';

interface PopoutSession {
  close?: () => void;
}

interface PictureInPictureHost extends Window {
  documentPictureInPicture?: {
    requestWindow: (size: { width: number; height: number }) => Promise<Window>;
  };
}

export function useDockPopout(paper: PDFDocumentProxy | null, notify: (notice: DisplayMessage) => void) {
  const [popoutWindow, setPopoutWindow] = useState<Window | null>(null);
  const active = useRef<PopoutSession | null>(null);

  useEffect(() => {
    const close = () => {
      active.current?.close?.();
      active.current = null;
    };
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  }, [paper]);

  const openPopout = useCallback(async () => {
    const { dockPosition, setDockPosition } = useReaderStore.getState();
    if (!paper || active.current || dockPosition === 'popout') return;
    const api = (window as PictureInPictureHost).documentPictureInPicture;
    if (!api?.requestWindow) {
      notify(message('dock.popoutUnsupported'));
      return;
    }

    const session: PopoutSession = {};
    active.current = session;
    try {
      const child = await api.requestWindow({ width: 480, height: 640 });
      if (active.current !== session || child.closed) {
        if (active.current === session) active.current = null;
        child.close();
        return;
      }
      const doc = child.document;
      const source = document.documentElement;
      const syncAppearance = () => {
        doc.documentElement.className = source.className;
        doc.documentElement.dataset.theme = source.dataset.theme ?? 'light';
        doc.documentElement.lang = source.lang;
        doc.title = t('dock.title');
      };
      const observer = new MutationObserver(syncAppearance);
      const restore = () => {
        observer.disconnect();
        child.removeEventListener('pagehide', restore);
        active.current = null;
        setPopoutWindow(null);
        setDockPosition(dockPosition);
      };
      session.close = () => {
        restore();
        child.close();
      };
      child.addEventListener('pagehide', restore);
      const base = doc.createElement('base');
      base.href = document.baseURI;
      doc.head.append(base);
      for (const style of document.querySelectorAll('style, link[rel~="stylesheet"]')) {
        doc.head.append(doc.importNode(style, true));
      }
      syncAppearance();
      observer.observe(source, { attributes: true, attributeFilter: ['class', 'data-theme', 'lang'] });
      setPopoutWindow(child);
      setDockPosition('popout');
    } catch {
      if (active.current !== session) return;
      session.close?.();
      active.current = null;
      notify(message('dock.popoutFailed'));
    }
  }, [paper, notify]);

  return { popoutWindow, openPopout };
}
