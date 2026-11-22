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
