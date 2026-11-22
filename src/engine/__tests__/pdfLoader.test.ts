import { describe, expect, it, vi } from 'vitest';
import { getDocument, type PDFPageProxy } from 'pdfjs-dist';
import { computePdfFingerprint, extractPageLines, loadPdfDocument, loadReaderPdf } from '../pdfLoader';
import { detectCitations } from '../citationDetector';
import { annotationDoc } from './fixtures';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(), GlobalWorkerOptions: {},
  Util: { transform: (_identity: number[], item: number[]) => item },
}));

it('retains font size and true baseline across separately positioned PDF citation glyphs', async () => {
  const page = {
    getViewport: () => ({ width: 1000, height: 1000, scale: 1, transform: [1, 0, 0, 1, 0, 0] }),
    getTextContent: async () => ({ items: [
      { str: 'Evidence', width: 65, transform: [12, 0, 0, 12, 80, 200] },
      { str: '14', width: 9, transform: [8, 0, 0, 8, 147, 195] },
    ] }),
  } as unknown as PDFPageProxy;
  const lines = await extractPageLines(page, 1);
  expect(lines.map(line => line.text)).toEqual(['Evidence14']);
  expect(lines[0].chars[8]).toMatchObject({ ch: '1', fontHeight: 0.008, baselineY: 0.195 });
  const result = await detectCitations(annotationDoc(), { 1: lines }, {
    referencesMap: { 'ref-14': { key: 'ref-14', index: 14, pageNumber: 3, rawText: 'Work.' } },
  });
  expect(result[1].map(c => [c.rawText, c.targetKeys])).toEqual([['14', ['ref-14']]]);
});

describe('PDF fingerprint', () => {
  it('hashes the entire visible byte range through 2 MiB, independent of the filename', async () => {
    const storage = new Uint8Array(2 * 1024 * 1024 + 2);
    const view = storage.subarray(1, -1);
    view[400] = 123;
    const expected = '1b6fab299452f572dbdd8fcc652218045b4719522c0f86e128bd782250a8e671';
    expect(await computePdfFingerprint(view, 'first.pdf')).toBe(expected);
    expect(await computePdfFingerprint(view.slice().buffer, 'renamed.pdf')).toBe(expected);
  });

  it('hashes the length and three 512 KiB samples of larger inputs', async () => {
    const chunk = 512 * 1024;
    const bytes = new Uint8Array(5 * chunk + 17);
    const middle = Math.floor((bytes.length - chunk) / 2);
    bytes[chunk - 1] = 11;
    bytes[middle] = 22;
    bytes[bytes.length - 1] = 33;
    // SHA-256 of the big-endian uint64 length followed by the three sample windows.
    const expected = '86528238c1c76b1e487bd86bce225f0cad2bef31386995d887d85d318c0b683d';
    expect(await computePdfFingerprint(bytes)).toBe(expected);
    bytes[chunk] = 44; // Outside all three samples.
    expect(await computePdfFingerprint(bytes)).toBe(expected);
    expect(await computePdfFingerprint(bytes.subarray(1))).not.toBe(expected);
  });

  it('hashes a sample URL locally', async () => {
    const url = '/samples/attention.pdf';
    expect(await computePdfFingerprint(url)).toBe('552195fc09654f3618785e70a3fe0eddb68ea18eb737b343e2ccd1b88f225b22');
  });

  it('computes the reader hash before pdf.js detaches the supplied bytes', async () => {
    const source = new Uint8Array([1, 7, 12]);
    const expected = 'a08cb7dfcfe38a94aff64739b7953ba48a0c4f75b2544bacf3ed2ac560d6bf01';
    const doc = annotationDoc();
    vi.mocked(getDocument).mockImplementationOnce((options) => {
      const { data } = options as { data: Uint8Array };
      structuredClone(data, { transfer: [data.buffer] });
      return { promise: Promise.resolve(doc) } as ReturnType<typeof getDocument>;
    });
    expect(await loadReaderPdf(source.buffer, 'test.pdf')).toEqual({ doc, paperHash: expected });
    expect(source.byteLength).toBe(0);
  });

  it('destroys a pending loading task on abort', async () => {
    const controller = new AbortController();
    const destroy = vi.fn(async () => {});
    vi.mocked(getDocument).mockReturnValueOnce({
      promise: new Promise(() => {}), destroy,
    } as unknown as ReturnType<typeof getDocument>);
    const pending = loadPdfDocument('/samples/attention.pdf', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
