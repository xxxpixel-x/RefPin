import { parseStructureHeading, structuredMentions } from '../engine/captionLabel';
import { glossaryDefinitions } from '../engine/glossaryParser';
import type { OutlineItem } from '../types/paper';
import type {
  CompanionAsset,
  CompanionReference,
  DomPaperPayload,
} from './protocol';
import { deriveDisplayName, getAcademicSiteLabel, inspectTabUrl } from './urlRules';

export interface CitationBinding {
  asset?: CompanionAsset;
  relatedAssets?: CompanionAsset[];
  references?: CompanionReference[];
}

export interface ParsedDomPaper {
  citations: Map<HTMLElement, CitationBinding>;
  payload: DomPaperPayload;
  assetsByKey: Map<string, CompanionAsset>;
  assetsByElementId: Map<string, CompanionAsset>;
  refsByIndex: Map<number, CompanionReference>;
  refsByElementId: Map<string, CompanionReference>;
  anchorElements: Map<string, HTMLElement>;
}

const MAX_CAPTION_LEN = 360;
const MAX_REF_LEN = 420;

function cleanText(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function ensureAnchorId(
  el: HTMLElement,
  fallbackPrefix: string,
  counter: { value: number; reserved?: Set<string> },
  anchorElements: Map<string, HTMLElement>,
): string {
  const existing = el.id?.trim() || el.getAttribute('data-refpin-anchor')?.trim();
  let anchorId = existing;
  if (!anchorId) {
    counter.reserved ??= new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-refpin-anchor]'), node => node.dataset.refpinAnchor!));
    do { anchorId = 'refpin-' + fallbackPrefix + '-' + ++counter.value; }
    while (counter.reserved.has(anchorId) || document.getElementById(anchorId));
  }
  if (!el.getAttribute('data-refpin-anchor')) {
    el.setAttribute('data-refpin-anchor', anchorId);
  }
  anchorElements.set(anchorId, el);
  return anchorId;
}

function resolveBestImageSrc(container: Element): string | undefined {
  const imgs = Array.from(container.querySelectorAll('img'));
  let bestUrl: string | undefined;
  let bestScore = -1;

  for (const img of imgs) {
    const raw =
      img.currentSrc ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('src') ||
      '';
    if (!raw || raw.startsWith('data:image/gif;base64,R0lGOD')) continue;
    if (/logo|icon|badge|avatar|orcid|cc-by/i.test(raw)) continue;

    let absUrl = raw;
    try {
      absUrl = new URL(raw, window.location.href).href;
    } catch {
      continue;
    }

    const rect = img.getBoundingClientRect();
    const w = img.naturalWidth || rect.width || 120;
    const h = img.naturalHeight || rect.height || 80;
    if (w < 36 || h < 28) continue;

    const score = w * h;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = absUrl;
    }
  }

  if (bestUrl) return bestUrl;

  // 若图使用内联 <svg> 渲染（如部分论文流程图或图表），转为 data URL
  const svgs = Array.from(container.querySelectorAll('svg'));
  for (const svg of svgs) {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 40) continue;
    try {
      const clone = svg.cloneNode(true) as SVGElement;
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      if (!clone.getAttribute('width') && rect.width > 0) {
        clone.setAttribute('width', String(Math.round(rect.width)));
      }
      if (!clone.getAttribute('height') && rect.height > 0) {
        clone.setAttribute('height', String(Math.round(rect.height)));
      }
      const serialized = new XMLSerializer().serializeToString(clone);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    } catch {
      // 忽略异常 SVG
    }
  }

  return undefined;
}

/**
 * 将网页表格清洗为极简安全 HTML（剥离脚本、事件、外部样式），用于浮窗与侧栏清晰展示
 */
function buildSafeTablePreview(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr')).slice(0, 14);
  if (rows.length === 0) return '';

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const rowHtmls = rows.map((tr, rowIdx) => {
    const cells = Array.from(tr.children)
      .filter((el) => el.tagName === 'TH' || el.tagName === 'TD')
      .slice(0, 10);
    const cellHtml = cells
      .map((cell) => {
        const tag = cell.tagName === 'TH' || rowIdx === 0 ? 'th' : 'td';
        const text = escapeHtml(truncate(cleanText(cell.textContent), 48));
        return `<${tag}>${text}</${tag}>`;
      })
      .join('');
    return `<tr>${cellHtml}</tr>`;
  });

  return `<table>${rowHtmls.join('')}</table>`;
}

function parseFigureLabel(captionText: string, fallbackIndex: number): {
  key: string;
  label: string;
} {
  const en = captionText.match(
    /\b(?:Fig(?:ure)?\.?)\s*([A-Z]?\d+(?:\.\d+)?[a-z]?)\b/i,
  );
  if (en) {
    const num = en[1];
    return { key: `fig:${num.toLowerCase()}`, label: `Fig. ${num}` };
  }
  const zh = captionText.match(/(?:附图|图)\s*(\d+(?:\.\d+)?[a-z]?)/);
  if (zh) {
    const num = zh[1];
    return { key: `fig:${num.toLowerCase()}`, label: `图 ${num}` };
  }
  return { key: `fig:${fallbackIndex}`, label: `Fig. ${fallbackIndex}` };
}

function parseTableLabel(captionText: string, fallbackIndex: number): {
  key: string;
  label: string;
} {
  const en = captionText.match(
    /\b(?:Tab(?:le)?\.?)\s*([A-Z]?\d+(?:\.\d+)?|[IVX]+)\b/i,
  );
  if (en) {
    const num = en[1];
    return { key: `table:${num.toLowerCase()}`, label: `Table ${num}` };
  }
  const zh = captionText.match(/(?:附表|表)\s*(\d+(?:\.\d+)?)/);
  if (zh) {
    const num = zh[1];
    return { key: `table:${num.toLowerCase()}`, label: `表 ${num}` };
  }
  return { key: `table:${fallbackIndex}`, label: `Table ${fallbackIndex}` };
}

function parseEquationLabel(text: string): { key: string; label: string } | null {
  const m = text.match(/\((\d+(?:\.\d+)?)\)\s*$/);
  if (!m) return null;
  return { key: `eq:${m[1]}`, label: `Eq. (${m[1]})` };
}

function parseReferenceMetadata(rawText: string, index: number): CompanionReference {
  const cleaned = truncate(cleanText(rawText), MAX_REF_LEN);
  const yearMatch = cleaned.match(/\b(19\d{2}|20[0-3]\d)\b/);
  const year = yearMatch?.[1];

  // 去除开头的 [14] / 14.
  const withoutNum = cleaned.replace(/^(?:\[\s*\d+\s*\]|\d+\s*[.)])\s*/, '');
  const parts = withoutNum.split(/\.\s+(?=[A-Z\u4e00-\u9fa5])/).filter(Boolean);

  let authors: string | undefined;
  let title = withoutNum;
  if (parts.length >= 2) {
    authors = truncate(parts[0], 110);
    title = truncate(parts[1], 180);
  } else {
    title = truncate(withoutNum, 180);
  }

  return {
    key: `ref:${index}`,
    index,
    rawText: cleaned,
    title: title || cleaned,
    authors,
    year,
  };
}

/**
 * 判断当前 HTML 网页是否大概率是学术论文页面，
 * 防止在普通网站（如淘宝、B站、邮箱）上运行扫描或修改 DOM。
 */
export function isLikelyAcademicHtmlPage(): boolean {
  const href = window.location.href;
  const siteLabel = getAcademicSiteLabel(href);
  if (siteLabel) {
    // 排除站内首页/搜索列表页等极少正文内容的页面
    const path = window.location.pathname;
    if (path === '/' || path === '') return false;
    return true;
  }

  // 通用学术出版元标签（覆盖高校校园网代理域名、独立期刊、预印本等）
  const hasCitationMeta = Boolean(
    document.querySelector(
      'meta[name="citation_title"], meta[name="citation_pdf_url"], meta[name="citation_doi"], meta[name="DC.Title"], meta[name="dc.title"]',
    ),
  );
  if (hasCitationMeta) return true;

  // LaTeXML / ar5iv 特征
  if (document.querySelector('.ltx_document, .ltx_page_main, .ltx_bibliography')) {
    return true;
  }

  return false;
}

const theoremSelector = '.ltx_theorem, .ltx_lemma, .ltx_proposition, .ltx_definition, .ltx_corollary';
const ignoredCitationContainers = 'script, style, noscript, code, pre, textarea, input, button, nav, header, footer, aside, figure, figcaption, h2, h3, .ltx_title, .ltx_tag, .refpin-tr-block, .ltx_bibliography, #references, .references';
function expandNumericList(spec: string): number[] {
  const result: number[] = [];
  for (const part of spec.split(/[,，]/)) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 12) {
        for (let i = start; i <= end; i += 1) result.push(i);
      }
      continue;
    }
    const single = trimmed.match(/^\d+$/);
    if (single) result.push(Number(single[0]));
  }
  return result;
}

export function resolveBindingFromText(
  text: string,
  paper: ParsedDomPaper,
): CitationBinding | null {
  const figMatch = text.match(
    /(?:Fig(?:ure)?\.?\s*([A-Z]?\d+(?:\.\d+)?[a-z]?)|(?:附图|图)\s*(\d+(?:\.\d+)?[a-z]?))/i,
  );
  if (figMatch) {
    const num = (figMatch[1] || figMatch[2]).toLowerCase();
    const asset =
      paper.assetsByKey.get(`fig:${num}`) ||
      paper.assetsByKey.get(`fig:${num.replace(/[a-z]$/, '')}`);
    if (asset) return { asset };
  }

  const tblMatch = text.match(
    /(?:Tab(?:le)?\.?\s*([A-Z]?\d+(?:\.\d+)?|[IVX]+)|(?:附表|表)\s*(\d+(?:\.\d+)?))/i,
  );
  if (tblMatch) {
    const num = (tblMatch[1] || tblMatch[2]).toLowerCase();
    const asset = paper.assetsByKey.get(`table:${num}`);
    if (asset) return { asset };
  }

  const eqMatch = text.match(
    /(?:Eq(?:uation)?\.?\s*\(?(\d+(?:\.\d+)?)\)?|(?:公式|式)\s*[（(]?(\d+(?:\.\d+)?)[）)]?)/i,
  );
  if (eqMatch) {
    const num = eqMatch[1] || eqMatch[2];
    const asset = paper.assetsByKey.get(`eq:${num}`);
    if (asset) return { asset };
  }

  const mention = structuredMentions(text).find(hit => hit.start === 0);
  if (mention) {
    const assets = mention.targetKeys.flatMap(key => paper.assetsByKey.get(key) ?? []);
    if (assets.length) return { asset: assets[0], relatedAssets: assets.slice(1) };
  }
  const refMatch = text.match(/^[\[\【]\s*(\d+(?:\s*[-–—,，]\s*\d+)*)\s*[\]\】]$/);
  if (refMatch) {
    const nums = expandNumericList(refMatch[1]);
    const refs = nums
      .map((n) => paper.refsByIndex.get(n))
      .filter((r): r is CompanionReference => Boolean(r));
    if (refs.length > 0) return { references: refs };
  }

  return null;
}

function citationTokens(text: string) {
  const basic = /(?:\b(?:Fig(?:ure)?\.?|Tab(?:le)?\.?|Eq(?:uation)?\.?)\s*\(?[A-Z]?\d+(?:\.\d+)?[a-z]?\)?|(?:附图|附表|图|表)\s*\d+(?:\.\d+)?[a-z]?|(?:公式|式)\s*[（(]?\d+(?:\.\d+)?[）)]?|[\[【]\s*\d+(?:\s*[-–—,，]\s*\d+)*\s*[\]】])/gi;
  const tokens = Array.from(text.matchAll(basic), hit => ({ start: hit.index!, rawText: hit[0] }));
  return tokens.concat(structuredMentions(text)).sort((a, b) => a.start - b.start);
}

export function markTextCitations(node: Text, paper: ParsedDomPaper, bind: (element: HTMLElement, binding: CitationBinding) => void) {
  const raw = node.data;
  const frag = document.createDocumentFragment();
  let end = 0;
  for (const { start, rawText } of citationTokens(raw)) {
    if (start < end) continue;
    const binding = resolveBindingFromText(rawText, paper);
    if (!binding || (binding.asset?.domAnchorId && paper.anchorElements.get(binding.asset.domAnchorId)?.contains(node))) continue;
    frag.append(raw.slice(end, start));
    const span = document.createElement('span');
    span.textContent = rawText;
    bind(span, binding);
    frag.append(span);
    end = start + rawText.length;
  }
  if (end) {
    frag.append(raw.slice(end));
    node.replaceWith(frag);
  }
}

function collectCitations(paper: ParsedDomPaper): void {
  if (paper.assetsByKey.size === 0 && paper.refsByIndex.size === 0) return;

  // 路线 1：优先挂接原网页已有的内部锚点 <a>（零 DOM 侵入）
  const anchors = document.querySelectorAll<HTMLElement>('a[href*="#"], [data-refpin-citation]');
  for (const a of anchors) {
    if (a.closest(ignoredCitationContainers)) continue;
    let targetId = '';
    if (a instanceof HTMLAnchorElement) {
      let target: URL;
      try { target = new URL(a.href, document.baseURI); } catch { continue; }
      if (target.href.split('#')[0] !== location.href.split('#')[0]) continue;
      try { targetId = decodeURIComponent(target.hash.slice(1)); } catch { continue; }
    }
    const assetById = paper.assetsByElementId.get(targetId);
    if (assetById) {
      paper.citations.set(a, { asset: assetById });
      continue;
    }

    const refById = paper.refsByElementId.get(targetId);
    if (refById) {
      paper.citations.set(a, { references: [refById] });
      continue;
    }

    const text = (a.textContent || '').trim();
    if (text.length > 0 && (a.hasAttribute('data-refpin-citation') || text.length <= 28)) {
      const byText = resolveBindingFromText(text, paper);
      if (byText) {
        paper.citations.set(a, byText);
      }
    }
  }

  // 路线 2：无超链接的纯文本引用兜底（仅匹配已提取到的真实图表/文献，零误伤）
  const root =
    document.querySelector<HTMLElement>(
      'main, article, .ltx_page_main, [role="main"]',
    ) || document.body;
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(ignoredCitationContainers + ', a, [data-refpin-citation]')) return NodeFilter.FILTER_REJECT;
      const val = node.nodeValue;
      if (!val || val.length < 2) return NodeFilter.FILTER_REJECT;
      return citationTokens(val).length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current && textNodes.length < 1500) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    markTextCitations(textNode, paper, (element, binding) => {
      element.dataset.refpinCitation = '1';
      paper.citations.set(element, binding);
    });
  }
}

export function extractDomPaper(force = false): ParsedDomPaper {
  const isAcademic = isLikelyAcademicHtmlPage();
  const urlInfo = inspectTabUrl(window.location.href);
  const metaPdf = document
    .querySelector<HTMLMetaElement>('meta[name="citation_pdf_url"]')
    ?.content?.trim();
  const metaTitle = document
    .querySelector<HTMLMetaElement>('meta[name="citation_title"]')
    ?.content?.trim();

  let pdfUrl = urlInfo.pdfUrl;
  if (!pdfUrl && metaPdf) {
    try {
      const url = new URL(metaPdf, document.baseURI);
      if (['http:', 'https:'].includes(url.protocol)) pdfUrl = url.href;
    } catch {
      // ignore invalid meta url
    }
  }

  const assetsByKey = new Map<string, CompanionAsset>();
  const assetsByElementId = new Map<string, CompanionAsset>();
  const refsByIndex = new Map<number, CompanionReference>();
  const refsByElementId = new Map<string, CompanionReference>();
  const anchorElements = new Map<string, HTMLElement>();
  const anchorCounter = { value: 0 };

  if (!isAcademic && !force) {
    return {
      payload: {
        title: deriveDisplayName(window.location.href, metaTitle || document.title),
        url: window.location.href,
        siteLabel: urlInfo.siteLabel,
        isAcademicPage: false,
        pdfUrl,
        assets: [],
        references: [],
        citationCount: 0, backlinksMap: {}, glossaryMap: {}, outline: [],
      },
      citations: new Map(), assetsByKey,
      assetsByElementId,
      refsByIndex,
      refsByElementId,
      anchorElements,
    };
  }

  const outline: OutlineItem[] = [];
  const glossaryMap: DomPaperPayload['glossaryMap'] = Object.create(null);
  // Unpaginated HTML uses anchors for navigation and has no PDF geometry.
  const domRect = { x: 0, y: 0, width: 0, height: 0 };
  function textAsset(el: HTMLElement, kind: CompanionAsset['kind'], key: string, label: string, caption: string) {
    const domAnchorId = ensureAnchorId(el, kind, anchorCounter, anchorElements);
    const asset: CompanionAsset = { kind, key, label, caption: truncate(caption, MAX_CAPTION_LEN), domAnchorId, source: 'dom' };
    if (assetsByKey.has(key)) asset.key = key + ':' + domAnchorId;
    assetsByKey.set(asset.key, asset);
    assetsByElementId.set(domAnchorId, asset);
    return asset;
  }

  let parentHeading: OutlineItem | undefined;
  for (const el of document.querySelectorAll<HTMLElement>('h2, h3')) {
    if (el.closest('nav, header, footer, aside, figure, ' + theoremSelector + ', .ltx_algorithm')) continue;
    const title = cleanText(el.textContent);
    if (!title) continue;
    const id = ensureAnchorId(el, 'heading', anchorCounter, anchorElements);
    const heading: OutlineItem = { id, title, domAnchorId: id, pageNumber: null, children: [] };
    if (el.tagName === 'H3' && parentHeading) parentHeading.children.push(heading);
    else outline.push(heading);
    if (el.tagName === 'H2') parentHeading = heading;
    const tag = cleanText(el.querySelector('.ltx_tag')?.textContent);
    const number = /^(?:(?:Section|Sec\.?)\s+)?(\d+(?:\.\d+)*)(?:[.)、]\s*|\s+|(?=\p{Script=Han}))/iu.exec(title)
      || /^第\s*(\d+(?:\.\d+)*)\s*[章节]/u.exec(title);
    const sectionKey = parseStructureHeading(title)?.key ||
      (number ? 'sec-' + number[1] : /^\d+(?:\.\d+)*$/.test(tag) ? 'sec-' + tag : undefined);
    if (sectionKey) {
      const asset = textAsset(el, 'section', sectionKey, title, title);
      const section = el.closest('section[id]');
      if (section && section.querySelector('h2, h3') === el) assetsByElementId.set(section.id, asset);
    }
  }

  for (const el of document.querySelectorAll<HTMLElement>('p')) {
    if (el.closest(ignoredCitationContainers)) continue;
    for (const { term, expansion, contextSentence, kind } of glossaryDefinitions(cleanText(el.textContent))) {
      glossaryMap[term] ??= { term, expansion, contextSentence, kind, definedPage: 0, definedRect: domRect,
        domAnchorId: ensureAnchorId(el, 'definition', anchorCounter, anchorElements) };
    }
  }

  const seenContainers = new Set<HTMLElement>();
  let figFallback = 0;
  let tableFallback = 0;

  // ---- 1) 抽取图表（Figures & Tables）----
  const figureSelectors = [
    '.ltx_algorithm', theoremSelector,
    'figure.ltx_figure',
    'figure.ltx_table',
    'figure',
    '[data-test="figure"]',
    '[data-test="table"]',
    '.c-article-section__figure',
    '.c-article-table-container',
    '.figure-wrap',
    '.table-wrap',
    '.fig',
    '.table-box',
  ];

  const candidateNodes = Array.from(
    document.querySelectorAll<HTMLElement>(figureSelectors.join(',')),
  );

  for (const el of candidateNodes) {
    // 跳过嵌套在其他已处理 figure 内的子 figure
    if (seenContainers.has(el)) continue;
    if (el.closest('nav, header, footer, aside')) continue;
    const parentFigure = el.parentElement?.closest('figure');
    if (parentFigure && seenContainers.has(parentFigure as HTMLElement)) continue;

    const captionEl = el.querySelector(
      'figcaption, .ltx_caption, .c-article-section__figure-description, .caption, caption, [class*="caption"]',
    );
    const captionText = truncate(cleanText(captionEl?.textContent), MAX_CAPTION_LEN);

    const fullText = cleanText(el.textContent);
    const heading = captionText || cleanText(el.querySelector('.ltx_title, .ltx_tag, h4, h5')?.textContent) || fullText;
    const numbered = structuredMentions(heading).find(hit => hit.start === 0);
    const isAlgorithm = el.matches('.ltx_algorithm') || numbered?.kind === 'algorithm';
    if (isAlgorithm || el.matches(theoremSelector)) {
      const kind = isAlgorithm ? 'algorithm' : 'theorem';
      const id = ensureAnchorId(el, kind, anchorCounter, anchorElements);
      const key = numbered?.targetKeys[0] ?? kind + ':' + id;
      const asset = textAsset(el, kind, key, numbered?.rawText || truncate(heading || id, 64), fullText);
      asset.imageUrl = resolveBestImageSrc(el);
      seenContainers.add(el);
      continue;
    }

    const tableEl = el.querySelector('table');
    const isTableContainer =
      el.classList.contains('ltx_table') ||
      el.getAttribute('data-test') === 'table' ||
      /\b(?:Tab(?:le)?\.?\s*[A-Z]?\d+|表\s*\d+)/i.test(captionText) ||
      (Boolean(tableEl) && !el.querySelector('img'));

    if (isTableContainer && tableEl) {
      tableFallback += 1;
      const { key, label } = parseTableLabel(captionText, tableFallback);
      const tableHtml = buildSafeTablePreview(tableEl);
      const imgUrl = resolveBestImageSrc(el);
      if (!tableHtml && !imgUrl && !captionText) continue;

      seenContainers.add(el);
      const domAnchorId = ensureAnchorId(el, 'tbl', anchorCounter, anchorElements);
      const asset: CompanionAsset = {
        key,
        kind: 'table',
        label,
        caption: captionText || label,
        source: 'dom',
        imageUrl: imgUrl,
        tableHtml: tableHtml || undefined,
        domAnchorId,
      };
      if (!assetsByKey.has(key)) assetsByKey.set(key, asset);
      if (el.id) assetsByElementId.set(el.id, asset);
      assetsByElementId.set(domAnchorId, asset);
      continue;
    }

    const imageUrl = resolveBestImageSrc(el);
    if (!imageUrl) continue;

    figFallback += 1;
    const { key, label } = parseFigureLabel(captionText, figFallback);
    seenContainers.add(el);
    const domAnchorId = ensureAnchorId(el, 'fig', anchorCounter, anchorElements);
    const asset: CompanionAsset = {
      key,
      kind: 'figure',
      label,
      caption: captionText || label,
      source: 'dom',
      imageUrl,
      domAnchorId,
    };
    if (!assetsByKey.has(key)) assetsByKey.set(key, asset);
    if (el.id) assetsByElementId.set(el.id, asset);
    assetsByElementId.set(domAnchorId, asset);
  }

  // ---- 2) 独立表格兜底（某些期刊/知网页面把表格直接放在 <table> 里而非 <figure>）----
  const standaloneTables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
  for (const table of standaloneTables) {
    if (table.closest('figure, nav, header, footer, .ltx_equation, .ltx_equationgroup')) continue;
    const captionEl = table.querySelector('caption');
    const prevText = cleanText(table.previousElementSibling?.textContent);
    const captionText = truncate(
      cleanText(captionEl?.textContent) ||
        (/^(?:Tab(?:le)?\.?\s*\d+|表\s*\d+)/i.test(prevText) ? prevText : ''),
      MAX_CAPTION_LEN,
    );
    if (!captionText) continue;
    const tableHtml = buildSafeTablePreview(table);
    if (!tableHtml) continue;

    tableFallback += 1;
    const { key, label } = parseTableLabel(captionText, tableFallback);
    const domAnchorId = ensureAnchorId(table, 'tbl', anchorCounter, anchorElements);
    const asset: CompanionAsset = {
      key,
      kind: 'table',
      label,
      caption: captionText,
      source: 'dom',
      tableHtml,
      domAnchorId,
    };
    if (!assetsByKey.has(key)) assetsByKey.set(key, asset);
    if (table.id) assetsByElementId.set(table.id, asset);
    assetsByElementId.set(domAnchorId, asset);
  }

  // ---- 3) 抽取带编号的公式（arXiv HTML / LaTeXML / MathJax / KaTeX）----
  const eqNodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.ltx_equation, .ltx_equationgroup, [id^="eq"], [id^="Eq"], [class*="equation"]',
    ),
  );
  for (const eqEl of eqNodes) {
    if (eqEl.closest('nav, header, footer')) continue;
    const fullText = cleanText(eqEl.textContent);
    if (!fullText || fullText.length > 500) continue;

    const tagEl = eqEl.querySelector('.ltx_tag_equation, .ltx_tag, .eqn-num, .equation-number');
    const tagText = cleanText(tagEl?.textContent) || fullText;
    const parsed = parseEquationLabel(tagText);
    if (!parsed) continue;
    if (assetsByKey.has(parsed.key)) continue;

    const domAnchorId = ensureAnchorId(eqEl, 'eq', anchorCounter, anchorElements);
    const asset: CompanionAsset = {
      key: parsed.key,
      kind: 'equation',
      label: parsed.label,
      caption: truncate(fullText, 240),
      source: 'dom',
      textPreview: truncate(fullText, 240),
      imageUrl: resolveBestImageSrc(eqEl),
      domAnchorId,
    };
    assetsByKey.set(parsed.key, asset);
    if (eqEl.id) assetsByElementId.set(eqEl.id, asset);
    assetsByElementId.set(domAnchorId, asset);
  }

  // ---- 4) 抽取参考文献列表（References）----
  const refItemSelectors = [
    'li.ltx_bibitem',
    'ol.c-article-references > li',
    '[role="doc-biblioentry"]',
    '#references li',
    '#reference li',
    '.references li',
    '.reference-list li',
    '.ref-list li',
    '[id*="bib"] > li',
    '[class*="bibliography"] li',
  ];

  const refNodes = Array.from(
    document.querySelectorAll<HTMLElement>(refItemSelectors.join(',')),
  );
  const seenRefNodes = new Set<HTMLElement>();
  let fallbackRefIndex = 0;

  for (const refEl of refNodes) {
    if (seenRefNodes.has(refEl)) continue;
    seenRefNodes.add(refEl);

    const raw = cleanText(refEl.textContent);
    if (raw.length < 18) continue;

    fallbackRefIndex += 1;
    let index = fallbackRefIndex;

    const tagEl = refEl.querySelector('.ltx_tag_bibitem, .c-article-references__counter');
    const tagText = cleanText(tagEl?.textContent);
    const tagMatch =
      tagText.match(/\d+/) ||
      raw.match(/^\[\s*(\d+)\s*\]/) ||
      raw.match(/^(\d+)\.\s+/) ||
      refEl.id.match(/(?:bib|ref|cit|CR)[^\d]*(\d+)$/i);
    if (tagMatch) {
      const parsedNum = Number(tagMatch[1] ?? tagMatch[0]);
      if (Number.isFinite(parsedNum) && parsedNum > 0 && parsedNum < 2000) {
        index = parsedNum;
      }
    }

    const domAnchorId = ensureAnchorId(refEl, 'ref', anchorCounter, anchorElements);
    const refEntry = parseReferenceMetadata(raw, index);
    refEntry.domAnchorId = domAnchorId;

    const extLink = refEl.querySelector<HTMLAnchorElement>(
      'a[href^="http"]:not([href*="scholar.google"])',
    );
    if (extLink?.href) {
      refEntry.href = extLink.href;
    }

    if (!refsByIndex.has(index)) {
      refsByIndex.set(index, refEntry);
    }
    if (refEl.id) refsByElementId.set(refEl.id, refEntry);
    refsByElementId.set(domAnchorId, refEntry);
  }

  const assets = Array.from(assetsByKey.values());
  const references = Array.from(refsByIndex.values()).sort((a, b) => a.index - b.index);

  const paper: ParsedDomPaper = {
    payload: {
      title: deriveDisplayName(window.location.href, metaTitle || document.title),
      url: window.location.href,
      siteLabel: urlInfo.siteLabel,
      isAcademicPage: isAcademic || assets.length > 0 || references.length > 0,
      pdfUrl,
      assets,
      references,
      citationCount: 0, backlinksMap: {}, glossaryMap, outline,
    },
    citations: new Map(), assetsByKey,
    assetsByElementId,
    refsByIndex,
    refsByElementId,
    anchorElements,
  };
  collectCitations(paper);
  const ordered = [...paper.citations].sort(([a], [b]) => a === b ? 0 :
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  for (const [el, binding] of ordered) {
    const id = ensureAnchorId(el, 'citation', anchorCounter, anchorElements);
    const link = { citationId: id, domAnchorId: id, pageNumber: 0, rect: domRect, rawText: cleanText(el.textContent) };
    for (const target of binding.asset ? [binding.asset, ...binding.relatedAssets ?? []] : binding.references ?? []) {
      (paper.payload.backlinksMap[target.key] ??= []).push(link);
    }
  }
  paper.payload.citationCount = paper.citations.size;
  return paper;
}
