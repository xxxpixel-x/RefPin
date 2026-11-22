export function openFullReader(pdfUrl?: string | null, title?: string, page?: number) {
  const target = new URL(chrome.runtime.getURL('reader.html'));
  if (pdfUrl) {
    target.searchParams.set('url', pdfUrl);
    if (title) target.searchParams.set('title', title);
    if (page) target.searchParams.set('page', String(page));
  }
  return chrome.tabs.create({ url: target.href });
}
