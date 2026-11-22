const ligatures = ['ff', 'fi', 'fl', 'ffi', 'ffl'];

export function normalizePdfGlyphs(text: string): string {
  return text
    .replace(/[\uFB00-\uFB04]/g, (ch) => ligatures[ch.charCodeAt(0) - 0xfb00])
    .replace(/\u2212/g, '-');
}

export function cleanPdfSelectedText(raw: string): string {
  return normalizePdfGlyphs(raw)
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n(?:[^\S\n]*\n)+/)
    .map((paragraph) => paragraph
      .replace(/([A-Za-z])-[^\S\n]*\n[^\S\n]*(?=[a-z])/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff65]) (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff65])/gu, '$1')
      .trim())
    .join('\n\n');
}
