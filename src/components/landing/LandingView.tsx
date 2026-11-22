import { RemotePaperInput } from './RemotePaperInput';
import { ThemeSwitcher } from '../layout/ThemeSwitcher';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { getLocale, t } from '../../i18n/core';
import { useRef, useState } from 'react';
import { ArrowRight, FileText, Pin, Upload, X } from 'lucide-react';
import clsx from 'clsx';
import type { PaperArchive, SamplePaperMeta } from '../../types/paper';

interface LandingViewProps {
  initialArxiv?: string;
  onConsumeLink?: () => void;
  samples: SamplePaperMeta[];
  onOpenFile: (file: File) => void;
  onSelectSample: (sample: SamplePaperMeta) => void;
  error?: string | null;
  recent?: PaperArchive[];
  onOpenRecent?: (entry: PaperArchive) => void;
  onRemoveRecent?: (hash: string) => void;
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes === 0) return t('time.now');
  const relative = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'always' });
  if (minutes < 60) return relative.format(-minutes, 'minute');
  if (minutes < 1440) return relative.format(-Math.floor(minutes / 60), 'hour');
  return relative.format(-Math.floor(minutes / 1440), 'day');
}

export function LandingView({
  initialArxiv,
  onConsumeLink,
  samples,
  onOpenFile,
  onSelectSample,
  error,
  recent = [],
  onOpenRecent,
  onRemoveRecent,
}: LandingViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [requestedFile, setRequestedFile] = useState('');

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="absolute right-4 top-4 flex items-center gap-2"><ThemeSwitcher /><LanguageToggle /></div>
      <div className="w-full max-w-xl">
        <h1 className="mb-1 flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paper-ink text-[13px] font-semibold text-paper-card">
            R
          </span>
          <span className="text-base font-semibold tracking-tight text-paper-ink">
            {t('brand.name')}
          </span>
        </h1>
        <p className="mx-auto mb-7 mt-2 max-w-md text-center text-sm leading-relaxed text-paper-muted">{t('landing.features')}</p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onOpenFile(file);
          }}
          className={clsx(
            'group flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed bg-paper-card px-8 py-14 shadow-paper transition-all',
            dragging
              ? '-translate-y-0.5 border-paper-gold bg-paper-goldbg'
              : 'border-paper-border hover:-translate-y-0.5 hover:border-paper-gold',
          )}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-paper-bg text-paper-muted transition group-hover:bg-paper-goldbg group-hover:text-paper-gold">
            <Upload className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium text-paper-ink">
            {t('landing.drop')}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onOpenFile(file);
            event.target.value = '';
          }}
        />

        <RemotePaperInput initialArxiv={initialArxiv} onConsumeLink={onConsumeLink} onOpenFile={onOpenFile} />
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-paper-goldborder bg-paper-goldbg px-3 py-2 text-center text-xs text-paper-ink">
            {error}
          </p>
        )}
        {requestedFile && <p role="status" className="mt-3 text-center text-xs leading-relaxed text-paper-muted">{t('archive.reselectHint', { name: requestedFile })}</p>}

        {samples.length > 0 && (
          <section aria-label={t('landing.samples')} className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => onSelectSample(sample)}
                className="group flex items-center gap-2.5 rounded-xl border border-paper-border bg-paper-card px-3.5 py-3 text-left shadow-paper transition hover:-translate-y-0.5 hover:border-paper-gold"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paper-goldbg text-paper-gold">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 text-xs font-medium text-paper-ink">
                  <span className="block truncate">{sample.title}</span>
                  <span className="mt-0.5 block truncate font-normal text-paper-muted">{sample.subtitle}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-paper-muted transition group-hover:translate-x-0.5 group-hover:text-paper-gold" />
              </button>
            ))}
          </section>
        )}
        {recent.length > 0 && (
          <section aria-labelledby="recent-papers" className="mt-8">
            <h2 id="recent-papers" className="mb-3 text-sm font-medium text-paper-ink">
              {t('archive.title')}
            </h2>
            <ul className="divide-y divide-paper-border rounded-xl border border-paper-border bg-paper-card">
              {recent.map(entry => {
                const sample = samples.find(sample => sample.id === entry.sampleId);
                return <li key={entry.paperHash} className="flex items-center gap-2 px-3">
                  <button type="button" className="group flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                    onClick={() => {
                      if (sample || entry.hasCachedPdf) onOpenRecent?.(entry);
                      else {
                        setRequestedFile(entry.fileName);
                        inputRef.current?.click();
                      }
                    }}>
                    <FileText size={17} className="shrink-0 text-paper-muted group-hover:text-paper-gold" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-paper-ink" title={sample?.title ?? entry.fileName}>{sample?.title ?? entry.fileName}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper-muted">
                        <span className="tabular-nums">{t('reader.pageOf', { page: entry.lastPage, total: entry.numPages })}</span>
                        <span aria-label={t('archive.pinCount', { count: entry.pinnedItems.length })} className="inline-flex items-center gap-1 rounded bg-paper-bg px-1.5">
                          <Pin size={10} />{entry.pinnedItems.length}
                        </span>
                        {!sample && !entry.hasCachedPdf && <span>{t('archive.reselect')}</span>}
                      </span>
                    </span>
                    <time dateTime={new Date(entry.lastOpenedAt).toISOString()} className="shrink-0 text-xs text-paper-muted">{relativeTime(entry.lastOpenedAt)}</time>
                  </button>
                  <button type="button" aria-label={t('archive.removeName', { name: entry.fileName })} title={t('archive.remove')}
                    className="rounded p-1.5 text-paper-muted hover:bg-paper-bg hover:text-paper-ink"
                    onClick={() => onRemoveRecent?.(entry.paperHash)}><X size={14} /></button>
                </li>;
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
