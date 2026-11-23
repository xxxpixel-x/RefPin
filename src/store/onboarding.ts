import { create } from 'zustand';
import { findAssetForCitation } from '../engine/backlinks';
import type { InlineCitation, JumpPosition, PaperAsset, PinnedItem, SamplePaperMeta } from '../types/paper';

export const ONBOARDING_KEY = 'refpin.onboarding.v1';

type Target = { citation: InlineCitation; assetId: string };
export type CoachRun = Target & (
  | { step: 'hover' | 'pin' | 'jump' }
  | { step: 'return'; origin: JumpPosition }
);
type CoachEvent =
  | { type: 'preview'; citationId?: string }
  | { type: 'pinned'; assetId: string }
  | { type: 'jumped'; titleId?: string; origin: JumpPosition }
  | { type: 'returned'; position: JumpPosition }
  | { type: 'dismissReturn' }
  | { type: 'skip' };

type Paper = {
  citationsByPage: Record<number, InlineCitation[]>;
  assetsMap: Record<string, PaperAsset>;
  pinnedItems: PinnedItem[];
};

function chooseTarget(paper: Paper, demoPage: number): Target | undefined {
  const pages = Object.keys(paper.citationsByPage).map(Number)
    .sort((a, b) => Math.abs(a - demoPage) - Math.abs(b - demoPage));
  const pinned = new Set(paper.pinnedItems.map(item => item.id));
  let existing: Target | undefined;
  for (const page of pages) {
    for (const citation of paper.citationsByPage[page]) {
      if (citation.kind !== 'figure' && citation.kind !== 'table') continue;
      const asset = findAssetForCitation(citation, paper.assetsMap);
      if (!asset?.imageUrl) continue;
      const target = { citation, assetId: asset.key };
      if (!pinned.has(asset.key)) return target;
      existing ??= target;
    }
  }
  return existing;
}

interface CoachState {
  run: CoachRun | null;
  start: (sample: SamplePaperMeta | undefined, paper: Paper, replay?: boolean) => void;
  send: (event: CoachEvent) => void;
  close: () => void;
}

export const useOnboarding = create<CoachState>((set, get) => {
  let sessionResult: string | null = null;
  function finish(result: 'completed' | 'skipped') {
    sessionResult = result;
    try { localStorage.setItem(ONBOARDING_KEY, result); } catch { /* 仅在本次会话记住选择。 */ }
    set({ run: null });
  }
  return {
    run: null,
    close: () => set({ run: null }),
    start: (sample, paper, replay = false) => {
      let saved = sessionResult;
      try { saved = localStorage.getItem(ONBOARDING_KEY); } catch { /* 使用会话记录。 */ }
      const target = sample && (replay || !saved) && chooseTarget(paper, sample.demoStartPage);
      set({ run: target ? { ...target, step: 'hover' } : null });
    },
    send: event => {
      const run = get().run;
      if (!run) return;
      switch (event.type) {
        case 'skip': return finish('skipped');
        case 'preview': {
          if (run.step !== 'hover' && run.step !== 'pin') return;
          const step = run.citation.id === event.citationId ? 'pin' : 'hover';
          if (step !== run.step) set({ run: { ...run, step } });
          return;
        }
        case 'pinned':
          if (run.step === 'pin' && run.assetId === event.assetId) set({ run: { ...run, step: 'jump' } });
          return;
        case 'jumped':
          if (run.step !== 'jump' && run.step !== 'return') return;
          if (run.assetId === event.titleId) set({ run: { ...run, step: 'return', origin: event.origin } });
          else if (run.step === 'return') set({ run: { ...run, step: 'jump' } });
          return;
        case 'dismissReturn':
          if (run.step === 'return') set({ run: { ...run, step: 'jump' } });
          return;
        case 'returned':
          if (run.step === 'return' && event.position === run.origin) finish('completed');
      }
    },
  };
});
