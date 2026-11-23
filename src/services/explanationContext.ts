import { groupParagraphBlocks, type PdfParagraphBlock } from '../engine/pdfParagraphs';
import type { CompactTextLine } from '../engine/pageLinesCache';
import { rectIoU } from '../engine/utils';
import type { CitationBacklink, GlossaryEntry, HighlightSelection, NormalizedRect, PaperAsset } from '../types/paper';
import type { TranslateTargetLang } from './translator';

import { MAX_CONTEXT_LENGTH } from './explainer';
const EXCERPT_LENGTH = 1100;

export type ExplanationTarget =
  | { asset: Pick<PaperAsset, 'key' | 'label' | 'caption' | 'pageNumber'>; rect?: NormalizedRect }
  | { selection: HighlightSelection[] };

export interface EvidenceLocation { pageNumber: number; rect?: NormalizedRect }
export interface ExplanationContext { text: string; sources: EvidenceLocation[] }

export function explanationCacheKey(paperHash: string, target: ExplanationTarget, lang: TranslateTargetLang) {
  // 归一化位置可区分不同页、不同栏的同文选区，同时消除缩放造成的亚像素误差。
  const key = 'asset' in target ? target.asset.key : target.selection.map(({ pageNumber, text, rects }) =>
    [pageNumber, text, rects[0]?.x.toFixed(3), rects[0]?.y.toFixed(3)]);
  return JSON.stringify([paperHash, key, lang]);
}

function blockAt(blocks: PdfParagraphBlock[], rect?: NormalizedRect) {
  if (!rect) return;
  let best: PdfParagraphBlock | undefined;
  let score = 0;
  for (const block of blocks) {
    const overlap = rectIoU(block.rect, rect);
    if (overlap > score) { best = block; score = overlap; }
  }
  return best;
}

function excerpt(text: string, limit: number, focus = '') {
  const clean = text.trim();
  if (clean.length <= limit) return clean;
  const index = focus ? clean.indexOf(focus) : 0;
  const start = Math.max(0, Math.min(clean.length - limit + 2, index - Math.floor(limit / 3)));
  return (start ? '…' : '') + clean.slice(start, start + limit - (start ? 2 : 1)).trimEnd() + '…';
}

function mentionsTerm(text: string, term: string) {
  if (!term || !text.includes(term)) return false;
  const insideWord = (ch = '') => /[\p{L}\p{M}\p{N}_]/u.test(ch) && !/\p{Script=Han}/u.test(ch);
  let pos = text.indexOf(term);
  while (pos >= 0) {
    if (!insideWord(text[pos - 1]) && !insideWord(text[pos + term.length])) return true;
    pos = text.indexOf(term, pos + term.length);
  }
  return false;
}

export function buildExplanationContext(
  target: ExplanationTarget,
  lines: Record<number, CompactTextLine[]>,
  backlinks: Record<string, CitationBacklink[]>,
  glossary: Record<string, GlossaryEntry>,
): ExplanationContext {
  const pages = new Map<number, PdfParagraphBlock[]>();
  const blocks = (page: number) => {
    if (!pages.has(page)) pages.set(page, groupParagraphBlocks(lines[page] ?? [], page, 'explain', true));
    return pages.get(page)!;
  };
  const sources = new Map<number, EvidenceLocation>();
  let text = '';
  const excerpts: string[] = [];
  const add = (label: string, value: string, location: EvidenceLocation, focus = '', limit = EXCERPT_LENGTH) => {
    const prefix = (text ? '\n\n' : '') + label + ' (p. ' + location.pageNumber + ')\n';
    const room = Math.min(limit, MAX_CONTEXT_LENGTH - text.length - prefix.length);
    if (room < 16 || !value.trim()) return;
    const passage = excerpt(value, room, focus);
    text += prefix + passage;
    excerpts.push(passage);
    if (!sources.has(location.pageNumber)) sources.set(location.pageNumber, { pageNumber: location.pageNumber, rect: location.rect });
  };

  if ('asset' in target) {
    const { asset } = target;
    add('Target', asset.caption.includes(asset.label) ? asset.caption : (asset.label + ' ' + asset.caption),
      { pageNumber: asset.pageNumber, rect: target.rect });
    const seen = new Set<string>();
    for (const link of backlinks[asset.key] ?? []) {
      const block = blockAt(blocks(link.pageNumber), link.rect);
      if (!block || seen.has(block.id)) continue;
      if (link.pageNumber === asset.pageNumber && asset.caption &&
          (block.text.startsWith(asset.caption) || asset.caption.startsWith(block.text))) continue;
      seen.add(block.id);
      add('Discussion', block.text, link, link.rawText);
      // 同一页既有图注又有讨论时，页码优先定位到第一处正文讨论。
      if (sources.get(link.pageNumber)?.rect === target.rect) sources.set(link.pageNumber, link);
      if (seen.size === 3) break;
    }
  } else {
    const parts = target.selection;
    const first = parts[0], last = parts[parts.length - 1];
    if (!first || !last) return { text: '', sources: [] };
    for (const part of parts) {
      add('Selected text', part.text, { pageNumber: part.pageNumber, rect: part.rects[0] });
      if (text.length >= MAX_CONTEXT_LENGTH - 48) break;
    }
    const start = blockAt(blocks(first.pageNumber), first.rects[0]);
    const end = blockAt(blocks(last.pageNumber), last.rects[last.rects.length - 1]);
    const nearby = (block: PdfParagraphBlock | undefined, step: -1 | 1) => {
      if (!block) return;
      const page = blocks(block.pageNumber);
      const adjacent = page[page.indexOf(block) + step] ??
        (step === -1 ? blocks(block.pageNumber - 1).slice(-1)[0] : blocks(block.pageNumber + 1)[0]);
      if (adjacent) add(step === -1 ? 'Previous paragraph' : 'Next paragraph', adjacent.text, adjacent);
    };
    if (start && !first.text.includes(start.text)) add('Containing paragraph', start.text, start, first.text.slice(0, 60));
    nearby(start, -1);
    nearby(end, 1);
  }
  const passages = excerpts.join('\n');
  for (const entry of Object.values(glossary)) {
    if (text.length >= MAX_CONTEXT_LENGTH - 48) break;
    if (mentionsTerm(passages, entry.term)) add('Definition', entry.term + ' = ' + entry.expansion,
      { pageNumber: entry.definedPage, rect: entry.definedRect }, '', 240);
  }
  return { text, sources: [...sources.values()] };
}
