import { describe, expect, it } from 'vitest';
import { cleanPdfSelectedText } from '../textCleanup';

describe('cleanPdfSelectedText', () => {
  it('repairs wrapped English words and preserves inline compounds', () => {
    expect(cleanPdfSelectedText('inter- \r\n  operable real-time data')).toBe('interoperable real-time data');
    expect(cleanPdfSelectedText('a-\nb-\nc')).toBe('abc');
  });

  it('joins hard breaks and collapses spaces within paragraphs', () => {
    expect(cleanPdfSelectedText('  First\tline \n second    line.  ')).toBe('First line second line.');
  });

  it('keeps paragraph boundaries, including after a hyphen', () => {
    expect(cleanPdfSelectedText('first-\r\n  \r\nnext\n\n\nthird')).toBe('first-\n\nnext\n\nthird');
  });

  it('normalizes ligatures and mathematical minus signs', () => {
    expect(cleanPdfSelectedText('ﬀ ﬁ ﬂ ﬃ ﬄ −1')).toBe('ff fi fl ffi ffl -1');
  });

  it('avoids gaps in CJK text, keeping mixed-language words and paragraphs', () => {
    expect(cleanPdfSelectedText('中文， \n 断 行。\n\n模型 PDF\n reader')).toBe('中文，断行。\n\n模型 PDF reader');
  });
});
