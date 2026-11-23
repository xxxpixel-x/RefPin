import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ScannedPaper } from '../../engine/parsePaper';
import type { OcrProgress } from '../../engine/ocrFallback';
import { useI18n } from '../../i18n';
import { useReaderStore } from '../../store/useReaderStore';

interface Props {
  doc: PDFDocumentProxy;
  paper: ScannedPaper;
  documentSignal: AbortSignal;
  onComplete: (recognized: number, total: number) => void;
}

export function OcrBanner({ doc, paper, documentSignal, onComplete }: Props) {
  const { t } = useI18n();
  const active = useRef<AbortController | null>(null);
  const total = useRef(paper.pending.size);
  const recognized = useRef(0);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [notice, setNotice] = useState<'ocr.cancelled' | 'ocr.modelsFailed' | 'ocr.failed' | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  async function start() {
    if (active.current || documentSignal.aborted) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    const cancel = () => controller.abort();
    documentSignal.addEventListener('abort', cancel, { once: true });
    let preparingModels = true;
    setNotice(null);
    setProgress({ stage: 'models', percent: 0 });
    try {
      const { recognizeScannedPages } = await import('../../engine/ocrFallback');
      await recognizeScannedPages(doc, {
        signal, pages: [...paper.pending], currentPage: () => useReaderStore.getState().currentPage,
        onProgress: update => {
          if (signal.aborted) return;
          preparingModels = update.stage === 'models';
          setProgress(update);
        },
        onPage: async (page, lines) => {
          const result = await paper.applyPage(page, lines, signal);
          signal.throwIfAborted();
          useReaderStore.getState().setParseResult(result);
          if (lines.length) recognized.current++;
        },
      });
      if (!signal.aborted) onComplete(recognized.current, total.current);
    } catch {
      if (!documentSignal.aborted) setNotice(signal.aborted ? 'ocr.cancelled' : preparingModels ? 'ocr.modelsFailed' : 'ocr.failed');
    } finally {
      documentSignal.removeEventListener('abort', cancel);
      active.current = null;
      if (!documentSignal.aborted) setProgress(null);
    }
  }

  let status = t('reader.scanned', { count: paper.pending.size });
  if (notice) status = t(notice, { count: paper.pending.size });
  if (progress?.stage === 'models') status = t('ocr.models', { percent: progress.percent });
  if (progress?.stage === 'initializing') status = t('ocr.initializing');
  if (progress?.stage === 'page') status = t('ocr.page', { page: progress.page, percent: progress.percent,
    done: total.current - paper.pending.size, total: total.current });
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-paper-border bg-paper-card px-4 py-2 text-xs text-paper-ink">
    <span role="status">{status}</span>
    <button type="button" className="rounded border border-paper-goldborder bg-paper-goldbg px-2.5 py-1 font-medium"
      onClick={progress ? () => active.current?.abort() : start}>
      {t(progress ? 'common.cancel' : notice ? 'ocr.resume' : 'ocr.start')}
    </button>
  </div>;
}
