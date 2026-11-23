import { LocalizedError, message } from '../i18n/core';
import type { Highlight, PaperArchive, PersistedPinnedItem, PinnedItem } from '../types/paper';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const ARCHIVE_LIMIT = 30;
const PDF_LIMIT = 5;

export function stripPinnedItemForStorage(item: PinnedItem): PersistedPinnedItem {
  const { id, kind, title, subtitle, textPreview, pageNumber, cropRect, originalCropRect, collapsed, reference, createdAt } = item;
  return {
    id, kind, title, ...(item.automaticTitle && { automaticTitle: true }),
    subtitle, ...(textPreview !== undefined && { textPreview }),
    pageNumber, cropRect, originalCropRect, collapsed, reference, createdAt,
  };
}

export function computeLruEvictions(
  entries: ReadonlyArray<Pick<PaperArchive, 'paperHash' | 'lastOpenedAt'>>,
  limit: number,
): string[] {
  const excess = entries.length - Math.max(0, limit);
  if (excess <= 0) return [];
  return [...entries].sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)
    .slice(0, excess).map(entry => entry.paperHash);
}

type LegacyArchive = Omit<PaperArchive, 'highlights'> & { highlights?: Highlight[] };

export function migratePaperArchive(archive: LegacyArchive): PaperArchive {
  return { ...archive, highlights: archive.highlights ?? [] };
}

// 只应用本次阅读会话改动的条目，滚动或缩放触发的保存也能保留其他窗口的批注。
export function mergeHighlightChanges(stored: Highlight[], previous: Highlight[], current: Highlight[]) {
  if (previous === current) return stored;
  const byId = new Map(stored.map(item => [item.id, item]));
  const before = new Map(previous.map(item => [item.id, item]));
  for (const item of current) {
    if (before.get(item.id) !== item) byId.set(item.id, item);
    before.delete(item.id);
  }
  for (const id of before.keys()) byId.delete(id);
  return [...byId.values()];
}

let connection: Promise<IDBDatabase> | undefined;
function openDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('refpin.papers', 2);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new LocalizedError(message('archive.locked')));
    };
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) {
        request.result.createObjectStore('archives', { keyPath: 'paperHash' });
        const blobs = request.result.createObjectStore('pdfBlobs', { keyPath: 'paperHash' });
        blobs.createIndex('lastOpenedAt', 'lastOpenedAt');
      } else if (event.oldVersion === 1) {
        const rows = request.transaction!.objectStore('archives').openCursor();
        rows.onsuccess = () => {
          const cursor = rows.result;
          if (!cursor) return;
          if (!cursor.value.highlights) cursor.update(migratePaperArchive(cursor.value));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    connection = undefined;
    throw error;
  });
  return connection;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (archives: IDBObjectStore, blobs: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(['archives', 'pdfBlobs'], mode);
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const operation = work(tx.objectStore('archives'), tx.objectStore('pdfBlobs')).catch(error => {
    try { tx.abort(); } catch { /* 事务可能已由 IndexedDB 中止。 */ }
    throw error;
  });
  const [value] = await Promise.all([operation, complete]);
  return value;
}

async function transact<T>(
  mode: IDBTransactionMode,
  fallback: T,
  work: (archives: IDBObjectStore, blobs: IDBObjectStore) => Promise<T>,
): Promise<T> {
  try {
    return await runTransaction(mode, work);
  } catch {
    // Storage can be unavailable or full. Reading the PDF still works.
    return fallback;
  }
}

export function loadPaperArchive(hash: string): Promise<PaperArchive | undefined> {
  return transact('readonly', undefined, async archives => {
    const archive = await result(archives.get(hash));
    return archive && migratePaperArchive(archive);
  });
}

export function readAllPaperArchives(): Promise<PaperArchive[]> {
  return runTransaction('readonly', async archives => {
    const rows: LegacyArchive[] = await result(archives.getAll());
    return rows.map(migratePaperArchive).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  });
}

export function listRecentPapers(): Promise<PaperArchive[]> {
  return readAllPaperArchives().catch(() => []);
}

export function planArchiveImport(existing: PaperArchive[], incoming: PaperArchive[]) {
  const local = new Map(existing.map(row => [row.paperHash, row]));
  const merged = new Map(local);
  for (const row of incoming) {
    const previous = merged.get(row.paperHash);
    if (!previous || row.lastOpenedAt > previous.lastOpenedAt) merged.set(row.paperHash, row);
  }
  const evicted = computeLruEvictions([...merged.values()], ARCHIVE_LIMIT);
  for (const key of evicted) merged.delete(key);
  return {
    updates: [...merged.values()].filter(row => local.get(row.paperHash) !== row),
    evicted: evicted.filter(key => local.has(key)),
  };
}

export function mergePaperArchives(incoming: PaperArchive[]) {
  return runTransaction('readwrite', async (archives, blobs) => {
    const { updates, evicted } = planArchiveImport(await result(archives.getAll()), incoming);
    for (const row of updates) {
      const hasCachedPdf = await result(blobs.getKey(row.paperHash)) !== undefined;
      archives.put({ ...row, hasCachedPdf });
    }
    for (const key of evicted) {
      archives.delete(key);
      blobs.delete(key);
    }
    return { imported: updates.map(row => row.paperHash), evicted };
  });
}

export function savePaperArchive(archive: Omit<LegacyArchive, 'hasCachedPdf'>, previousHighlights?: Highlight[]): Promise<boolean> {
  return transact('readwrite', false, async (archives, blobs) => {
    const { paperHash, sampleId } = archive;
    const stored: LegacyArchive | undefined = await result(archives.get(paperHash));
    // 另一窗口可能刚恢复了较新的档案。旧会话自动保存时仅应用它实际编辑过的批注。
    if (stored && stored.lastOpenedAt > archive.lastOpenedAt) {
      if (archive.highlights && previousHighlights && archive.highlights !== previousHighlights) {
        archives.put({ ...stored, highlights: mergeHighlightChanges(stored.highlights ?? [], previousHighlights, archive.highlights) });
      }
      return true;
    }
    if (sampleId) blobs.delete(paperHash);
    const hasCachedPdf = !sampleId && (await result(blobs.getKey(paperHash))) !== undefined;
    let highlights = archive.highlights ?? stored?.highlights ?? [];
    if (stored && previousHighlights && archive.highlights) {
      highlights = mergeHighlightChanges(stored.highlights ?? [], previousHighlights, archive.highlights);
    }
    archives.put({ ...archive, highlights, hasCachedPdf, pinnedItems: archive.pinnedItems.map(stripPinnedItemForStorage) });
    if (await result(archives.count()) > ARCHIVE_LIMIT) {
      const evicted = computeLruEvictions(await result(archives.getAll()), ARCHIVE_LIMIT);
      for (const key of evicted) {
        archives.delete(key);
        blobs.delete(key);
      }
    }
    return true;
  });
}

export function deletePaperArchive(hash: string) {
  return transact('readwrite', false, async (archives, blobs) => {
    archives.delete(hash);
    blobs.delete(hash);
    return true;
  });
}

export async function savePdfBlob(hash: string, blob: Blob, sampleId?: string): Promise<boolean> {
  if (sampleId || blob.size > MAX_PDF_BYTES) return false;
  return transact('readwrite', false, async (archives, blobs) => {
    const archive: PaperArchive | undefined = await result(archives.get(hash));
    if (archive?.sampleId) return false;
    blobs.put({ paperHash: hash, blob, lastOpenedAt: Date.now() });
    if (archive) archives.put({ ...archive, hasCachedPdf: true });
    // Only read keys for eviction. A five-entry cache can hold 75 MB.
    const keys = await result(blobs.index('lastOpenedAt').getAllKeys());
    for (const key of keys.slice(0, Math.max(0, keys.length - PDF_LIMIT))) {
      blobs.delete(key);
      const previous: PaperArchive | undefined = await result(archives.get(key));
      if (previous) archives.put({ ...previous, hasCachedPdf: false });
    }
    return true;
  });
}

export function loadPdfBlob(hash: string): Promise<Blob | undefined> {
  return transact('readwrite', undefined, async (archives, blobs) => {
    const row = await result(blobs.get(hash));
    if (!row) {
      const archive: PaperArchive | undefined = await result(archives.get(hash));
      if (archive?.hasCachedPdf) archives.put({ ...archive, hasCachedPdf: false });
      return undefined;
    }
    blobs.put({ ...row, lastOpenedAt: Date.now() });
    return row.blob as Blob;
  });
}
