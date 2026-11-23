import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBackupSettings, createReadingBackup, parseReadingBackup } from '../readingBackup';
import { planArchiveImport, readAllPaperArchives } from '../paperDb';
import { getLocale } from '../../i18n/core';
import { useReaderStore } from '../../store/useReaderStore';
import type { PaperArchive } from '../../types/paper';

vi.mock('../paperDb', async importOriginal => ({
  ...await importOriginal<typeof import('../paperDb')>(), readAllPaperArchives: vi.fn(),
}));

const crop = { x: 0.2, y: 0.1, width: 0.6, height: 0.3 };
const row: PaperArchive = {
  paperHash: 'a'.repeat(64), fileName: '示例.pdf', numPages: 7, lastPage: 3, scale: 1.4,
  lastScrollTop: 2000, lastOpenedAt: 10, hasCachedPdf: true,
  pinnedItems: [{ id: 'figure-1', kind: 'figure', pageNumber: 3, title: '我的图',
    cropRect: crop, originalCropRect: { ...crop, height: 0.2 }, collapsed: true, createdAt: 4 }],
  highlights: [{ id: 'h1', pageNumber: 3, rects: [crop, { ...crop, y: 0.5 }], text: '原文',
    color: 'rose', createdAt: 4, updatedAt: 8, note: '第一行\n第二行' }],
};
const envelope = { format: 'refpin-backup', version: 1, archives: [row] };
const parse = (archives: unknown[]) => parseReadingBackup(JSON.stringify({ ...envelope, archives }));

afterEach(() => vi.unstubAllGlobals());

describe('阅读档案备份', () => {
  it('往返保留进度、裁切坐标、多段高亮和批注，只输出论文元数据', async () => {
    vi.mocked(readAllPaperArchives).mockResolvedValue([{ ...row, pinnedItems: [
      Object.assign({}, row.pinnedItems[0], { imageUrl: 'data:image/png;base64,xxx' }),
    ] }]);
    const json = JSON.stringify(await createReadingBackup());
    expect(json).not.toMatch(/data:image|hasCachedPdf|pdfBlobs|translateConfig/);
    expect(JSON.parse(json)).toMatchObject({ format: 'refpin-backup', version: 1, exportedAt: expect.any(String) });
    expect(parseReadingBackup(json).archives).toEqual([{ ...row, hasCachedPdf: false }]);
  });

  it('兼容缺少高亮、钉板和进度的旧记录，缺少身份或时间的记录单独跳过', () => {
    const { paperHash, fileName, numPages, lastOpenedAt } = row;
    const parsed = parse([null, {}, { fileName, numPages, paperHash }, { paperHash, fileName, numPages, lastOpenedAt }]);
    expect(parsed.total).toBe(4);
    expect(parsed.archives).toEqual([expect.objectContaining({ paperHash, pinnedItems: [], highlights: [],
      hasCachedPdf: false, lastPage: 1, lastScrollTop: 0, scale: 1.25 })]);
    expect(parsed.settings).toEqual({});
  });

  it.each(['{', 'null', '[]', JSON.stringify({}), JSON.stringify({ ...envelope, format: 'other' }),
    JSON.stringify({ ...envelope, version: 2 }), JSON.stringify({ ...envelope, archives: null }),
    JSON.stringify({ ...envelope, settings: { theme: [] } }), JSON.stringify({ ...envelope, translateConfig: {
      provider: 'openai', targetLang: 'en', model: 'test', apiBaseUrl: 'javascript:bad',
    } })])('拒绝无效的备份文件', json => {
    expect(() => parseReadingBackup(json)).toThrow();
  });

  it('非法记录无法用更新的时间覆盖完整档案；未知字段和伪造的缓存标记不入库', () => {
    const invalidFields = [{ numPages: -2 }, { lastPage: 8 }, { scale: 'large' }, { lastOpenedAt: 1e20 },
      { highlights: {} }, { highlights: [{ ...row.highlights[0], color: 'neon' }] },
      { highlights: [{ ...row.highlights[0], rects: [{ ...crop, x: 0.9 }] }] },
      { highlights: [{ ...row.highlights[0], note: { text: 'invalid' } }] },
      { pinnedItems: [{ ...row.pinnedItems[0], reference: { index: 'not an integer' } }] },
      { pinnedItems: [row.pinnedItems[0], row.pinnedItems[0]] }];
    const parsed = parse([...invalidFields.map(fields => ({ ...row, lastOpenedAt: 25, ...fields })),
      { ...row, pdfBlob: 'bad', pinnedItems: [{ ...row.pinnedItems[0], imageUrl: 'bad' }] }]);
    expect(parsed.archives).toEqual([{ ...row, hasCachedPdf: false }]);
    expect(planArchiveImport([row], parsed.archives).updates).toEqual([]);
  });

  it('同一哈希只计一次，新旧与文件顺序无关，相同时间保留本机数据', () => {
    const fresh = { ...row, lastOpenedAt: 12, fileName: 'new' };
    const other = { ...row, paperHash: 'b'.repeat(64) };
    for (const rows of [[row, fresh, other, fresh], [fresh, row, other, fresh]]) {
      expect(planArchiveImport([row], rows).updates).toEqual([fresh, other]);
    }
    expect(planArchiveImport([fresh], [row, { ...fresh, fileName: 'duplicate' }]).updates).toEqual([]);
  });

  it('合并后沿用最近 30 篇的上限，仅计入最终写入的记录', () => {
    const existing = Array.from({ length: 30 }, (_, i) => ({ ...row, paperHash: i.toString(16).padStart(64, '0'), lastOpenedAt: i + 2 }));
    const newer = { ...row, paperHash: 'b'.repeat(64), lastOpenedAt: 35 };
    const update = { ...existing[0], lastOpenedAt: 32 };
    const tooOld = { ...row, lastOpenedAt: 1 };
    expect(planArchiveImport(existing, [tooOld, newer, update])).toEqual({
      updates: [update, newer], evicted: [existing[1].paperHash],
    });
  });

  it('只恢复备份中提供的界面选项，保留本机的联网授权', () => {
    const store = useReaderStore.getState();
    const locale = getLocale();
    try {
      const { settings } = parseReadingBackup(JSON.stringify({ ...envelope, settings: {
        locale: 'zh-CN', theme: 'sepia', dockWidth: 450, readingRulerEnabled: true, scholarLookupEnabled: true,
      } }));
      applyBackupSettings(settings);
      expect(getLocale()).toBe('zh-CN');
      expect(useReaderStore.getState()).toMatchObject({ theme: 'sepia', dockWidth: 450, readingRulerEnabled: true,
        dockHeight: store.dockHeight, scholarLookupEnabled: store.scholarLookupEnabled });
    } finally { applyBackupSettings({ ...store, dockPosition: undefined, locale }); }
  });
});
