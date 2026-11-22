import type { GlossaryEntry, GlossaryMention, InlineCitation } from '../types/paper';
import type { LinesByPage, RefRange, TextLine } from './types';
import { isInsideRefRange, readingOrder, rectForRange, rectIoU } from './utils';

const ignored = new Set('PDF URL USA HTTP JSON HTML II III IV VI EQ FIG TAB'.split(' '));
const stopwords = new Set('of the and for in to with on by a an from'.split(' '));
const parenthetical = /[(（]\s*(?:简称\s*)?([A-Z][A-Za-z0-9-]{1,9}|[\p{Script=Han}]{2,6})\s*[)）]/gu;
const symbolDefinition = /\bwhere\s+([A-Za-z\p{Script=Greek}](?:_[A-Za-z0-9]{1,8})?)\s+(?:denotes\s+|represents\s+|is\s+(?=the\b))([^,;:.!?()]{3,120})(?=[,;:.!?()]|$)/giu;

// Take the shortest suffix whose content words each supply an initial or a
// prefix. Prefixes also cover names such as Residual Network (ResNet).
function englishExpansion(before: string, term: string): string | undefined {
  const phrase = before.match(/[A-Za-z0-9]+(?:[ \t‐‑–-]+[A-Za-z0-9]+)*\s*$/)?.[0].trimEnd();
  if (!phrase || !/[A-Z].*[A-Z0-9]/.test(term)) return;
  const letters = term.toLowerCase().replace(/-/g, '');
  const words = [...phrase.matchAll(/[A-Za-z0-9]+/g)].slice(-2 * letters.length);
  let ends = new Set([letters.length]);
  let contentWords = 0;
  for (let i = words.length - 1; i >= 0 && ends.size; i--) {
    const word = words[i][0].toLowerCase();
    const optional = stopwords.has(word);
    if (!optional) contentWords++;
    const starts = new Set<number>(optional ? ends : []);
    for (const end of ends) {
      for (let start = Math.max(0, end - word.length); start < end; start++) {
        if (word.startsWith(letters.slice(start, end))) starts.add(start);
      }
    }
    if (starts.has(0) && !optional && contentWords >= 2) return phrase.slice(words[i].index);
    ends = starts;
  }
}

function acronymExpansion(before: string, term: string, explicitAlias: boolean): string | undefined {
  if (ignored.has(term.toUpperCase())) return;
  const chinese = before.trimEnd().match(/[\p{Script=Han}]{2,40}$/u)?.[0];
  if (chinese) {
    const name = chinese.split(/(?:本文采用|我们使用|我们提出|本文提出|称为|使用|采用|提出的?)/u).pop();
    if (!name || name.length < 2) return;
    if (/^[A-Z][A-Z0-9-]+$/.test(term)) return name;
    if (/^\p{Script=Han}+$/u.test(term) && name.length > term.length &&
        (explicitAlias || new RegExp([...term].join('.*'), 'u').test(name))) return name;
    return;
  }
  return englishExpansion(before, term);
}

export function* glossaryDefinitions(text: string, prefix = '') {
  function definition(term: string, expansion: string, start: number, kind: GlossaryEntry['kind']) {
    const end = start + term.length;
    const before = (prefix + text.slice(0, start)).split(/[。！？!?]|\.\s+/u).pop() ?? '';
    const after = text.slice(end).match(/^.*?(?:[。！？!?]|\.(?=\s|$)|$)/u)?.[0] ?? '';
    return { term, expansion, start, end, kind, contextSentence: (before.slice(-180) + term + after.slice(0, 180)).trim() };
  }
  for (const hit of text.matchAll(parenthetical)) {
    const expansion = acronymExpansion(prefix + text.slice(0, hit.index), hit[1], /[(（]\s*简称/.test(hit[0]));
    if (expansion) yield definition(hit[1], expansion, hit.index! + hit[0].lastIndexOf(hit[1]), 'acronym');
  }
  for (const hit of text.matchAll(symbolDefinition)) {
    const expansion = hit[2].split(/\s+(?:and|where|which)\s+(?=\S+\s+(?:denotes|represents|is)\b)/i)[0].trim();
    yield definition(hit[1], expansion, hit.index! + hit[0].match(/^where\s+/i)![0].length, 'symbol');
  }
}

interface Options {
  refRange?: RefRange;
  citationsByPage?: Record<number, InlineCitation[]>;
  signal?: AbortSignal;
}

export interface GlossaryResult {
  glossaryMap: Record<string, GlossaryEntry>;
  glossaryMentionsByPage: Record<number, GlossaryMention[]>;
}

export function parseGlossary(linesByPage: LinesByPage, { refRange, citationsByPage, signal }: Options = {}): GlossaryResult {
  signal?.throwIfAborted();
  const lines = Object.keys(linesByPage).map(Number).sort((a, b) => a - b)
    .flatMap(page => readingOrder(linesByPage[page]).filter(line =>
      !isInsideRefRange(page, line.rect.y + line.rect.height / 2, refRange)));
  const definitions = new Map<string, { entry: GlossaryEntry; lineIndex: number; end: number }>();

  lines.forEach((line, lineIndex) => {
    signal?.throwIfAborted();
    const previous = lines[lineIndex - 1];
    const wrapped = previous && previous.pageNumber === line.pageNumber && previous.column === line.column &&
      line.rect.y >= previous.rect.y && line.rect.y - previous.rect.y < previous.rect.height * 2.5;
    const prefix = wrapped ? previous.text + ' ' : '';
    for (const { term, start, end, ...detail } of glossaryDefinitions(line.text, prefix)) {
      const definedRect = rectForRange(line, start, end);
      if (!definedRect || definitions.has(term)) continue;
      definitions.set(term, {
        entry: { term, ...detail, definedPage: line.pageNumber, definedRect },
        lineIndex, end,
      });
    }
  });

  const glossaryMap = Object.fromEntries([...definitions].map(([term, { entry }]) => [term, entry]));
  const glossaryMentionsByPage: Record<number, GlossaryMention[]> = {};
  if (definitions.size) {
    // Registered terms contain only letters, digits, underscores or hyphens.
    const terms = [...definitions.keys()].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(terms.join('|'), 'gu');
    // Latin terms can touch surrounding Chinese prose. Chinese abbreviations
    // likewise have no whitespace boundary in ordinary running text.
    const word = /[\p{L}\p{M}\p{N}_]/u;
    const insideWord = (ch: string) => word.test(ch) && !/\p{Script=Han}/u.test(ch);
    lines.forEach((line, lineIndex) => {
      signal?.throwIfAborted();
      for (const hit of line.text.matchAll(pattern)) {
        const start = hit.index!;
        const term = hit[0];
        const end = start + term.length;
        const definition = definitions.get(term)!;
        if (lineIndex < definition.lineIndex || (lineIndex === definition.lineIndex && start < definition.end)) continue;
        if (insideWord(line.text[start - 1] ?? '') || insideWord(line.text[end] ?? '')) continue;
        const rect = rectForRange(line, start, end);
        if (!rect || citationsByPage?.[line.pageNumber]?.some(c => rectIoU(c.rect, rect) > 1e-8)) continue;
        if (line.pageNumber === definition.entry.definedPage && rectIoU(rect, definition.entry.definedRect) > 0.95) continue;
        (glossaryMentionsByPage[line.pageNumber] ??= []).push({
          id: 'term-' + line.pageNumber + '-' + lineIndex + '-' + start,
          term, rawText: term, pageNumber: line.pageNumber, rect,
        });
      }
    });
  }
  return { glossaryMap, glossaryMentionsByPage };
}
