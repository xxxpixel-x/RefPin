// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginMentionPress } from '../mentionPress';
import { attachPinchZoom } from '../pinchZoom';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function pointer(target: HTMLElement, type: string, x = 50, id = 1) {
  const event = Object.assign(new MouseEvent(type, { clientX: x, clientY: 100, bubbles: true, cancelable: true }),
    { pointerType: 'touch', pointerId: id });
  target.dispatchEvent(event);
  return event as PointerEvent;
}

function press() {
  vi.useFakeTimers();
  const glyph = document.createElement('span');
  const anchor = document.createElement('button');
  document.body.append(glyph, anchor);
  const open = vi.fn();
  cleanups.push(beginMentionPress(pointer(glyph, 'pointerdown'), anchor, open));
  return { glyph, open };
}

describe('引用长按', () => {
  it('容忍轻微抖动，450ms 时只打开一次，仅在按住期间抑制原生菜单', () => {
    const { glyph, open } = press();
    pointer(glyph, 'pointermove', 54);
    expect(pointer(glyph, 'contextmenu').defaultPrevented).toBe(true);
    expect(pointer(document.body, 'selectstart').defaultPrevented).toBe(false);
    vi.advanceTimersByTime(449);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    pointer(glyph, 'pointerup');
    vi.runAllTimers();
    expect(open).toHaveBeenCalledTimes(1);
    expect(pointer(glyph, 'contextmenu').defaultPrevented).toBe(false);
    expect(glyph.dataset.mentionPress).toBeUndefined();
  });

  it.each(['pointerup', 'pointermove', 'pointercancel', 'scroll', 'pointerdown'])('%s 取消等待，包括另一页上的第二指', type => {
    const { open } = press();
    pointer(document.body, type, 70, type === 'pointerdown' ? 2 : 1);
    vi.runAllTimers();
    expect(open).not.toHaveBeenCalled();
  });
});

function setupZoom() {
  const viewer = document.createElement('div');
  viewer.innerHTML = '<div data-page-list><div data-pdf-sheet></div></div>';
  document.body.append(viewer);
  const list = viewer.firstElementChild as HTMLElement;
  const sheet = list.firstElementChild as HTMLElement;
  const bounds = vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, -150, 400, 600));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => sheet });
  cleanups.push(() => Reflect.deleteProperty(document, 'elementFromPoint'));
  const commit = vi.fn(() => { bounds.mockReturnValue(new DOMRect(24, -700, 800, 1200)); });
  cleanups.push(attachPinchZoom(viewer, () => 1, commit)!);
  function send(type: string, points: number[][], otherTarget: HTMLElement = sheet) {
    const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      touches: points.map(([clientX, clientY], index) => ({ clientX, clientY, target: index === 0 ? sheet : otherTarget })),
    });
    sheet.dispatchEvent(event);
    return event;
  }
  return { send, commit, viewer, list };
}

describe('PDF 双指缩放', () => {
  it('不接管单指和跨浮层手势；以移动后的中点对齐真实页面，仅在结束时提交', () => {
    const { send, commit, viewer, list } = setupZoom();
    expect(send('touchstart', [[70, 150]]).defaultPrevented).toBe(false);
    expect(send('touchstart', [[70, 150], [170, 150]], document.body).defaultPrevented).toBe(false);
    expect(send('touchstart', [[70, 150], [170, 150]]).defaultPrevented).toBe(true);
    expect(send('touchmove', [[40, 170], [240, 170]]).defaultPrevented).toBe(true);
    expect(list.style.transform).toContain('scale(2)');
    expect(commit).not.toHaveBeenCalled();
    send('touchend', [[40, 170]]);
    send('touchend', []);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(2);
    expect(list.style.transform).toBe('');
    expect(viewer.scrollLeft).toBe(84);
    expect(viewer.scrollTop).toBe(-270);
  });

  it('限制缩放范围，系统取消时清掉临时变换且不写入比例', () => {
    const { send, commit, list } = setupZoom();
    send('touchstart', [[50, 150], [150, 150]]);
    send('touchmove', [[0, 150], [500, 150]]);
    expect(list.style.transform).toContain('scale(2.5)');
    send('touchmove', [[50, 150], [53, 150]]);
    expect(list.style.transform).toContain('scale(0.6)');
    send('touchcancel', []);
    expect(list.style.transform).toBe('');
    expect(commit).not.toHaveBeenCalled();
  });
});
