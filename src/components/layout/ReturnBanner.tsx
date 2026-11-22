import { t } from '../../i18n/core';
import { CornerUpLeft, X } from 'lucide-react';
import type { JumpAnchor } from '../../types/paper';

interface ReturnBannerProps {
  anchor: JumpAnchor | null;
  onReturn: (anchor: NonNullable<JumpAnchor>) => void;
  onDismiss: () => void;
}

export function ReturnBanner({ anchor, onReturn, onDismiss }: ReturnBannerProps) {
  if (!anchor) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
      <div className="animate-fade-in-up pointer-events-auto flex items-center gap-1 rounded-full border border-paper-border bg-paper-ink px-1 py-1 pl-3 text-xs text-white shadow-float">
        <button
          type="button"
          onClick={() => onReturn(anchor)}
          className="flex items-center gap-1.5 pr-1 transition hover:text-paper-goldsoft"
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
          {t('reader.returnToPage', { page: anchor.fromPage })}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={t('reader.dismissReturn')}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
