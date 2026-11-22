import type { CitationBacklink, InlineCitation, PaperAsset } from '../types/paper';

function targetKeys(citation: InlineCitation): Set<string> {
  const keys = new Set<string>();
  for (const key of citation.targetKeys) {
    keys.add(key);
    const panel = /^((?:fig|tab)-\d+(?:[.-]\d+)*)[a-z]$/i.exec(key);
    if (panel) keys.add(panel[1]);
  }
  return keys;
}

export function findAssetForCitation(
  citation: InlineCitation,
  assetsMap: Record<string, PaperAsset>,
): PaperAsset | undefined {
  for (const key of targetKeys(citation)) {
    if (assetsMap[key]) return assetsMap[key];
  }
}

export function buildBacklinksMap(
  citationsByPage: Record<number, InlineCitation[]>,
): Record<string, CitationBacklink[]> {
  const byTarget = new Map<string, Map<string, CitationBacklink>>();
  for (const citations of Object.values(citationsByPage)) {
    for (const citation of citations) {
      const { id, pageNumber, rect, rawText } = citation;
      const backlink = { citationId: id, pageNumber, rect, rawText };
      for (const key of targetKeys(citation)) {
        let links = byTarget.get(key);
        if (!links) {
          links = new Map();
          byTarget.set(key, links);
        }
        if (!links.has(id)) links.set(id, backlink);
      }
    }
  }
  return Object.fromEntries(Array.from(byTarget, ([key, links]) => [
    key,
    [...links.values()].sort((a, b) =>
      a.pageNumber - b.pageNumber || a.rect.y - b.rect.y || a.rect.x - b.rect.x,
    ),
  ]));
}
