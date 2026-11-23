import { describe, expect, it } from 'vitest';
import type { PaperAsset } from '../../../types/paper';
import {
  MAX_PREVIEW_WINDOWS,
  PREVIEW_MIN_HEIGHT,
  PREVIEW_MIN_WIDTH,
  closePreview,
  fitPreviewFrame,
  focusPreview,
  lastIndexWhere,
  openPreview,
  type PreviewWindow,
} from '../previewWindows';

const host = { innerWidth: 1280, innerHeight: 800 };
const TITLE_AND_CHROME = 40 + 26;

/** 浮窗里图片区域的长宽比。 */
const contentRatio = (frame: { width: number; height: number }) =>
  (frame.width - 26) / (frame.height - TITLE_AND_CHROME);

describe('fitPreviewFrame', () => {
  it('按截图长宽比开窗：宽表格扁、竖图窄，都不超出视口 60%×75%', () => {
    const wide = fitPreviewFrame({ width: 1600, height: 400 }, host);
    const tall = fitPreviewFrame({ width: 500, height: 1000 }, host);
    expect(contentRatio(wide)).toBeCloseTo(4, 1);
    expect(contentRatio(tall)).toBeCloseTo(0.5, 1);
    for (const frame of [wide, tall]) {
      expect(frame.width).toBeLessThanOrEqual(host.innerWidth * 0.6);
      expect(frame.height).toBeLessThanOrEqual(host.innerHeight * 0.75);
    }
    expect(wide.width).toBeGreaterThan(tall.width);
    expect(wide.height).toBeLessThan(tall.height);
  });

  it('小截图最多放大两倍，极扁的公式保留最小尺寸', () => {
    const small = fitPreviewFrame({ width: 100, height: 100 }, host);
    expect(small.width - 26).toBeLessThanOrEqual(PREVIEW_MIN_WIDTH);
    expect(small.height - TITLE_AND_CHROME).toBe(200);
    const equation = fitPreviewFrame({ width: 2000, height: 60 }, host);
    expect(equation.height).toBe(PREVIEW_MIN_HEIGHT);
  });

  it('读不到尺寸时退回原来的默认大小，并依次错开但不跑出屏幕', () => {
    const fallback = fitPreviewFrame(null, host);
    expect(fallback).toMatchObject({ width: 768, height: 560 });
    const first = fitPreviewFrame({ width: 800, height: 600 }, host, 0);
    const second = fitPreviewFrame({ width: 800, height: 600 }, host, 1);
    expect(second.left - first.left).toBe(28);
    expect(second.top - first.top).toBe(28);
    const far = fitPreviewFrame({ width: 800, height: 600 }, { innerWidth: 400, innerHeight: 300 }, 7);
    expect(far.left + 80).toBeLessThanOrEqual(400);
    expect(far.top).toBeLessThanOrEqual(300 - 48);
  });
});

describe('preview window stack', () => {
  const frame = { left: 0, top: 0, width: 300, height: 200 };
  const win = (id: string): PreviewWindow => ({
    id, fromDock: true, frame, asset: { key: id } as PaperAsset,
  });

  it('同时打开多个，重复打开同一张只提到最前面', () => {
    let list = [win('a'), win('b')];
    list = openPreview(list, win('c'));
    expect(list.map(item => item.id)).toEqual(['a', 'b', 'c']);
    list = openPreview(list, win('a'));
    expect(list.map(item => item.id)).toEqual(['b', 'c', 'a']);
    expect(focusPreview(list, 'a')).toBe(list);
    expect(closePreview(list, 'c').map(item => item.id)).toEqual(['b', 'a']);
  });

  it(`最多同时保留 ${MAX_PREVIEW_WINDOWS} 个，超出时关闭最早打开的`, () => {
    let list: PreviewWindow[] = [];
    for (let i = 0; i <= MAX_PREVIEW_WINDOWS; i += 1) list = openPreview(list, win(String(i)));
    expect(list).toHaveLength(MAX_PREVIEW_WINDOWS);
    expect(list[0].id).toBe('1');
    expect(lastIndexWhere(list, item => Number(item.id) < 3)).toBe(1);
    expect(lastIndexWhere(list, () => false)).toBe(-1);
  });
});
