import { describe, expect, it } from 'vitest';
import { cachePageLines, getCachedPageLines, nearestLineIndex, searchPageLines } from '../pageLinesCache';
import { annotationDoc, textLine } from './fixtures';

describe('document search and ruler geometry', () => {
  it('returns all literal matches in reading order with distinct IDs, case-insensitive Latin and CJK', () => {
    const doc = annotationDoc();
    const line = textLine('A.B a.b 注意力注意力');
    cachePageLines(doc, { 2: [textLine('A.B', { pageNumber: 2 })], 1: [line] });
    const pages = getCachedPageLines(doc);
    const matches = searchPageLines(pages, 'a.b');
    expect(matches.map(hit => hit.pageNumber)).toEqual([1, 1, 2]);
    expect(new Set(matches.map(hit => hit.id)).size).toBe(3);
    expect(matches[1].rect.x).toBeCloseTo(line.chars[4].rect.x);
    expect(matches[1].rect.width).toBeCloseTo(0.024);
    expect(searchPageLines(pages, '注意力')).toHaveLength(2);
    expect(searchPageLines(pages, ' ')).toEqual([]);
    expect(searchPageLines(pages, '.*')).toEqual([]);
  });

  it('retains variable-width glyph positions and locks to the clicked column', () => {
    const line = textLine('iM图', { x: 0.08, width: 0.12 });
    line.chars[0].rect.width = 0.01;
    line.chars[1].rect = { ...line.chars[1].rect, x: 0.09, width: 0.06 };
    line.chars[2].rect = { ...line.chars[2].rect, x: 0.15, width: 0.05 };
    const doc = annotationDoc();
    cachePageLines(doc, { 1: [line, textLine('Second column', { x: 0.55 })] });
    const pages = getCachedPageLines(doc)!;
    const [hit] = searchPageLines(pages, 'M图');
    expect(hit.rect.x).toBeCloseTo(0.09, 4);
    expect(hit.rect.width).toBeCloseTo(0.11, 4);
    expect(nearestLineIndex(pages[1], 0.6, 0.21)).toBe(1);
  });
});
