import type { Highlight } from '../types/paper';

export function compareHighlightPosition(a: Highlight, b: Highlight) {
  return a.pageNumber - b.pageNumber || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0)
    || (a.rects[0]?.x ?? 0) - (b.rects[0]?.x ?? 0) || a.createdAt - b.createdAt;
}
