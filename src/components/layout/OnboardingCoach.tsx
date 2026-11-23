import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { useOnboarding, type CoachRun } from '../../store/onboarding';
import { useReaderStore } from '../../store/useReaderStore';

const progress = { hover: 1, pin: 2, jump: 3, return: 3 };
const GAP = 10;

export function OnboardingCoach({ run, dockWindow }: { run: CoachRun; dockWindow: Window | null }) {
  const { t } = useI18n();
  const alreadyPinned = useReaderStore(state => state.pinnedItems.some(item => item.id === run.assetId));
  const bubbleRef = useRef<HTMLDivElement>(null);
  const host = run.step === 'jump' && dockWindow ? dockWindow : window;
  const doc = host.document;

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const selector = {
      hover: `[data-coach-citation="${CSS.escape(run.citation.id)}"]`,
      pin: `[data-coach-pin="${CSS.escape(run.assetId)}"]`,
      jump: `[data-coach-title="${CSS.escape(run.assetId)}"]`,
      return: '[data-coach-back]',
    }[run.step];
    let anchor: HTMLElement | null = null;
    let revealed = false;
    let frame = 0;
    let soughtPage = false;
    const update = () => {
      frame = 0;
      if (!anchor?.isConnected) {
        if (anchor) sizes.unobserve(anchor);
        anchor = doc.querySelector<HTMLElement>(selector);
        if (anchor) {
          sizes.observe(anchor);
          anchor.dataset.coachTarget = '';
        }
      }
      if (!anchor) {
        bubble.style.visibility = 'hidden';
        // 虚拟化的页先进入视口，引用按钮才会挂载。
        if (run.step === 'hover' && !soughtPage) {
          const page = doc.querySelector(`[data-page="${run.citation.pageNumber}"]`);
          if (page) {
            soughtPage = true;
            page.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
        return;
      }
      if (!revealed) {
        revealed = true;
        anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const rect = anchor.getBoundingClientRect();
      const viewport = anchor.closest('[data-pdf-viewer]')?.getBoundingClientRect();
      if (rect.bottom <= (viewport?.top ?? 0) || rect.top >= (viewport?.bottom ?? host.innerHeight) ||
          rect.right <= (viewport?.left ?? 0) || rect.left >= (viewport?.right ?? host.innerWidth)) {
        bubble.style.visibility = 'hidden';
        return;
      }
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const center = rect.left + rect.width / 2;
      const left = Math.max(GAP, Math.min(center - width / 2, host.innerWidth - width - GAP));
      const below = rect.bottom + height + 2 * GAP <= host.innerHeight || rect.top < height + 2 * GAP;
      bubble.style.left = left + 'px';
      bubble.style.top = (below ? rect.bottom + GAP : rect.top - height - GAP) + 'px';
      bubble.style.setProperty('--coach-pointer', Math.max(9, Math.min(center - left, width - 9)) + 'px');
      bubble.dataset.side = below ? 'below' : 'above';
      bubble.style.visibility = 'visible';
    };
    const schedule = () => { if (!frame) frame = host.requestAnimationFrame(update); };
    const sizes = new ResizeObserver(schedule);
    sizes.observe(bubble);
    // 仅跟踪锚点挂载和布局变化，步骤推进由阅读器动作驱动。
    const layout = new MutationObserver(changes => {
      if (changes.some(change => !bubble.contains(change.target))) schedule();
    });
    layout.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    doc.addEventListener('scroll', schedule, true);
    doc.addEventListener('animationend', schedule, true);
    host.addEventListener('resize', schedule);
    update();
    return () => {
      if (anchor) delete anchor.dataset.coachTarget;
      host.cancelAnimationFrame(frame);
      sizes.disconnect();
      layout.disconnect();
      doc.removeEventListener('scroll', schedule, true);
      doc.removeEventListener('animationend', schedule, true);
      host.removeEventListener('resize', schedule);
    };
  }, [run, host, doc]);

  return createPortal(
    <div ref={bubbleRef} data-coach-bubble="" style={{ visibility: 'hidden' }}
      className="pointer-events-none fixed z-[65] w-max max-w-[min(16rem,calc(100vw-20px))] rounded-lg border border-paper-border bg-paper-card px-3 py-2 text-xs text-paper-ink shadow-paper">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-paper-gold" />
        <span className="font-mono text-paper-muted">{t('coach.progress', { step: progress[run.step] })}</span>
        <button type="button" onClick={() => useOnboarding.getState().send({ type: 'skip' })}
          className="pointer-events-auto ml-auto rounded px-1 py-0.5 text-paper-muted hover:bg-paper-bg hover:text-paper-ink">
          {t('coach.skip')}
        </button>
      </div>
      <p aria-live="polite" className="mt-1 leading-relaxed">
        {t(run.step === 'pin' && alreadyPinned ? 'coach.repin' : `coach.${run.step}`)}
      </p>
    </div>,
    doc.body,
  );
}
