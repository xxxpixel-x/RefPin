const CAPTION_RE =
  /^(Figure|Fig\.?|Table|Tab\.?|图|表)\s*(\d+(?:[.\-–]\d+)?[a-zA-Z]?)(.*)$/i;
const PROSE_AFTER_LABEL =
  /^(?:shows?|illustrates?|presents?|depicts?|summarizes?|reports?|lists?|gives?|is|are|were|was)\b|^(?:显示|展示|说明|给出|列出|所示|中的|为|是)/i;

/** Recognize a caption label without counting it as a backlink to its own asset. */
export function parseCaptionLabel(text: string) {
  const match = text.trim().match(CAPTION_RE);
  if (!match) return null;
  const [, prefix, number, tail] = match;
  const rest = tail.trim();
  if (PROSE_AFTER_LABEL.test(rest)) return null;
  if (/^[a-z]/i.test(prefix) && !/^[:：.．]/.test(rest) && rest.length < 8) return null;
  const kind: 'figure' | 'table' = /^(?:图|fig)/i.test(prefix) ? 'figure' : 'table';
  return { kind, number, label: `${kind === 'figure' ? 'Figure' : 'Table'} ${number}` };
}

// Inline links and extracted headings must agree on the environment's key,
// even when the printed label is abbreviated or written in Chinese.
const numbered = String.raw`(?:[A-Z]\.\d+|\d+)(?:\.\d+)*`;
const appendix = String.raw`(?:[A-Z]|\d+)(?:\.\d+)*`;
const families = [
  ['alg', 'algorithm', String.raw`\b(?:algorithms?|algs?\.?)|算法`, numbered],
  ['thm', 'theorem', String.raw`\b(?:theorems?|thms?\.?)|定理`, numbered],
  ['lem', 'theorem', String.raw`\b(?:lemmas?|lems?\.?)|引理`, numbered],
  ['prop', 'theorem', String.raw`\b(?:propositions?|props?\.?)|命题`, numbered],
  ['cor', 'theorem', String.raw`\b(?:corollar(?:y|ies)|cors?\.?)|推论`, numbered],
  ['def', 'theorem', String.raw`\b(?:definitions?|defs?\.?)|定义`, numbered],
  ['sec', 'section', String.raw`\b(?:sections?|secs?\.?)|§`, numbered],
  ['app', 'section', String.raw`\b(?:appendix\b|appendices\b|app(?=[.\s])\.?)|附录`, appendix],
] as const;

const patterns = families.map(([prefix, kind, names, number]) => {
  const token = number + String.raw`(?![a-z0-9_]|\.\d)`;
  const more = String.raw`(?:\s*(?:,|，|、|\band\b|&|和)\s*` + token + ')*';
  return { prefix, kind, regex: new RegExp('(?:' + names + ')\\s*(' + token + more + ')', 'gi') };
});
patterns.push({ prefix: 'sec', kind: 'section', regex: new RegExp('第\\s*(' + numbered + ')\\s*节', 'gi') });

export function structuredMentions(text: string) {
  const matches = [];
  for (const { prefix, kind, regex } of patterns) {
    for (const hit of text.matchAll(regex)) {
      const numbers = hit[1].split(/\s*(?:,|，|、|\band\b|&|和)\s*/i);
      matches.push({ start: hit.index!, rawText: hit[0], kind,
        targetKeys: numbers.map(number => prefix + '-' + number.toLowerCase()) });
    }
  }
  return matches;
}

export function parseStructureHeading(text: string) {
  const trimmed = text.trim();
  const first = structuredMentions(trimmed).find(hit => hit.start === 0);
  if (first && first.targetKeys.length === 1) {
    // A standalone link fragment such as "§3.2" can be its own PDF text run.
    // Only a spelled-out heading may claim an asset key.
    if (/^(?:§|(?:algs?|thms?|lems?|props?|cors?|defs?|secs?|app)\b)/i.test(trimmed)) return null;
    const tail = trimmed.slice(first.rawText.length).trim();
    const punctuation = /^[.．:：（(。]/.test(tail);
    const title = /^[A-Z\p{Script=Han}]/u.test(tail) && !/[.!?。！？]$/.test(tail);
    const prose = PROSE_AFTER_LABEL.test(tail) || /^(?:runs?|takes?|requires?|uses?|can|will|and|follows?)\b|^(?:在|中|的|可|将|需要|用于|具有|和)/i.test(tail);
    if (prose || (tail && !punctuation && !title)) return null;
    if (first.kind === 'theorem' && tail && !punctuation && !/^\p{Script=Han}/u.test(trimmed)) return null;
    return { kind: first.kind, key: first.targetKeys[0], label: first.rawText };
  }
  // An unprefixed heading needs both a number/appendix letter and a title.
  const bare = /^(\d{1,2}(?:\.\d+)*|[A-Z](?:\.\d+)*)\.?\s+([A-Z\p{Script=Han}].{0,85})$/u.exec(trimmed);
  if (!bare || /[.!?。！？;；]$/.test(trimmed)) return null;
  const prefix = /^[A-Z]/.test(bare[1]) ? 'app-' : 'sec-';
  return { kind: 'section' as const, key: prefix + bare[1].toLowerCase(), label: trimmed };
}
