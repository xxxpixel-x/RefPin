import { useState } from 'react';
import type { CitationBacklink, NormalizedRect } from '../types/paper';

interface BacklinkStripProps {
  backlinks?: CitationBacklink[];
  onJumpToBacklink: (pageNumber: number, rect: NormalizedRect) => void;
}

const VISIBLE_COUNT = 4;

export function BacklinkStrip({ backlinks = [], onJumpToBacklink }: BacklinkStripProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? backlinks : backlinks.slice(0, VISIBLE_COUNT);
  const more = backlinks.length - VISIBLE_COUNT;

  return (
    <div className="flex max-h-24 w-full shrink-0 flex-wrap items-center gap-1 overflow-y-auto border-t border-paper-border pt-1.5 text-[10px] text-paper-muted">
      <span className="mr-0.5">正文引用 {backlinks.length} 次</span>
      {visible.map((link, index) => {
        const label = `第 ${index + 1} 处引用，P.${link.pageNumber}，${link.rawText}`;
        return (
          <button
            type="button"
            key={link.citationId}
            title={label}
            aria-label={label}
            className="rounded-full border border-paper-border bg-white px-1.5 py-0.5 font-mono leading-none hover:border-paper-gold hover:text-paper-gold focus-visible:outline-paper-gold"
            onClick={() => onJumpToBacklink(link.pageNumber, link.rect)}
          >
            P.{link.pageNumber}
          </button>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? '收起正文引用' : `展开其余 ${more} 处引用`}
          className="rounded px-1 font-medium hover:text-paper-gold focus-visible:outline-paper-gold"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : `+${more}`}
        </button>
      )}
    </div>
  );
}
