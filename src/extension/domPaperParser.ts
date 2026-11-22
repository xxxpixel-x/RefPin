import type {
  CompanionAsset,
  CompanionReference,
  DomPaperPayload,
} from './protocol';
import { deriveDisplayName, getAcademicSiteLabel, inspectTabUrl } from './urlRules';

export interface ParsedDomPaper {
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
  counter: { value: number },
  anchorElements: Map<string, HTMLElement>,
): string {
  const existing = el.id?.trim() || el.getAttribute('data-refpin-anchor')?.trim();
  const anchorId = existing || `refpin-${fallbackPrefix}-${++counter.value}`;
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
      pdfUrl = new URL(metaPdf, window.location.href).href;
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
        citationCount: 0,
      },
      assetsByKey,
      assetsByElementId,
      refsByIndex,
      refsByElementId,
      anchorElements,
    };
  }

  const seenContainers = new Set<HTMLElement>();
  let figFallback = 0;
  let tableFallback = 0;

  // ---- 1) 抽取图表（Figures & Tables）----
  const figureSelectors = [
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

  return {
    payload: {
      title: deriveDisplayName(window.location.href, metaTitle || document.title),
      url: window.location.href,
      siteLabel: urlInfo.siteLabel,
      isAcademicPage: isAcademic || assets.length > 0 || references.length > 0,
      pdfUrl,
      assets,
      references,
      citationCount: 0,
    },
    assetsByKey,
    assetsByElementId,
    refsByIndex,
    refsByElementId,
    anchorElements,
  };
}
