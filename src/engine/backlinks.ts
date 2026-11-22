import type { CitationBacklink, GlossaryMention, InlineCitation, PaperAsset, PinnedItem } from '../types/paper';

export function glossaryPinId(term: string): string {
  return `term-${term}`;
}

function basePanelKey(key: string): string {
  return key.replace(/^((?:fig|tab)-\d+(?:[.-]\d+)*)[a-z]$/i, '$1');
}

function targetKeys(citation: InlineCitation): Set<string> {
  const keys = new Set<string>();
  for (const key of citation.targetKeys) {
    keys.add(key);
    keys.add(basePanelKey(key));
  }
  return keys;
}

export function currentPageAssets(page: number, citations: InlineCitation[], assets: Record<string, PaperAsset>, pins: PinnedItem[]) {
  const seen = new Set(pins.map(item => item.id));
  const result: PaperAsset[] = [];
  for (const citation of citations) {
    for (const key of citation.targetKeys) {
      const asset = assets[key] ?? assets[basePanelKey(key)];
      if (!asset || asset.pageNumber === page || seen.has(asset.key)) continue;
      seen.add(asset.key);
      result.push(asset);
    }
  }
  return result;
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
  glossaryMentionsByPage?: Record<number, GlossaryMention[]>,
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
  if (glossaryMentionsByPage) {
    for (const mentions of Object.values(glossaryMentionsByPage)) {
      for (const mention of mentions) {
        const key = glossaryPinId(mention.term);
        let links = byTarget.get(key);
        if (!links) {
          links = new Map();
          byTarget.set(key, links);
        }
        if (!links.has(mention.id)) {
          links.set(mention.id, {
            citationId: mention.id,
            pageNumber: mention.pageNumber,
            rect: mention.rect,
            rawText: mention.rawText,
          });
        }
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
