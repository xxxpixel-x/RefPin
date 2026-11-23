import type { HighlightSelection, NormalizedRect } from '../../types/paper';
import { cleanPdfSelectedText } from '../../utils/textCleanup';

function* pageRanges(range: Range, viewer: HTMLElement) {
  for (const layer of viewer.querySelectorAll<HTMLElement>('[data-page] > .textLayer')) {
    if (!range.intersectsNode(layer) || layer.classList.contains('select-none')) continue;
    const part = range.cloneRange();
    if (!layer.contains(part.startContainer)) part.setStart(layer, 0);
    if (!layer.contains(part.endContainer)) part.setEnd(layer, layer.childNodes.length);
    const content = part.cloneContents();
    content.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    yield { part, layer, page: layer.parentElement!, text: content.textContent ?? '' };
  }
}

export function readSelectionText(range: Range, viewer: HTMLElement) {
  return cleanPdfSelectedText(Array.from(pageRanges(range, viewer), page => page.text).join('\n'));
}

type Bounds = { left: number; right: number; top: number; bottom: number };

export function normalizedLineRects(rects: Bounds[], page: DOMRect): NormalizedRect[] {
  if (!page.width || !page.height) return [];
  const lines: Bounds[] = [];
  for (const rect of rects) {
    const left = Math.max(page.left, rect.left), right = Math.min(page.right, rect.right);
    const top = Math.max(page.top, rect.top), bottom = Math.min(page.bottom, rect.bottom);
    if (left >= right || top >= bottom) continue;
    const last = lines[lines.length - 1];
    if (last) {
      const height = Math.min(last.bottom - last.top, bottom - top);
      const centerDistance = Math.abs(last.top + last.bottom - top - bottom) / 2;
      const gap = Math.max(left - last.right, last.left - right);
      if (centerDistance <= height * 0.35 && gap <= height * 0.35) {
        last.left = Math.min(last.left, left);
        last.right = Math.max(last.right, right);
        last.top = Math.min(last.top, top);
        last.bottom = Math.max(last.bottom, bottom);
        continue;
      }
    }
    lines.push({ left, right, top, bottom });
  }
  return lines.map(({ left, right, top, bottom }) => ({
    x: (left - page.left) / page.width, y: (top - page.top) / page.height,
    width: (right - left) / page.width, height: (bottom - top) / page.height,
  }));
}

export function readHighlightSelection(range: Range, viewer: HTMLElement): HighlightSelection[] {
  const pages: HighlightSelection[] = [];
  for (const { part, layer, page, text } of pageRanges(range, viewer)) {
    const cleaned = cleanPdfSelectedText(text);
    if (!cleaned) continue;
    // 逐个文本节点测量，排除整段选中时浏览器额外返回的元素框和换行框。
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const fragment = document.createRange();
    const boxes: DOMRect[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!part.intersectsNode(node)) continue;
      fragment.selectNodeContents(node);
      if (part.startContainer === node) fragment.setStart(node, part.startOffset);
      if (part.endContainer === node) fragment.setEnd(node, part.endOffset);
      if (!fragment.collapsed) boxes.push(...fragment.getClientRects());
    }
    const rects = normalizedLineRects(boxes, page.getBoundingClientRect());
    if (rects.length) pages.push({ pageNumber: Number(page.dataset.page), rects, text: cleaned });
  }
  return pages;
}
