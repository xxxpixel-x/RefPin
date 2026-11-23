import { flushSync } from 'react-dom';
import { clampReaderScale } from '../../store/useReaderStore';

function geometry(first: Touch, second: Touch) {
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
  };
}

export function attachPinchZoom(viewer: HTMLElement, getScale: () => number, setScale: (scale: number) => void) {
  const list = viewer.querySelector<HTMLElement>('[data-page-list]');
  if (!list) return;
  let pinch: {
    start: ReturnType<typeof geometry>; center: ReturnType<typeof geometry>;
    initialScale: number; scale: number; sheet: HTMLElement; x: number; y: number;
  } | undefined;

  function finish(commit: boolean) {
    if (!pinch || !list) return;
    const { sheet, center, scale, x, y } = pinch;
    pinch = undefined;
    list.style.transform = '';
    list.style.transformOrigin = '';
    if (!commit || !sheet.isConnected) return;
    flushSync(() => setScale(scale));
    const bounds = sheet.getBoundingClientRect();
    viewer.scrollLeft += bounds.left + bounds.width * x - center.x;
    viewer.scrollTop += bounds.top + bounds.height * y - center.y;
  }
  function start(event: TouchEvent) {
    finish(false);
    if (!list || event.touches.length !== 2) return;
    const [first, second] = Array.from(event.touches);
    if (![first, second].every(touch => viewer.contains(touch.target as Node))) return;
    const center = geometry(first, second);
    if (!center.distance) return;
    const hit = viewer.ownerDocument.elementFromPoint(center.x, center.y)?.closest<HTMLElement>('[data-pdf-sheet]');
    let sheet = hit && list.contains(hit) ? hit : null;
    if (!sheet) {
      let nearest = Infinity;
      for (const candidate of list.querySelectorAll<HTMLElement>('[data-pdf-sheet]')) {
        const rect = candidate.getBoundingClientRect();
        const distance = Math.hypot(Math.max(rect.left - center.x, 0, center.x - rect.right), Math.max(rect.top - center.y, 0, center.y - rect.bottom));
        if (distance < nearest) { nearest = distance; sheet = candidate; }
      }
    }
    if (!sheet) return;
    const bounds = sheet.getBoundingClientRect();
    const origin = list.getBoundingClientRect();
    const scale = getScale();
    pinch = { start: center, center, initialScale: scale, scale, sheet,
      x: (center.x - bounds.left) / bounds.width, y: (center.y - bounds.top) / bounds.height };
    list.style.transformOrigin = `${center.x - origin.left}px ${center.y - origin.top}px`;
    if (event.cancelable) event.preventDefault();
  }
  function move(event: TouchEvent) {
    if (!pinch || !list) return;
    if (event.touches.length !== 2) return finish(false);
    if (event.cancelable) event.preventDefault();
    const center = geometry(event.touches[0], event.touches[1]);
    pinch.center = center;
    pinch.scale = clampReaderScale(pinch.initialScale * center.distance / pinch.start.distance);
    list.style.transform = `translate(${center.x - pinch.start.x}px, ${center.y - pinch.start.y}px) scale(${pinch.scale / pinch.initialScale})`;
  }
  function end(event: TouchEvent) {
    if (!pinch) return;
    if (event.cancelable) event.preventDefault();
    finish(event.type === 'touchend');
  }
  viewer.addEventListener('touchstart', start, { passive: false });
  viewer.addEventListener('touchmove', move, { passive: false });
  viewer.addEventListener('touchend', end, { passive: false });
  viewer.addEventListener('touchcancel', end);
  return () => {
    finish(false);
    viewer.removeEventListener('touchstart', start);
    viewer.removeEventListener('touchmove', move);
    viewer.removeEventListener('touchend', end);
    viewer.removeEventListener('touchcancel', end);
  };
}
