import { describe, expect, it } from 'vitest';
import { clampRect, isInsideRefRange, isTwoColumnPage } from '../utils';
import { textLine } from './fixtures';

describe('isInsideRefRange', () => {
  it('includes the boundary lines and intervening pages', () => {
    const range = { startPage: 2, startY: 0.6, endPage: 4, endY: 0.2 };
    expect(isInsideRefRange(1, 0.8, range)).toBe(false);
    expect(isInsideRefRange(2, 0.59, range)).toBe(false);
    expect(isInsideRefRange(2, 0.6, range)).toBe(true);
    expect(isInsideRefRange(3, 0.7, range)).toBe(true);
    expect(isInsideRefRange(4, 0.2, range)).toBe(true);
    expect(isInsideRefRange(4, 0.21, range)).toBe(false);
    expect(isInsideRefRange(5, 0.1, range)).toBe(false);
  });
  it('supports a single page and a missing bibliography', () => {
    const range = { startPage: 1, endPage: 1, startY: 0.3, endY: 0.5 };
    expect([0.2, 0.3, 0.4, 0.5, 0.6].map((y) => isInsideRefRange(1, y, range)))
      .toEqual([false, true, true, true, false]);
    expect(isInsideRefRange(1, 0.4)).toBe(false);
  });
});

describe('isTwoColumnPage', () => {
  const column = (x: number, top: number, width = 0.42) =>
    [0, 0.1, 0.2].map((dy) => textLine('Some text', { x, y: top + dy, width }));

  it('requires aligned columns with a narrow gutter and vertical overlap', () => {
    const left = column(0.06, 0.1);
    expect(isTwoColumnPage([...left, ...column(0.52, 0.1)])).toBe(true);
    expect(isTwoColumnPage([...left, ...column(0.52, 0.6)])).toBe(false);
    expect(isTwoColumnPage([...column(0.06, 0.1, 0.22), ...column(0.52, 0.1)])).toBe(false);
    expect(isTwoColumnPage(column(0.08, 0.1, 0.84))).toBe(false);
    expect(isTwoColumnPage([])).toBe(false);
  });
});

describe('clampRect', () => {
  it('bounds coordinates and dimensions and preserves valid rectangles', () => {
    expect(clampRect({ x: -0.2, y: 0.75, width: 2, height: 0.5 }))
      .toEqual({ x: 0, y: 0.75, width: 1, height: 0.25 });
    expect(clampRect({ x: 1.2, y: -1, width: 0.1, height: -0.2 }))
      .toEqual({ x: 1, y: 0, width: 0, height: 0 });
    const valid = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expect(clampRect(valid)).toEqual(valid);
  });
});
