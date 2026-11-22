import { t } from '../i18n/core';
import { parsePaperLocation } from '../services/arxivFetch';
export interface ResolvedPaperUrl {
  pdfUrl?: string;
  kind: 'pdf' | 'academic-html' | 'academic-abstract' | 'other';
  siteLabel: string;
  suggestedTitle?: string;
}

const KNOWN_ACADEMIC_HTML_HOSTS: Array<{ match: RegExp; label: string }> = [
  { match: /^(?:export\.)?arxiv\.org$/i, label: 'arXiv' },
  { match: /^ar5iv\.labs\.arxiv\.org$|^ar5iv\.org$/i, label: 'ar5iv' },
  { match: /^(?:www\.)?nature\.com$/i, label: 'Nature' },
  { match: /^link\.springer\.com$/i, label: 'Springer' },
  { match: /^ieeexplore\.ieee\.org$/i, label: 'IEEE Xplore' },
  { match: /^dl\.acm\.org$/i, label: 'ACM DL' },
  { match: /^(?:www\.)?sciencedirect\.com$/i, label: 'ScienceDirect' },
  { match: /^onlinelibrary\.wiley\.com$/i, label: 'Wiley' },
  { match: /^pubmed\.ncbi\.nlm\.nih\.gov$/i, label: 'PubMed' },
  { match: /^pmc\.ncbi\.nlm\.nih\.gov$|^www\.ncbi\.nlm\.nih\.gov$/i, label: 'PubMed Central' },
  { match: /^(?:www\.)?biorxiv\.org$/i, label: 'bioRxiv' },
  { match: /^(?:www\.)?medrxiv\.org$/i, label: 'medRxiv' },
  { match: /^aclanthology\.org$/i, label: 'ACL Anthology' },
  { match: /^openreview\.net$/i, label: 'OpenReview' },
  { match: /^proceedings\.neurips\.cc$|^papers\.nips\.cc$/i, label: 'NeurIPS' },
  { match: /^proceedings\.mlr\.press$/i, label: 'PMLR' },
  { match: /^openaccess\.thecvf\.com$/i, label: 'CVF' },
  { match: /^huggingface\.co$/i, label: 'HF Papers' },
  { match: /(?:^|\.)cnki\.net$/i, get label() { return t('site.cnki'); } },
  { match: /(?:^|\.)wanfangdata\.com\.cn$/i, get label() { return t('site.wanfang'); } },
  { match: /(?:^|\.)readpaper\.com$/i, label: 'ReadPaper' },
  { match: /^(?:www\.)?mdpi\.com$/i, label: 'MDPI' },
  { match: /^(?:www\.)?frontiersin\.org$/i, label: 'Frontiers' },
  { match: /^journals\.plos\.org$/i, label: 'PLOS' },
  { match: /^academic\.oup\.com$/i, label: 'Oxford Academic' },
  { match: /^(?:www\.)?tandfonline\.com$/i, label: 'Taylor & Francis' },
  { match: /^distill\.pub$/i, label: 'Distill' },
];

export function safeParseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim());
  } catch {
    return null;
  }
}

export function normalizeDocKey(rawUrl: string): string {
  const url = safeParseUrl(rawUrl);
  if (!url) return rawUrl.trim();
  url.hash = '';
  return url.href;
}

export function getAcademicSiteLabel(rawUrl: string): string | null {
  const url = safeParseUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  for (const entry of KNOWN_ACADEMIC_HTML_HOSTS) {
    if (entry.match.test(host)) {
      if (host === 'huggingface.co' && !/^\/papers\//i.test(url.pathname)) {
        return null;
      }
      return entry.label;
    }
  }
  return null;
}

export function isDirectPdfUrl(rawUrl: string): boolean {
  const url = safeParseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (/\.pdf$/i.test(path)) return true;
  if ((host === 'arxiv.org' || host === 'export.arxiv.org') && /^\/pdf\//i.test(path)) {
    return true;
  }
  if (host === 'openreview.net' && path === '/pdf' && url.searchParams.has('id')) {
    return true;
  }
  if (host === 'dl.acm.org' && /^\/doi\/pdf\//i.test(path)) return true;
  if (host === 'ieeexplore.ieee.org' && /^\/stampPDF\//i.test(path)) return true;
  if (host === 'link.springer.com' && /^\/content\/pdf\//i.test(path)) return true;
  return false;
}

/**
 * 分析当前标签页 URL：区分原生 PDF、学术 HTML 全文、学术摘要页（可关联 PDF）与普通网页。
 */
export function inspectTabUrl(rawUrl: string): ResolvedPaperUrl {
  const url = safeParseUrl(rawUrl);
  if (!url) return { kind: 'other', siteLabel: t('site.web') };

  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const knownLabel = getAcademicSiteLabel(rawUrl);

  // 1) 直接 PDF 页面（含 arXiv/pdf、OpenReview/pdf、ACM/IEEE/Springer PDF、通用 .pdf、本地 file:// .pdf）
  if (isDirectPdfUrl(rawUrl)) {
    const paper = parsePaperLocation(url.href);
    return {
      pdfUrl: paper?.pdfUrl || url.href,
      kind: 'pdf',
      siteLabel: url.protocol === 'file:' ? t('site.localPdf') : knownLabel || host.replace(/^www\./, ''),
      suggestedTitle: paper?.displayName,
    };
  }

  if (['arxiv.org', 'export.arxiv.org', 'ar5iv.labs.arxiv.org', 'ar5iv.org'].includes(host)) {
    const hit = /^\/(abs|html)\/(.+?)\/?$/i.exec(path);
    const paper = hit && parsePaperLocation('https://arxiv.org/abs/' + hit[2]);
    if (paper?.pdfUrl && hit) {
      const html = hit[1] === 'html';
      return { kind: html ? 'academic-html' : 'academic-abstract', pdfUrl: paper.pdfUrl,
        suggestedTitle: paper.displayName, siteLabel: html ? (host.includes('ar5iv') ? 'ar5iv HTML' : 'arXiv HTML') : t('site.arxivAbstract') };
    }
  }
  if (host === 'openreview.net' && path === '/forum' && url.searchParams.get('id')) {
    const id = url.searchParams.get('id')!;
    return {
      pdfUrl: `https://openreview.net/pdf?id=${encodeURIComponent(id)}`,
      kind: 'academic-abstract',
      siteLabel: 'OpenReview',
      suggestedTitle: `OpenReview-${id}.pdf`,
    };
  }
  if (host === 'huggingface.co' && /^\/papers\/(\d{4}\.\d{4,5}(?:v\d+)?)/i.test(path)) {
    const id = path.match(/^\/papers\/(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1];
    return {
      pdfUrl: id ? `https://arxiv.org/pdf/${id}.pdf` : undefined,
      kind: 'academic-abstract',
      siteLabel: 'HF Papers',
      suggestedTitle: id ? `arXiv-${id}.pdf` : undefined,
    };
  }

  // 4) 其他主流学术网站 HTML 全文页
  if (knownLabel && path !== '/') {
    return {
      kind: 'academic-html',
      siteLabel: knownLabel,
    };
  }

  return {
    kind: 'other',
    siteLabel: host.replace(/^www\./, '') || t('site.web'),
  };
}

export function deriveDisplayName(rawUrl: string, explicitTitle?: string): string {
  if (explicitTitle && explicitTitle.trim()) {
    return explicitTitle
      .trim()
      .replace(/^\[[\d.v]+\]\s*/i, '')
      .replace(/\s*[|\-–—]\s*(arXiv|OpenReview|Nature|SpringerLink|ScienceDirect|IEEE Xplore|ACM Digital Library).*$/i, '')
      .trim();
  }
  const url = safeParseUrl(rawUrl);
  if (!url) return t('site.currentPaper');
  const seg = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname);
  return seg || t('site.currentPaper');
}
