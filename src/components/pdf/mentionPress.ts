export function beginMentionPress(event: PointerEvent, anchor: HTMLElement, open: () => void) {
  const target = event.target as HTMLElement;
  const doc = anchor.ownerDocument;
  const block = (native: Event) => native.preventDefault();
  const timer = window.setTimeout(() => { if (anchor.isConnected) open(); }, 450);

  function move(next: PointerEvent) {
    if (next.pointerId === event.pointerId && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 8) cancel();
  }
  function second(next: PointerEvent) { if (next.pointerType === 'touch') cancel(); }
  function end(next: PointerEvent) { if (next.pointerId === event.pointerId) cancel(); }
  function cancel() {
    window.clearTimeout(timer);
    delete target.dataset.mentionPress;
    target.removeEventListener('contextmenu', block);
    target.removeEventListener('selectstart', block);
    doc.removeEventListener('pointerdown', second, true);
    doc.removeEventListener('pointermove', move, true);
    doc.removeEventListener('pointerup', end, true);
    doc.removeEventListener('pointercancel', end, true);
    doc.removeEventListener('scroll', cancel, true);
    window.removeEventListener('blur', cancel);
  }
  target.dataset.mentionPress = '';
  target.addEventListener('contextmenu', block);
  target.addEventListener('selectstart', block);
  doc.addEventListener('pointerdown', second, true);
  doc.addEventListener('pointermove', move, true);
  doc.addEventListener('pointerup', end, true);
  doc.addEventListener('pointercancel', end, true);
  doc.addEventListener('scroll', cancel, true);
  window.addEventListener('blur', cancel);
  return cancel;
}
