export interface SearchableCommand {
  id: string;
  label: string;
  keywords?: string;
  shortcut?: string;
}

const aliases: Record<string, string> = { f: 'fig', fig: 'fig', t: 'tab', tab: 'tab', alg: 'alg', thm: 'thm', eq: 'eq', r: 'ref', sec: 'sec' };
export function pageQuery(input: string): number | undefined {
  const hit = /^(?:p(?:age)?\s*|:\s*)([1-9]\d*)$/i.exec(input.trim());
  return hit ? Number(hit[1]) : undefined;
}

function score(query: string, text: string) {
  const value = text.normalize('NFKC').toLowerCase();
  if (value === query) return 1000;
  if (value.startsWith(query)) return 800;
  const index = value.indexOf(query);
  if (index >= 0) return 600 - Math.min(index, 100);
  let pos = -1, gaps = 0;
  for (const ch of query) {
    const next = value.indexOf(ch, pos + 1);
    if (next < 0) return 0;
    gaps += next - pos - 1;
    pos = next;
  }
  return 200 - Math.min(190, gaps);
}

export function rankCommands<T extends SearchableCommand>(commands: T[], input: string): T[] {
  const query = input.trim().normalize('NFKC').toLowerCase();
  if (!query) return commands;
  const hit = /^(f|fig|t|tab|alg|thm|eq|r|sec)\s*(\d+(?:[.-]\d+)*[a-z]?)$/.exec(query);
  const ref = /^\[(\d+)\]$/.exec(query);
  const shortcut = hit ? aliases[hit[1]] + '-' + hit[2] : ref ? 'ref-' + ref[1] : undefined;
  return commands.map(command => ({
    command, score: shortcut === command.shortcut && shortcut ? 1500 :
      Math.max(score(query, command.label), command.keywords ? score(query, command.keywords) * 0.7 : 0),
  })).filter(row => row.score > 0).sort((a,b) => b.score - a.score).map(row => row.command);
}
