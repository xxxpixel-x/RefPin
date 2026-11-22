// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetDrawer } from '../AssetDrawer';
import { PinDock } from '../../dock/PinDock';
import { PinnedCard } from '../../dock/PinnedCard';
import { TranslateControl } from '../../layout/TranslateControl';
import { buildBacklinksMap, glossaryPinId } from '../../../engine/backlinks';
import { extractPdfPageBlocks } from '../../../engine/pdfParagraphs';
import { setLocale } from '../../../i18n/core';
import { buildStudyNotesMarkdown, exportStudyPackZip } from '../../../services/noteExporter';
import { readerTranslator } from '../../../services/translator';
import { usePaperTranslation } from '../../../services/usePaperTranslation';
import { stripPinnedItemForStorage } from '../../../storage/paperDb';
import { useReaderStore } from '../../../store/useReaderStore';
import type { GlossaryEntry } from '../../../types/paper';

vi.mock('../../../engine/pdfParagraphs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../engine/pdfParagraphs')>();
  return {
    ...actual,
    extractPdfPageBlocks: vi.fn(),
  };
});

afterEach(() => {
  useReaderStore.getState().resetPaper();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sampleEntry: GlossaryEntry = {
  term: 'MHA',
  expansion: 'Multi-Head Attention',
  contextSentence: 'We employ Multi-Head Attention (MHA) in each encoder layer.',
  definedPage: 2,
  definedRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
  kind: 'acronym',
};

const symbolEntry: GlossaryEntry = {
  term: 'd_k',
  expansion: 'dimension of keys',
  contextSentence: 'where d_k denotes the dimension of keys.',
  definedPage: 4,
  definedRect: { x: 0.12, y: 0.3, width: 0.2, height: 0.02 },
  kind: 'symbol',
};

describe('web glossary drawer, pinning, and one-click translation', () => {
  it('filters glossary terms, navigates mention backlinks, pins to dock, and exports cleanly', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setLocale('zh-CN');

    const backlinksMap = buildBacklinksMap(
      {},
      {
        5: [{ id: 'gm-1', term: 'MHA', pageNumber: 5, rect: { x: 0.2, y: 0.4, width: 0.05, height: 0.02 }, rawText: 'MHA' }],
        8: [{ id: 'gm-2', term: 'MHA', pageNumber: 8, rect: { x: 0.3, y: 0.6, width: 0.05, height: 0.02 }, rawText: 'MHA' }],
      },
    );
    expect(backlinksMap[glossaryPinId('MHA')]).toHaveLength(2);

    const onJumpBacklink = vi.fn();
    const onLocate = vi.fn();
    const onPinGlossary = vi.fn((entry: GlossaryEntry) => {
      useReaderStore.getState().pinGlossary(entry);
    });

    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(AssetDrawer, {
            open: true,
            section: 'glossary',
            assets: [],
            glossary: [sampleEntry, symbolEntry],
            references: [],
            backlinksMap,
            onJumpToBacklink: onJumpBacklink,
            pinnedIds: [],
            isParsing: false,
            parseProgress: 100,
            onClose: () => {},
            onPinAsset: () => {},
            onPinReference: () => {},
            onPinGlossary,
            onLocate,
          }),
        );
      });

      expect(container.textContent).toContain('Multi-Head Attention');
      expect(container.textContent).toContain('dimension of keys');

      // Filter to symbols only inside the Glossary asset tab
      const symbolBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('符号'));
      expect(symbolBtn).toBeDefined();
      await act(async () => symbolBtn!.click());
      expect(container.textContent).not.toContain('Multi-Head Attention');
      expect(container.textContent).toContain('dimension of keys');

      // Back to all sub-filter inside Glossary tab and pin MHA
      const subAllBtns = [...container.querySelectorAll('button')].filter((b) => b.textContent?.includes('全部'));
      await act(async () => subAllBtns[subAllBtns.length - 1]!.click());
      const pinBtn = container.querySelector<HTMLButtonElement>('button[title="钉住术语"]');
      expect(pinBtn).toBeTruthy();
      await act(async () => pinBtn!.click());

      const pinned = useReaderStore.getState().pinnedItems[0];
      expect(pinned).toMatchObject({
        id: 'term-MHA',
        kind: 'glossary',
        title: 'MHA',
        subtitle: 'Multi-Head Attention',
        textPreview: sampleEntry.contextSentence,
        pageNumber: 2,
      });

      // Persists textPreview and renders in PinnedCard
      const stored = stripPinnedItemForStorage(pinned);
      expect(stored.textPreview).toBe(sampleEntry.contextSentence);

      await act(async () => {
        root.render(
          createElement(PinnedCard, {
            item: pinned,
            backlinks: backlinksMap[pinned.id],
            onJumpToBacklink: onJumpBacklink,
            onUnpin: () => {},
            onToggleCollapse: () => {},
            onJump: onLocate,
            onExpandCrop: () => {},
            onOpenLightbox: () => {},
            onRename: () => {},
            onMove: () => {},
          }),
        );
      });
      expect(container.textContent).toContain('Multi-Head Attention');
      expect(container.textContent).toContain(sampleEntry.contextSentence);

      // Exports markdown & zip without trying to recrop glossary pins as images
      const md = buildStudyNotesMarkdown({
        fileName: 'Transformer.pdf',
        numPages: 12,
        currentPage: 2,
        pinnedItems: [pinned],
        backlinksMap,
        glossaryMap: { MHA: sampleEntry },
      });
      expect(md).toContain('| MHA | Multi-Head Attention | P.2 |');

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:notes') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      expect(
        await exportStudyPackZip(
          {
            fileName: 'Transformer.pdf',
            numPages: 12,
            currentPage: 2,
            pinnedItems: [pinned],
            backlinksMap,
            glossaryMap: { MHA: sampleEntry },
          },
          null,
        ),
      ).toBe(0);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('streams visible-page-first full-paper translation and switches modes cleanly', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setLocale('zh-CN');

    vi.mocked(extractPdfPageBlocks).mockImplementation(async (_doc, pageNumber) => [
      {
        id: `p${pageNumber}-1`,
        pageNumber,
        text: `Paragraph on page ${pageNumber}`,
        rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
        lineCount: 3,
        isHeading: false,
        isCaption: false,
      },
    ]);
    const translateSpy = vi
      .spyOn(readerTranslator, 'translateTexts')
      .mockImplementation(async (texts) => texts.map((txt) => `译:${txt}`));

    const fakeDoc = { numPages: 2 } as PDFDocumentProxy;
    let latestState: ReturnType<typeof usePaperTranslation> | undefined;

    function Harness() {
      const translation = usePaperTranslation(fakeDoc, 2, 2, new Set([2]));
      latestState = translation;
      return createElement(TranslateControl, { translation, numPages: 2 });
    }

    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(createElement(Harness)));
      expect(container.textContent).toContain('一键翻译');

      const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('一键翻译'))!;
      await act(async () => startBtn.click());

      // Wait for async page streaming to finish
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Current page (page 2) was prioritized before page 1!
      expect(vi.mocked(extractPdfPageBlocks).mock.calls.map((c) => c[1])).toEqual([2, 1]);
      expect(translateSpy).toHaveBeenCalledTimes(2);
      expect(latestState?.displayMode).toBe('translated');
      expect(latestState?.doneCount).toBe(2);
      expect(latestState?.blocksByPage[2]?.[0]?.translated).toBe('译:Paragraph on page 2');

      // Switch to bilingual mode
      const bilingualBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '双语')!;
      await act(async () => bilingualBtn.click());
      expect(latestState?.displayMode).toBe('bilingual');

      // Switch back to original
      const origBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '原文')!;
      await act(async () => origBtn.click());
      expect(latestState?.displayMode).toBe('off');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('collapses and expands PinDock and auto-reopens when pinning a new item', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setLocale('zh-CN');
    useReaderStore.getState().pinGlossary(sampleEntry);

    function DockHarness() {
      const items = useReaderStore((s) => s.pinnedItems);
      const dockCollapsed = useReaderStore((s) => s.dockCollapsed);
      return createElement(PinDock, {
        currentPage: 1,
        citations: [],
        assetsMap: {},
        onPreviewAsset: () => {},
        onPinAsset: () => {},
        items,
        backlinksMap: {},
        onJumpToBacklink: () => {},
        position: 'right',
        width: 388,
        height: 264,
        dockCollapsed,
        onDockCollapsedChange: (next) => useReaderStore.getState().setDockCollapsed(next),
        onPositionChange: () => {},
        onWidthChange: () => {},
        onHeightChange: () => {},
        onUnpin: () => {},
        onToggleCollapse: () => {},
        onJump: () => {},
        onExpandCrop: () => {},
        onOpenLightbox: () => {},
        onRename: () => {},
        onMove: () => {},
        onClear: () => {},
      });
    }

    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(createElement(DockHarness)));
      expect(container.textContent).toContain('Multi-Head Attention');

      const collapseBtn = container.querySelector<HTMLButtonElement>('button[aria-label="收起钉板（快捷键 ]）"]');
      expect(collapseBtn).toBeTruthy();
      await act(async () => collapseBtn!.click());

      expect(useReaderStore.getState().dockCollapsed).toBe(true);
      expect(container.textContent).not.toContain('Multi-Head Attention');

      const expandBtn = container.querySelector<HTMLButtonElement>('button[aria-label="展开对照钉板（快捷键 ]）"]');
      expect(expandBtn).toBeTruthy();
      await act(async () => expandBtn!.click());
      expect(useReaderStore.getState().dockCollapsed).toBe(false);
      expect(container.textContent).toContain('Multi-Head Attention');

      // Auto-reopens when collapsed and a new term is pinned
      await act(async () => useReaderStore.getState().setDockCollapsed(true));
      expect(useReaderStore.getState().dockCollapsed).toBe(true);
      await act(async () => useReaderStore.getState().pinGlossary(symbolEntry));
      expect(useReaderStore.getState().dockCollapsed).toBe(false);
      expect(container.textContent).toContain('dimension of keys');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
