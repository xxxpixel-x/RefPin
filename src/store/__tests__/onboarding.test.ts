// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { InlineCitation, PaperAsset, PinnedItem } from '../../types/paper';
import { ONBOARDING_KEY, useOnboarding } from '../onboarding';

const sample = { id: 'sample', title: 'Sample', url: '/samples/demo.pdf', demoStartPage: 4, subtitle: '', badge: '' };
const rect = { x: 0.1, y: 0.3, width: 0.2, height: 0.02 };
const citation: InlineCitation = { id: 'cite-4', kind: 'figure', pageNumber: 4, rawText: 'Fig. 2', lineY: 0.3, rect, targetKeys: ['fig-2'] };
const asset: PaperAsset = { key: 'fig-2', kind: 'figure', pageNumber: 2, label: 'Figure 2', caption: '', cropRect: rect, imageUrl: 'figure.png' };
const paper = { assetsMap: { 'fig-2': asset }, citationsByPage: { 4: [citation] }, pinnedItems: [] };
const origin = { pageNumber: 4, scrollTop: 123, scrollLeft: 8 };
const { start, send, close } = useOnboarding.getState();
const step = () => useOnboarding.getState().run?.step;

beforeEach(() => { close(); localStorage.clear(); });

describe('示例论文新手引导', () => {
  it('只在示例入口启动，并要求引用能预览可钉住的图表', () => {
    start(undefined, paper);
    expect(step()).toBeUndefined();
    start(sample, { ...paper, assetsMap: {} });
    expect(step()).toBeUndefined();
    start(sample, paper);
    expect(step()).toBe('hover');
    close();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull();
  });

  it('按目标和顺序推进，只有返回本次标题跳转的来源才完成', () => {
    start(sample, paper);
    send({ type: 'preview', citationId: 'another' });
    send({ type: 'pinned', assetId: asset.key });
    expect(step()).toBe('hover');
    send({ type: 'preview', citationId: citation.id });
    send({ type: 'pinned', assetId: 'another' });
    expect(step()).toBe('pin');
    send({ type: 'preview' });
    expect(step()).toBe('hover');
    send({ type: 'preview', citationId: citation.id });
    send({ type: 'pinned', assetId: asset.key });
    send({ type: 'jumped', titleId: 'another', origin });
    send({ type: 'returned', position: origin });
    expect(step()).toBe('jump');
    send({ type: 'jumped', titleId: asset.key, origin });
    send({ type: 'returned', position: { ...origin } });
    expect(step()).toBe('return');
    send({ type: 'dismissReturn' });
    expect(step()).toBe('jump');
    send({ type: 'jumped', titleId: asset.key, origin });
    send({ type: 'returned', position: origin });
    expect(step()).toBeUndefined();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('completed');
    start(sample, paper);
    expect(step()).toBeUndefined();
    start(sample, paper, true);
    expect(step()).toBe('hover');
  });

  it('中途跳过后跨次打开保持关闭，设置可重播', () => {
    start(sample, paper);
    send({ type: 'preview', citationId: citation.id });
    send({ type: 'skip' });
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('skipped');
    start(sample, paper);
    expect(step()).toBeUndefined();
    start(sample, paper, true);
    expect(step()).toBe('hover');
    close();
    start(sample, paper);
    expect(step()).toBeUndefined();
  });

  it('重播优先选择尚未固定的图表，全部固定时仍可开始', () => {
    const pin: PinnedItem = { id: asset.key, kind: 'figure', title: 'Figure 2', pageNumber: 2, createdAt: 1 };
    const other = { ...citation, id: 'cite-1', pageNumber: 1, targetKeys: ['fig-1'] };
    start(sample, {
      citationsByPage: { 1: [other], 4: [citation] },
      assetsMap: { ...paper.assetsMap, 'fig-1': { ...asset, key: 'fig-1' } }, pinnedItems: [pin],
    }, true);
    expect(useOnboarding.getState().run?.citation).toBe(other);
    start(sample, { ...paper, pinnedItems: [pin] }, true);
    expect(useOnboarding.getState().run?.citation).toBe(citation);
  });
});
