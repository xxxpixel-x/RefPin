// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizedLineRects, readHighlightSelection, readSelectionText } from '../pdfSelection';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('PDF 高亮选区', () => {
  it('合并同一行相邻片段，保留分栏、换行并裁去页外部分', () => {
    const rects = [[5, 20, 25, 10], [32, 21, 13, 10], [80, 20, 10, 10], [10, 34, 40, 10], [4, 3, 0, 4]];
    function measure(scale: number) {
      const page = new DOMRect(10 * scale, 10 * scale, 100 * scale, 200 * scale);
      return normalizedLineRects(rects.map(([x, y, w, h]) => new DOMRect(x * scale, y * scale, w * scale, h * scale)), page);
    }
    expect(measure(1)).toEqual([
      { x: 0, y: 0.05, width: 0.35, height: 0.055 },
      { x: 0.7, y: 0.05, width: 0.1, height: 0.05 },
      { x: 0, y: 0.12, width: 0.4, height: 0.05 },
    ]);
    expect(measure(1.75)).toEqual(measure(1));
  });

  it('跨页只截取文本层内的部分字符，剔除页码和换行框', () => {
    const viewer = document.createElement('main');
    viewer.innerHTML = '<div data-page="2"><div class="textLayer"><span>prefix FIRST</span><br></div>2</div>' +
      '<div data-page="3"><div class="textLayer"><span>SECOND suffix</span></div>3</div>';
    document.body.append(viewer);
    const pages = Array.from(viewer.children);
    pages.forEach((page, i) => vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, i * 300, 200, 200)));
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function(this: Range) {
      const page = this.startContainer.parentElement!.closest('[data-page]')!;
      return [new DOMRect(20 + this.startOffset * 5, page.getBoundingClientRect().top + 20,
        (this.endOffset - this.startOffset) * 5, 10)];
    } });
    try {
      const range = document.createRange();
      range.setStart(pages[0].querySelector('span')!.firstChild!, 7);
      range.setEnd(pages[1].querySelector('span')!.firstChild!, 6);
      expect(readSelectionText(range, viewer)).toMatch(/^FIRST\s+SECOND$/);
      expect(readHighlightSelection(range, viewer)).toEqual([
        { pageNumber: 2, text: 'FIRST', rects: [{ x: 0.175, y: 0.1, width: 0.125, height: 0.05 }] },
        { pageNumber: 3, text: 'SECOND', rects: [{ x: 0, y: 0.1, width: 0.15, height: 0.05 }] },
      ]);
    } finally { Reflect.deleteProperty(Range.prototype, 'getClientRects'); }
  });
});
