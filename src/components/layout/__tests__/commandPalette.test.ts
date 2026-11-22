import { expect, it } from 'vitest';
import { rankCommands, pageQuery } from '../commandMatcher';

const commands = [
  { id: 'fig-20', label: 'Figure 20', shortcut: 'fig-20' },
  { id: 'fig-2', label: 'Figure 2', shortcut: 'fig-2', keywords: 'attention architecture' },
  { id: 'tab-1', label: '表 1', shortcut: 'tab-1' },
  { id: 'alg-1', label: 'Algorithm 1', shortcut: 'alg-1' },
  { id: 'thm-2', label: 'Theorem 2', shortcut: 'thm-2' },
  { id: 'eq-3', label: 'Eq. (3)', shortcut: 'eq-3' },
  { id: 'ref-14', label: '[14] Vaswani', shortcut: 'ref-14' },
];
it.each([['f2', 'fig-2'], ['t1', 'tab-1'], ['ALG1','alg-1'], ['thm2','thm-2'], ['eq3','eq-3'],
  ['r14','ref-14'], ['[14]','ref-14'], ['archit','fig-2']])('resolves %s to %s', (query, id) => {
  expect(rankCommands(commands, query)[0]?.id).toBe(id);
});
it.each([[':12', 12], ['p 8', 8], ['P8', 8], ['p0', undefined], [':12a', undefined]])('parses page query %s', (query, page) => {
  expect(pageQuery(String(query))).toBe(page);
});
it('ranks exact labels and contiguous matches above fuzzy subsequences', () => {
  const rows = ['Faint image', 'Configure', 'Fig', 'Figure', 'Open'].map(label => ({ id: label, label }));
  expect(rankCommands(rows, 'fig').map(r => r.label)).toEqual(['Fig','Figure','Configure','Faint image']);
  expect(rankCommands(rows, 'zzz')).toEqual([]);
  expect(rankCommands(rows, '')).toEqual(rows);
});
