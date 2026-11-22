import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReaderStore } from '../useReaderStore';

const store = useReaderStore.getState;
const place = (n: number) => ({ pageNumber: n, scrollTop: n * 800, scrollLeft: n * 10,
  highlightRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 }, label: 'Section ' + n });
beforeEach(() => store().resetPaper());

describe('jump history', () => {
  it('restores the exact origin and target of each jump even after intervening manual scrolling', () => {
    store().recordJump(place(1), place(4));
    const scrolled = { ...place(4), scrollTop: 4050 };
    store().recordJump(scrolled, place(8));
    expect(store().navigateHistory('back')).toEqual(scrolled);
    expect(store().navigateHistory('back')).toEqual(place(1));
    expect(store().navigateHistory('back')).toBeUndefined();
    expect(store().navigateHistory('forward')).toEqual(place(4));
    expect(store().navigateHistory('forward')).toEqual(place(8));
    expect(store().navigateHistory('forward')).toBeUndefined();
  });

  it('cuts a forward branch, caps history at 20 jumps, and resets on close', () => {
    for (let n = 1; n <= 24; n++) store().recordJump(place(n), place(n + 1));
    expect(store().jumpHistory).toHaveLength(20);
    expect(store().jumpHistory[0].origin).toEqual(place(5));
    store().navigateHistory('back');
    store().recordJump(place(24), place(3));
    expect(store().navigateHistory('forward')).toBeUndefined();
    store().dismissHistory();
    expect(store().historyVisible).toBe(false);
    expect(store().navigateHistory('back')).toEqual(place(24));
    expect(store().historyVisible).toBe(true);
    store().resetPaper();
    expect(store().jumpHistory).toEqual([]);
    expect(store().historyCursor).toBe(0);
  });
});

it('retains theme and ruler preferences across a document reset and store reload', async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  } });
  try {
    vi.resetModules();
    const first = (await import('../useReaderStore')).useReaderStore;
    expect(first.getState()).toMatchObject({ theme: 'light', readingRulerEnabled: false });
    first.getState().setTheme('sepia');
    first.getState().setReadingRulerEnabled(true);
    first.getState().resetPaper();
    expect(saved.get('refpin.theme.v1')).toBe('sepia');
    expect(document.documentElement.dataset.theme).toBe('sepia');
    vi.resetModules();
    const reopened = (await import('../useReaderStore')).useReaderStore;
    expect(reopened.getState()).toMatchObject({ theme: 'sepia', readingRulerEnabled: true });
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
