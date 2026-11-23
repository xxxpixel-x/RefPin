// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { useReaderStore, visibleDockCollapsed } from '../useReaderStore';

const store = useReaderStore.getState;
afterEach(() => { useReaderStore.setState(useReaderStore.getInitialState()); localStorage.clear(); });

it('抽屉默认收起，展开、收起与钉选不覆盖桌面停靠位置或折叠偏好', () => {
  store().setDockPosition('left');
  store().setDockCollapsed(true);
  const saved = localStorage.getItem('refpin.dock.layout.v1');
  useReaderStore.setState({ narrowDock: true });
  expect(visibleDockCollapsed(store())).toBe(true);
  store().toggleDockCollapsed();
  expect(visibleDockCollapsed(store())).toBe(false);
  store().toggleDockCollapsed();
  store().pinReference({ index: 1, key: 'ref-1', pageNumber: 2, rawText: 'Reference' });
  expect(visibleDockCollapsed(store())).toBe(false);
  expect(localStorage.getItem('refpin.dock.layout.v1')).toBe(saved);
  useReaderStore.setState({ narrowDock: false });
  expect(store().dockPosition).toBe('left');
  expect(visibleDockCollapsed(store())).toBe(true);
});

it('紧凑视口的独立窗口不走抽屉逻辑', () => {
  useReaderStore.setState({ narrowDock: true, dockPosition: 'popout', drawerCollapsed: true });
  expect(visibleDockCollapsed(store())).toBe(false);
});
