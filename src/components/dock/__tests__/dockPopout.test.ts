// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReaderStore } from '../../../store/useReaderStore';
import { useDockPopout } from '../useDockPopout';

const store = useReaderStore.getState;
const notify = vi.fn();
const paper = {} as PDFDocumentProxy;
let dock: ReturnType<typeof useDockPopout>;
let root: Root;

function Reader() {
  dock = useDockPopout(paper, notify);
  return null;
}

function createChild() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const child = frame.contentWindow!;
  vi.spyOn(child, 'close').mockImplementation(() => {});
  return child;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  notify.mockClear();
  store().setDockPosition('bottom');
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Reader)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  store().resetPaper();
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('复制样式并跟随主题，弹窗关闭后恢复原停靠位置和编辑后的卡片', async () => {
  const child = createChild();
  vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn().mockResolvedValue(child) });
  const style = document.createElement('style');
  style.textContent = 'body { margin: 0 }';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './reader.css';
  document.head.append(style, link);
  store().pinSnip({ title: '图 1', pageNumber: 1, cropRect: { x: 0, y: 0, width: 1, height: 1 }, imageUrl: '' });

  await act(dock.openPopout);
  expect(dock.popoutWindow).toBe(child);
  expect(store().dockPosition).toBe('popout');
  expect(JSON.parse(localStorage.getItem('refpin.dock.layout.v1')!).dockPosition).toBe('bottom');
  expect(child.document.querySelector('style')?.textContent).toBe(style.textContent);
  expect(child.document.querySelector('link')?.href).toBe(link.href);
  expect(child.document.documentElement.dataset.theme).toBe(store().theme);
  document.documentElement.className = 'reader';
  store().setTheme('dark');
  await Promise.resolve();
  expect(child.document.documentElement.className).toBe('reader');
  expect(child.document.documentElement.dataset.theme).toBe('dark');

  store().renamePinnedItem(store().pinnedItems[0].id, '实验结果');
  await act(async () => { child.dispatchEvent(new Event('pagehide')); });
  expect(dock.popoutWindow).toBeNull();
  expect(store().dockPosition).toBe('bottom');
  expect(store().pinnedItems[0].title).toBe('实验结果');
});

it('不支持或被拒绝时保留钉板，重试成功后随主窗口关闭', async () => {
  vi.stubGlobal('documentPictureInPicture', undefined);
  await act(dock.openPopout);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ key: 'dock.popoutUnsupported' }));
  const child = createChild();
  const requestWindow = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(child);
  vi.stubGlobal('documentPictureInPicture', { requestWindow });
  await act(dock.openPopout);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ key: 'dock.popoutFailed' }));
  expect(store().dockPosition).toBe('bottom');
  await act(dock.openPopout);
  expect(store().dockPosition).toBe('popout');
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  expect(child.close).toHaveBeenCalledOnce();
  expect(store().dockPosition).toBe('bottom');
});

it('忽略重复点击，并关闭离开主页面后才返回的弹窗', async () => {
  const child = createChild();
  let resolve!: (child: Window) => void;
  const requestWindow = vi.fn(() => new Promise<Window>(done => { resolve = done; }));
  vi.stubGlobal('documentPictureInPicture', { requestWindow });
  const opening = dock.openPopout();
  await dock.openPopout();
  expect(requestWindow).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('pagehide'));
  resolve(child);
  await opening;
  expect(child.close).toHaveBeenCalledOnce();
  expect(dock.popoutWindow).toBeNull();
  expect(store().dockPosition).toBe('bottom');
});
