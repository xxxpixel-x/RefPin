import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextLine } from '../types';

export function textLine(
  text: string,
  { pageNumber = 1, x = 0.08, y = 0.2, width = text.length * 0.008 } = {},
): TextLine {
  const height = 0.012;
  const charWidth = width / text.length;
  return {
    text,
    pageNumber,
    rect: { x, y, width, height },
    baseline: y,
    column: x >= 0.5 ? 'right' : 'left',
    chars: text.split('').map((ch, i) => ({
      ch,
      rect: { x: x + i * charWidth, y, width: charWidth, height },
    })),
  };
}

export function annotationDoc(annotations: object[] = []): PDFDocumentProxy {
  return {
    numPages: 1,
    getPage: async () => ({
      getViewport: () => ({
        width: 1, height: 1, convertToViewportRectangle: (rect: number[]) => rect,
      }),
      getAnnotations: async () => annotations,
    }),
  } as unknown as PDFDocumentProxy;
}
