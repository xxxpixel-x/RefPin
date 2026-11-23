import { getLocale, LocalizedError, message, setLocale } from '../i18n/core';
import type { Locale } from '../i18n/types';
import { exportBackupTranslateConfig, type BackupTranslateConfig } from '../services/translator';
import { useReaderStore, type Theme } from '../store/useReaderStore';
import type { DockEdge, Highlight, NormalizedRect, PaperArchive, PersistedPinnedItem, ReferenceEntry } from '../types/paper';
import { readAllPaperArchives } from './paperDb';

interface BackupSettings {
  theme?: Theme;
  locale?: Locale;
  readingRulerEnabled?: boolean;
  autoSyncEnabled?: boolean;
  dockPosition?: DockEdge;
  dockWidth?: number;
  dockHeight?: number;
  dockCollapsed?: boolean;
}

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

function invalid(): never {
  throw new LocalizedError(message('backup.invalid'));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

function identifier(value: unknown): string {
  const id = string(value);
  return id.trim() && !(id in Object.prototype) ? id : invalid();
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}

function oneOf<const T extends string>(value: unknown, choices: readonly T[]): T {
  return choices.find(choice => choice === value) ?? invalid();
}

function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value);
}

function number(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid();
  return value;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) ? number(value, min, max) : invalid();
}

function timestamp(value: unknown) {
  return integer(value, 0, 8.64e15);
}

function rect(value: unknown): NormalizedRect {
  const r = object(value);
  const x = number(r.x, 0, 1), y = number(r.y, 0, 1);
  const width = number(r.width, 0, 1), height = number(r.height, 0, 1);
  // 归一化坐标相加时允许页面边界上的浮点舍入误差。
  if (!width || !height || x + width > 1.000001 || y + height > 1.000001) return invalid();
  return { x, y, width, height };
}

function reference(value: unknown, pages: number): ReferenceEntry {
  const r = object(value);
  return {
    key: identifier(r.key), index: integer(r.index, 0), rawText: string(r.rawText),
    pageNumber: integer(r.pageNumber, 1, pages), title: optional(r.title, string),
    authors: optional(r.authors, string), year: optional(r.year, string),
    firstAuthorLastName: optional(r.firstAuthorLastName, string),
    secondAuthorLastName: optional(r.secondAuthorLastName, string), isEtAl: optional(r.isEtAl, bool),
  };
}

function pin(value: unknown, pages: number): PersistedPinnedItem {
  const p = object(value);
  return {
    id: identifier(p.id), title: string(p.title),
    kind: oneOf(p.kind, ['figure', 'table', 'equation', 'algorithm', 'theorem', 'section', 'reference', 'snip', 'glossary']),
    pageNumber: integer(p.pageNumber, 1, pages), createdAt: timestamp(p.createdAt),
    subtitle: optional(p.subtitle, string), textPreview: optional(p.textPreview, string),
    automaticTitle: optional(p.automaticTitle, bool), collapsed: optional(p.collapsed, bool),
    cropRect: optional(p.cropRect, rect), originalCropRect: optional(p.originalCropRect, rect),
    reference: optional(p.reference, value => reference(value, pages)),
  };
}

function highlight(value: unknown, pages: number): Highlight {
  const h = object(value);
  if (!Array.isArray(h.rects) || !h.rects.length) return invalid();
  return {
    id: identifier(h.id), pageNumber: integer(h.pageNumber, 1, pages), rects: h.rects.map(rect),
    text: string(h.text), color: oneOf(h.color, ['amber', 'green', 'blue', 'rose']),
    note: optional(h.note, string), createdAt: timestamp(h.createdAt),
    updatedAt: timestamp(h.updatedAt === undefined ? h.createdAt : h.updatedAt),
  };
}

function items<T extends { id: string }>(value: unknown, pages: number, read: (item: unknown, pages: number) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return invalid();
  const list = value.map(item => read(item, pages));
  if (new Set(list.map(item => item.id)).size !== list.length) return invalid();
  return list;
}

function archive(value: unknown): PaperArchive {
  const row = object(value);
  const paperHash = string(row.paperHash);
  if (!/^[a-f0-9]{64}$/.test(paperHash)) return invalid();
  const numPages = integer(row.numPages, 1);
  const fileName = string(row.fileName);
  if (!fileName.trim()) return invalid();
  return {
    paperHash, fileName, numPages, lastOpenedAt: timestamp(row.lastOpenedAt),
    lastPage: optional(row.lastPage, value => integer(value, 1, numPages)) ?? 1,
    lastScrollTop: optional(row.lastScrollTop, value => number(value, 0, Number.MAX_SAFE_INTEGER)) ?? 0,
    scale: optional(row.scale, value => number(value, 0.6, 2.5)) ?? 1.25,
    sampleId: optional(row.sampleId, identifier), hasCachedPdf: false,
    pinnedItems: items(row.pinnedItems, numPages, pin), highlights: items(row.highlights, numPages, highlight),
  };
}

function readSettings(value: unknown): BackupSettings {
  const s = object(value);
  return {
    theme: optional(s.theme, v => oneOf(v, ['light', 'sepia', 'dark'])),
    locale: optional(s.locale, v => oneOf(v, ['en', 'zh-CN'])),
    readingRulerEnabled: optional(s.readingRulerEnabled, bool), autoSyncEnabled: optional(s.autoSyncEnabled, bool),
    dockPosition: optional(s.dockPosition, v => oneOf(v, ['left', 'right', 'top', 'bottom'])),
    dockWidth: optional(s.dockWidth, v => integer(v, 220, 32768)),
    dockHeight: optional(s.dockHeight, v => integer(v, 148, 32768)), dockCollapsed: optional(s.dockCollapsed, bool),
  };
}

function readTranslateConfig(value: unknown): BackupTranslateConfig {
  const c = object(value);
  const apiBaseUrl = string(c.apiBaseUrl);
  if (apiBaseUrl) {
    let url: URL;
    try { url = new URL(apiBaseUrl); } catch { return invalid(); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return invalid();
  }
  if (c.webOnly !== undefined && c.webOnly !== true) return invalid();
  return {
    provider: oneOf(c.provider, ['openai', 'free']), targetLang: oneOf(c.targetLang, ['en', 'zh-CN']),
    apiBaseUrl, apiKey: optional(c.apiKey, string), model: string(c.model),
    ...(c.webOnly === true && { webOnly: true }),
  };
}

export function parseReadingBackup(json: string) {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return invalid(); }
  const root = object(data);
  if (root.format !== 'refpin-backup' || root.version !== 1 || !Array.isArray(root.archives)) return invalid();
  if (root.exportedAt !== undefined && !Number.isFinite(Date.parse(string(root.exportedAt)))) return invalid();
  const settings = optional(root.settings, readSettings) ?? {};
  const translateConfig = optional(root.translateConfig, readTranslateConfig);
  const archives: PaperArchive[] = [];
  for (const row of root.archives) {
    try { archives.push(archive(row)); }
    catch (error) { if (!(error instanceof LocalizedError)) throw error; }
  }
  return { archives, settings, translateConfig, total: root.archives.length };
}

export type ParsedReadingBackup = ReturnType<typeof parseReadingBackup>;

export function applyBackupSettings(s: BackupSettings) {
  const store = useReaderStore.getState();
  if (s.theme) store.setTheme(s.theme);
  if (s.locale) setLocale(s.locale);
  if (s.readingRulerEnabled !== undefined) store.setReadingRulerEnabled(s.readingRulerEnabled);
  if (s.autoSyncEnabled !== undefined) store.setAutoSyncEnabled(s.autoSyncEnabled);
  if (s.dockPosition) store.setDockPosition(s.dockPosition);
  if (s.dockWidth !== undefined) store.setDockWidth(s.dockWidth);
  if (s.dockHeight !== undefined) store.setDockHeight(s.dockHeight);
  if (s.dockCollapsed !== undefined) store.setDockCollapsed(s.dockCollapsed);
}

export async function createReadingBackup(includeApiKey = false) {
  const rows = await readAllPaperArchives();
  const translateConfig = await exportBackupTranslateConfig(includeApiKey);
  const { theme, readingRulerEnabled, autoSyncEnabled, dockPosition, dockWidth, dockHeight, dockCollapsed } = useReaderStore.getState();
  return {
    format: 'refpin-backup', version: 1, exportedAt: new Date().toISOString(),
    archives: rows.map(record => {
      const { hasCachedPdf: _local, ...metadata } = archive(record);
      return metadata;
    }),
    settings: { theme, locale: getLocale(), readingRulerEnabled, autoSyncEnabled, dockWidth, dockHeight,
      dockCollapsed, ...(dockPosition !== 'popout' && { dockPosition }) },
    ...(translateConfig && { translateConfig }),
  };
}
