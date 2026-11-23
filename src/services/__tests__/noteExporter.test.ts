import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotationDoc } from '../../engine/__tests__/fixtures';
import { recropPageRegion } from '../../engine/assetExtractor';
import { buildStoredZip, buildStudyNotesMarkdown, crc32, exportStudyPackZip, type StudyNotes } from '../noteExporter';
import { setLocale } from '../../i18n/core';

vi.mock('../../engine/assetExtractor', () => ({ recropPageRegion: vi.fn() }));
const rect = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
const ref = { key: 'ref-4', index: 4, pageNumber: 9, title: 'Scale', authors: 'A. Smith', year: '2024', rawText: 'Scale. doi:10.1234/abc.' };
const link = (pageNumber: number) => ({ pageNumber, citationId: String(pageNumber), rect, rawText: 'Fig. 2' });
const notes: StudyNotes = {
  fileName: 'A: "Paper".pdf', currentPage: 3, numPages: 10,
  pinnedItems: [
    { id: 'fig-2', kind: 'figure', title: 'Figure 2', subtitle: 'A caption.', pageNumber: 2, cropRect: rect, createdAt: 0 },
    { id: 'snip', kind: 'snip', title: '摘录', pageNumber: 5, cropRect: rect, imageUrl: 'data:image/png;base64,AQID', createdAt: 1 },
    { id: ref.key, kind: 'reference', title: 'Scale', pageNumber: 9, reference: ref, createdAt: 2 },
  ],
  backlinksMap: { 'fig-2': [link(5), link(3), link(5)], 'ref-4': [link(3)] },
  glossaryMap: { MHA: { term: 'MHA', expansion: 'Multi-head attention', kind: 'acronym', definedRect: rect, definedPage: 1, contextSentence: '' } },
};

async function extract(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let central = view.getUint32(end + 16, true);
  expect(central + view.getUint32(end + 12, true)).toBe(end);
  const entries = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    const off = view.getUint32(central + 42, true), nameLen = view.getUint16(central + 28, true);
    expect(view.getUint32(off, true)).toBe(0x04034b50);
    expect(view.getUint16(off + 6, true)).toBe(0x0800);
    expect(view.getUint16(central + 8, true)).toBe(0x0800);
    expect(view.getUint16(off + 8, true)).toBe(0);
    const length = view.getUint32(central + 24, true);
    const name = bytes.slice(off + 30, off + 30 + nameLen);
    expect(bytes.slice(central + 46, central + 46 + nameLen)).toEqual(name);
    const data = bytes.slice(off + 30 + nameLen, off + 30 + nameLen + length);
    expect(crc32(data)).toBe(view.getUint32(off + 14, true));
    expect(crc32(data)).toBe(view.getUint32(central + 16, true));
    entries.set(new TextDecoder().decode(name), data);
    central += 46 + nameLen;
  }
  expect(central).toBe(end);
  return entries;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('local study notes', () => {
  it('includes page-sorted quotes and optional multiline annotations in Markdown and ZIP', async () => {
    setLocale('zh-CN');
    const mark = { id: 'late', pageNumber: 7, rects: [rect], text: '第二段', color: 'green' as const, createdAt: 1, updatedAt: 2 };
    const highlights = [mark, { ...mark, id: 'early', pageNumber: 2, text: '第一段', note: '批注一\n批注二' }];
    const input = { ...notes, pinnedItems: [], highlights };
    const section = '## 高亮与批注\n\n> 第一段（第 2 页）\n\n批注一\n批注二\n\n> 第二段（第 7 页）\n';
    expect(buildStudyNotesMarkdown(input)).toContain(section);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.stubGlobal('document', { body: { append: vi.fn() }, createElement: () => ({ click: vi.fn(), remove: vi.fn() }) });
    await exportStudyPackZip(input, null);
    const entries = await extract(create.mock.calls[0][0] as Blob);
    expect([...entries.keys()]).toEqual(['notes.md']);
    expect(new TextDecoder().decode(entries.get('notes.md'))).toContain(section);
    expect(highlights[0]).toBe(mark);
  });

  it('writes quoted YAML, dock order, unique backlinks, bibliography and glossary', () => {
    setLocale('en');
    const markdown = buildStudyNotesMarkdown(notes, undefined, new Date(0));
    expect(markdown).toContain('title: "A: \\"Paper\\""');
    expect(markdown).toContain('exported_at: "1970-01-01T00:00:00.000Z"\npages: 10\nsource: RefPin');
    expect(markdown.indexOf('Figure 2 · P.2')).toBeLessThan(markdown.indexOf('摘录 · P.5'));
    expect(markdown).toContain('A caption.\n\nCited on: P.3, P.5');
    expect(markdown).toContain('Related pinned references: [4]');
    expect(markdown).toContain('\x60\x60\x60bibtex\n@article{ref-4');
    expect(markdown).toContain('| MHA | Multi-head attention | P.1 |');
    expect(markdown).not.toContain('assets/');
  });

  it('exports HTML figures and tables without a PDF document or invented page numbers', async () => {
    const htmlNotes: StudyNotes = {
      fileName: 'HTML paper', numPages: 0, currentPage: 0,
      pinnedItems: [
        { id: 'fig:1', kind: 'figure', title: 'Diagram', pageNumber: 0, createdAt: 1, imageUrl: 'https://publisher.example/diagram.png' },
        { id: 'table:1', kind: 'table', title: 'Results', pageNumber: 0, createdAt: 2 },
      ],
      tableRows: { 'table:1': [['Method', 'Score'], ['Local', '91']] },
      backlinksMap: { 'fig:1': [{ ...link(0), domAnchorId: 'mention' }] }, glossaryMap: {},
    };
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    const markdown = buildStudyNotesMarkdown(htmlNotes);
    expect(markdown).toContain('| Local | 91 |');
    expect(markdown).toContain('Mentions in the text (1)');
    expect(markdown).not.toContain('P.0');
    expect(fetch).not.toHaveBeenCalled();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const anchor = { click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { body: { append: vi.fn() }, createElement: () => anchor });
    expect(await exportStudyPackZip(htmlNotes, null)).toBe(0);
    const entries = await extract(create.mock.calls[0][0] as Blob);
    expect([...entries.keys()]).toEqual(['notes.md', 'assets/01-diagram.png']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('packs byte-accurate Unicode STORE entries including empty files', async () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
    const result = await extract(buildStoredZip([{ name: 'assets/图.png', data }, { name: 'empty', data: new Uint8Array() }]));
    expect(result.get('assets/图.png')).toEqual(data);
    expect(result.get('empty')).toHaveLength(0);
  });

  it('recrops every visual at 2.5×, falls back per pin, and downloads the matching image links', async () => {
    vi.useFakeTimers();
    vi.mocked(recropPageRegion).mockResolvedValueOnce('data:image/webp;base64,BAUG').mockRejectedValueOnce(new Error());
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchor = { click: vi.fn(), remove: vi.fn(), download: '' };
    vi.stubGlobal('document', { body: { append: vi.fn() }, createElement: () => anchor });
    const doc = annotationDoc();
    expect(await exportStudyPackZip(notes, doc)).toBe(0);
    expect(recropPageRegion).toHaveBeenNthCalledWith(1, doc, 2, rect, 2.5, undefined);
    expect(recropPageRegion).toHaveBeenNthCalledWith(2, doc, 5, rect, 2.5, undefined);
    expect(anchor.download).toBe('A-Paper-RefPin-Notes.zip');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    const entries = await extract(create.mock.calls[0][0] as Blob);
    expect([...entries.keys()]).toEqual(['notes.md','assets/01-figure-2.webp','assets/02-摘录.png']);
    expect(new TextDecoder().decode(entries.get('notes.md'))).toContain('![Figure 2](assets/01-figure-2.webp)');
    expect(entries.get('assets/02-摘录.png')).toEqual(new Uint8Array([1,2,3]));
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
