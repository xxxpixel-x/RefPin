import type { PDFDocumentProxy } from 'pdfjs-dist';
import { recropPageRegion } from '../engine/assetExtractor';
import { t } from '../i18n/core';
import { pinTitle } from '../i18n/pinTitle';
import type { CitationBacklink, GlossaryEntry, PinnedItem } from '../types/paper';
import { buildFallbackBibtex, extractDoi, getCachedScholarMetadata } from './scholarLookup';

const utf8 = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; data: Uint8Array }
export function buildStoredZip(entries: ZipEntry[]): Blob {
  const local: BlobPart[] = [], directory: BlobPart[] = [];
  let offset = 0, directorySize = 0;
  if (entries.length >= 65535) throw new RangeError('ZIP32 entry limit');
  for (const { name, data } of entries) {
    const path = utf8.encode(name);
    const checksum = crc32(data);
    if (path.length > 65535 || offset + data.length + path.length + 30 >= 0xffffffff) throw new RangeError('ZIP32 size limit');
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(12, 33, true); // DOS date 1980-01-01
    header.setUint32(14, checksum, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, path.length, true);
    local.push(header.buffer, path, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    // Version needed through filename length are identical in both headers.
    new Uint8Array(central.buffer, 6, 24).set(new Uint8Array(header.buffer, 4, 24));
    central.setUint32(42, offset, true);
    directory.push(central.buffer, path);
    offset += 30 + path.length + data.length;
    directorySize += 46 + path.length;
  }
  if (offset + directorySize + 22 >= 0xffffffff) throw new RangeError('ZIP32 size limit');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...directory, end.buffer], { type: 'application/zip' });
}

export interface StudyNotes {
  fileName: string;
  numPages: number;
  currentPage: number;
  pinnedItems: PinnedItem[];
  backlinksMap: Record<string, CitationBacklink[]>;
  glossaryMap: Record<string, GlossaryEntry>;
}

function md(value: string) {
  return value.replace(/\s+/g, ' ').trim().replace(/([\\<>*_\x60\[\]|])/g, '\\$1');
}

export function buildStudyNotesMarkdown(notes: StudyNotes, images?: Map<string, string>, exportedAt = new Date()): string {
  const title = notes.fileName.replace(/\.pdf$/i, '') || 'RefPin';
  const visuals = notes.pinnedItems.filter(item => item.kind !== 'reference');
  const references = notes.pinnedItems.filter(item => item.reference);
  const lines = ['---', 'title: ' + JSON.stringify(title), 'exported_at: ' + JSON.stringify(exportedAt.toISOString()),
    'pages: ' + notes.numPages, 'source: RefPin', '---', '', '# ' + md(title), '',
    t('notes.summary', { page: notes.currentPage, pages: notes.numPages, visuals: visuals.length, refs: references.length })];
  const citedPages = (id: string) => [...new Set(notes.backlinksMap[id]?.map(link => link.pageNumber))].sort((a,b) => a-b);
  const addBacklinks = (pages: number[]) => {
    if (pages.length) lines.push('', t('notes.cited', { pages: pages.map(page => 'P.' + page).join(', ') }));
  };
  lines.push('', '## ' + t('notes.visuals'));
  if (!visuals.length) lines.push('', t('notes.none'));
  for (const item of visuals) {
    const label = md(pinTitle(item));
    lines.push('', '### ' + label + ' · P.' + item.pageNumber);
    const path = images?.get(item.id);
    if (path) lines.push('', '![' + label + '](' + path + ')');
    else if (images) lines.push('', t('notes.noImage'));
    if (item.subtitle) lines.push('', md(item.subtitle));
    const pages = citedPages(item.id);
    addBacklinks(pages);
    const related = references.filter(pin => citedPages(pin.id).some(page => pages.includes(page)));
    if (related.length) lines.push('', t('notes.related', { refs: related.map(pin => '[' + pin.reference!.index + ']').join(', ') }));
  }
  lines.push('', '## ' + t('notes.references'));
  if (!references.length) lines.push('', t('notes.none'));
  for (const item of references) {
    const ref = item.reference!;
    const meta = getCachedScholarMetadata(ref);
    lines.push('', '### [' + ref.index + '] ' + md(meta?.title || ref.title || ref.rawText) + ' · P.' + item.pageNumber);
    const detail = [meta?.authors || ref.authors, meta?.year || ref.year, meta?.venue].filter(Boolean).join(' · ');
    if (detail) lines.push('', md(detail));
    const doi = meta?.doi || extractDoi(ref.rawText);
    if (doi) lines.push('', 'DOI: ' + md(doi));
    if (meta) lines.push('', [meta.source === 'openalex' ? 'OpenAlex' : 'Crossref',
      meta.citedByCount !== undefined && t('scholar.cited', { count: meta.citedByCount })].filter(Boolean).join(' · '));
    addBacklinks(citedPages(item.id));
    const entry = meta?.bibtex || buildFallbackBibtex(ref);
    const longest = Math.max(2, ...(entry.match(/\x60+/g) || []).map(run => run.length));
    const fence = '\x60'.repeat(longest + 1);
    lines.push('', fence + 'bibtex', entry, fence);
  }
  const terms = Object.values(notes.glossaryMap).sort((a,b) => a.definedPage - b.definedPage).slice(0, 24);
  if (terms.length) {
    lines.push('', '## ' + t('notes.glossary'), '', t('notes.columns'), '| --- | --- | --- |');
    for (const term of terms) lines.push('| ' + md(term.term) + ' | ' + md(term.expansion) + ' | P.' + term.definedPage + ' |');
  }
  return lines.join('\n') + '\n';
}

function safeName(value: string) {
  const clean = value.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-');
  return Array.from(clean).slice(0, 56).join('').replace(/^-+|-+$/g, '') || 'Paper';
}

export async function exportStudyPackZip(notes: StudyNotes, pdfDoc: PDFDocumentProxy, signal?: AbortSignal) {
  const entries: ZipEntry[] = [];
  const images = new Map<string, string>();
  let missing = 0, number = 0;
  for (const item of notes.pinnedItems) {
    signal?.throwIfAborted();
    if (item.kind === 'reference') continue;
    number++;
    let fresh: string | undefined;
    if (item.cropRect) {
      try { fresh = await recropPageRegion(pdfDoc, item.pageNumber, item.cropRect, 2.5, signal); } catch { signal?.throwIfAborted(); }
    }
    for (const url of [fresh, item.imageUrl]) {
      const match = url && /^data:image\/(webp|png);base64,(.+)$/i.exec(url);
      if (!match) continue;
      try {
        const data = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
        const name = 'assets/' + String(number).padStart(2, '0') + '-' + safeName(pinTitle(item)).toLowerCase() + '.' + match[1].toLowerCase();
        entries.push({ name, data });
        images.set(item.id, name);
        break;
      } catch { /* Try the next image. */ }
    }
    if (!images.has(item.id)) missing++;
  }
  signal?.throwIfAborted();
  entries.unshift({ name: 'notes.md', data: utf8.encode(buildStudyNotesMarkdown(notes, images)) });
  const url = URL.createObjectURL(buildStoredZip(entries));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = safeName(notes.fileName.replace(/\.pdf$/i, '')) + '-RefPin-Notes.zip';
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return missing;
}
