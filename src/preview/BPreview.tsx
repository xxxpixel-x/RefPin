import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  MOCK_ASSETS,
  MOCK_CITATIONS,
  MOCK_PARAGRAPH_LINES,
  MOCK_PINNED,
  MOCK_REFERENCES,
} from '../mocks/mockPaperData';
import { LandingView } from '../components/landing/LandingView';
import { TopBar } from '../components/layout/TopBar';
import { ReturnBanner } from '../components/layout/ReturnBanner';
import { HoverPeekCard, type PeekTrigger } from '../components/peek/HoverPeekCard';
import { PinDock } from '../components/dock/PinDock';
import { LightboxModal } from '../components/dock/LightboxModal';
import { AssetDrawer } from '../components/drawer/AssetDrawer';
import { SAMPLES } from '../config/samples';
import type {
  DockPosition,
  InlineCitation,
  JumpAnchor,
  PaperAsset,
  PinnedItem,
  ReferenceEntry,
} from '../types/paper';

/** B 线独立预览壳：不依赖 A 的 pdf.js，纯 Mock 数据跑通全部 UI */
export function BPreview() {
  const [view, setView] = useState<'landing' | 'reader'>('landing');
  const [fileName, setFileName] = useState('Attention Is All You Need.pdf');
  const [currentPage, setCurrentPage] = useState(4);
  const [scale, setScale] = useState(1.25);
  const [snipMode, setSnipMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>(MOCK_PINNED);
  const [dockPosition, setDockPosition] = useState<DockPosition>('right');
  const [dockWidth, setDockWidth] = useState(388);
  const [dockHeight, setDockHeight] = useState(264);
  const [jumpAnchor, setJumpAnchor] = useState<JumpAnchor>(null);
  const [hoverTrigger, setHoverTrigger] = useState<PeekTrigger | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<PaperAsset | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const workspaceRef = useRef<HTMLDivElement>(null);

  const assetsMap = useMemo(
    () => Object.fromEntries(MOCK_ASSETS.map((asset) => [asset.key, asset])),
    [],
  );
  const referencesMap = useMemo(
    () => Object.fromEntries(MOCK_REFERENCES.map((reference) => [reference.key, reference])),
    [],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const pinAsset = useCallback(
    (asset: PaperAsset) => {
      setPinnedItems((items) => {
        if (items.some((item) => item.id === asset.key)) {
          showToast('已经在钉板上了');
          return items;
        }
        return [
          {
            id: asset.key,
            kind: asset.kind,
            title: asset.label,
            subtitle: asset.caption,
            pageNumber: asset.pageNumber,
            imageUrl: asset.imageUrl,
            cropRect: asset.cropRect,
            originalCropRect: asset.cropRect,
            originalImageUrl: asset.imageUrl,
            createdAt: Date.now(),
          },
          ...items,
        ];
      });
      showToast('已钉到对照钉板');
    },
    [showToast],
  );

  const pinReference = useCallback(
    (reference: ReferenceEntry) => {
      setPinnedItems((items) => {
        if (items.some((item) => item.id === reference.key)) {
          showToast('这篇文献已在钉板上');
          return items;
        }
        return [
          {
            id: reference.key,
            kind: 'reference',
            title: reference.title || `参考文献 [${reference.index}]`,
            subtitle: reference.authors,
            pageNumber: reference.pageNumber,
            reference,
            createdAt: Date.now(),
          },
          ...items,
        ];
      });
      showToast('已钉住文献');
    },
    [showToast],
  );

  const jumpTo = useCallback(
    (pageNumber: number, _rect?: InlineCitation['rect']) => {
      setJumpAnchor({
        fromPage: currentPage,
        fromScrollTop: 0,
        label: `回到第 ${currentPage} 页刚才读的位置`,
      });
      setCurrentPage(pageNumber);
      setHoverTrigger(null);
    },
    [currentPage],
  );

  const handlePeek = useCallback((_citation: InlineCitation) => {}, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxAsset(null);
        setSnipMode(false);
        setHoverTrigger(null);
        return;
      }
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 's' || event.key === 'S') {
        setSnipMode((value) => !value);
      }
      if (event.key === '[') {
        setDrawerOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (view === 'landing') {
    return (
      <div className="min-h-full bg-paper-bg">
        <LandingView
          samples={SAMPLES}
          onOpenFile={(file) => {
            setFileName(file.name);
            setView('reader');
            setCurrentPage(4);
          }}
          onSelectSample={(sample) => {
            setFileName(`${sample.title}.pdf`);
            setCurrentPage(sample.demoStartPage);
            setView('reader');
          }}
        />
      </div>
    );
  }

  const pageCitations = MOCK_CITATIONS[currentPage] ?? [];
  const pinnedIds = pinnedItems.map((item) => item.id);

  return (
    <div className="flex h-full flex-col bg-paper-bg">
      <TopBar
        fileName={fileName}
        numPages={14}
        currentPage={currentPage}
        scale={scale}
        snipMode={snipMode}
        isParsing={false}
        parseProgress={100}
        assetCount={MOCK_ASSETS.length}
        onJumpPage={setCurrentPage}
        onZoom={(value) => setScale(Math.min(2.5, Math.max(0.6, value)))}
        onToggleSnip={() => setSnipMode((value) => !value)}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
        onReset={() => setView('landing')}
        onOpenFile={(file) => setFileName(file.name)}
      />

      <div
        ref={workspaceRef}
        className={clsx(
          'relative flex min-h-0 flex-1 overflow-hidden',
          dockPosition === 'top' || dockPosition === 'bottom' ? 'flex-col' : 'flex-row',
        )}
      >
        <AssetDrawer
          open={drawerOpen}
          assets={MOCK_ASSETS}
          references={MOCK_REFERENCES}
          pinnedIds={pinnedIds}
          isParsing={false}
          parseProgress={100}
          onClose={() => setDrawerOpen(false)}
          onPinAsset={pinAsset}
          onPinReference={pinReference}
          onLocate={(pageNumber, asset) => jumpTo(pageNumber, asset?.cropRect)}
        />

        <main
          className={`relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden py-6 pr-6 transition-[padding-left] duration-200 ${
            drawerOpen ? 'pl-[304px]' : 'pl-6'
          }`}
        >
          <ReturnBanner
            anchor={jumpAnchor}
            onReturn={(anchor) => {
              setCurrentPage(anchor.fromPage);
              setJumpAnchor(null);
            }}
            onDismiss={() => setJumpAnchor(null)}
          />

          <div
            className="mx-auto origin-top bg-white shadow-paper"
            style={{
              width: 'min(760px, 100%)',
              minHeight: 900,
              transform: `scale(${scale / 1.25})`,
              padding: '64px 72px',
            }}
          >
            <p className="mb-4 text-center text-[11px] uppercase tracking-[0.18em] text-paper-muted">
              Attention Is All You Need · Page {currentPage}（Mock 预览）
            </p>
            <h2 className="mb-6 text-center text-[19px] font-semibold text-paper-ink">
              3. Model Architecture
            </h2>

            <div className="relative">
              {MOCK_PARAGRAPH_LINES.map((line, index) => (
                <p
                  key={line}
                  className="text-[13px] leading-[30px] text-stone-700"
                  style={{ fontFamily: 'Georgia, Songti SC, serif' }}
                >
                  {line}
                </p>
              ))}
              {pageCitations.map((citation) => (
                <button
                  key={citation.id}
                  type="button"
                  onMouseEnter={(event) => setHoverTrigger({ citation, anchorEl: event.currentTarget })}
                  onMouseLeave={() => setHoverTrigger(null)}
                  onClick={() => jumpTo(citation.pageNumber)}
                  style={{
                    left: `${citation.rect.x * 100}%`,
                    top: `${citation.rect.y * 100}%`,
                    width: `${Math.max(citation.rect.width * 100, 5)}%`,
                    height: 22,
                  }}
                  className="absolute -translate-y-1/2 rounded-sm border-b border-dashed border-paper-gold bg-paper-gold/10 px-0.5 text-left text-[12px] font-medium text-paper-goldtext transition hover:bg-paper-gold/25"
                  title={`悬停预览 ${citation.rawText}`}
                >
                  {citation.rawText}
                </button>
              ))}
            </div>

            {pageCitations.length === 0 && (
              <p className="mt-8 rounded-lg border border-dashed border-paper-border bg-paper-bg px-4 py-6 text-center text-[11px] text-paper-muted">
                这一页没有 Mock 引用热区，回到第 4 / 5 页体验悬停预览。
              </p>
            )}
          </div>
        </main>

        <PinDock
          items={pinnedItems}
          position={dockPosition}
          width={dockWidth}
          height={dockHeight}
          workspaceRef={workspaceRef}
          onPositionChange={setDockPosition}
          onWidthChange={setDockWidth}
          onHeightChange={setDockHeight}
          onUnpin={(id) => setPinnedItems((items) => items.filter((item) => item.id !== id))}
          onToggleCollapse={(id) =>
            setPinnedItems((items) =>
              items.map((item) =>
                item.id === id ? { ...item, collapsed: !item.collapsed } : item,
              ),
            )
          }
          onJump={jumpTo}
          onExpandCrop={(id, direction) => {
            setPinnedItems((items) =>
              items.map((item) => {
                if (item.id !== id || !item.cropRect) return item;
                const delta = 0.06;
                const y = direction === 'up' ? Math.max(0, item.cropRect.y - delta) : item.cropRect.y;
                const height =
                  direction === 'up'
                    ? Math.min(1 - y, item.cropRect.height + delta)
                    : Math.min(1 - item.cropRect.y, item.cropRect.height + delta);
                return {
                  ...item,
                  originalCropRect: item.originalCropRect ?? item.cropRect,
                  originalImageUrl: item.originalImageUrl ?? item.imageUrl,
                  cropRect: { ...item.cropRect, y, height },
                };
              }),
            );
            showToast(direction === 'up' ? '已向上扩展裁切范围' : '已向下扩展裁切范围');
          }}
          onResetCrop={(id) => {
            setPinnedItems((items) =>
              items.map((item) =>
                item.id === id && item.originalCropRect
                  ? {
                      ...item,
                      cropRect: item.originalCropRect,
                      imageUrl: item.originalImageUrl ?? item.imageUrl,
                    }
                  : item,
              ),
            );
            showToast('已还原初始裁切范围');
          }}
          onOpenLightbox={(item) =>
            setLightboxAsset({
              key: item.id,
              kind: item.kind === 'snip' || item.kind === 'reference' ? 'figure' : item.kind,
              label: item.title,
              caption: item.subtitle ?? '',
              pageNumber: item.pageNumber,
              cropRect: item.cropRect ?? { x: 0, y: 0, width: 1, height: 1 },
              imageUrl: item.imageUrl,
            })
          }
          onRename={(id, title) =>
            setPinnedItems((items) =>
              items.map((item) => (item.id === id ? { ...item, title } : item)),
            )
          }
          onClear={() => setPinnedItems([])}
        />
      </div>

      <HoverPeekCard
        trigger={hoverTrigger}
        assetsMap={assetsMap}
        referencesMap={referencesMap}
        onPinAsset={pinAsset}
        onPinReference={pinReference}
        onJump={jumpTo}
        onOpenLightbox={setLightboxAsset}
        onPeek={handlePeek}
      />

      <LightboxModal asset={lightboxAsset} onClose={() => setLightboxAsset(null)} />

      {snipMode && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex justify-center">
          <span className="rounded-full bg-paper-ink px-4 py-1.5 text-[11px] text-white shadow-float">
            框选模式已开启（Mock 预览仅演示顶部按钮状态）· 按 Esc 退出
          </span>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-paper-ink px-4 py-2 text-[11px] text-white shadow-float">
          {toast}
        </div>
      )}
    </div>
  );
}
