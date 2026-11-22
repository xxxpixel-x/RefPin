import { useRef, useState } from 'react';
import { ArrowRight, FileText, Upload } from 'lucide-react';
import clsx from 'clsx';
import type { SamplePaperMeta } from '../../types/paper';

interface LandingViewProps {
  samples: SamplePaperMeta[];
  onOpenFile: (file: File) => void;
  onSelectSample: (sample: SamplePaperMeta) => void;
  error?: string | null;
}

export function LandingView({
  samples,
  onOpenFile,
  onSelectSample,
  error,
}: LandingViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paper-ink text-[13px] font-semibold text-white">
            R
          </span>
          <span className="text-base font-semibold tracking-tight text-paper-ink">
            RefPin <span className="font-normal text-paper-muted">· 浮页</span>
          </span>
        </div>

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
            'group flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed bg-white px-8 py-14 shadow-paper transition-all',
            dragging
              ? '-translate-y-0.5 border-paper-gold bg-paper-goldbg'
              : 'border-paper-border hover:-translate-y-0.5 hover:border-amber-300',
          )}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-paper-bg text-paper-muted transition group-hover:bg-paper-goldbg group-hover:text-paper-gold">
            <Upload className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium text-paper-ink">
            选择或拖入 PDF
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

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-paper-goldborder bg-paper-goldbg px-3 py-2 text-center text-xs text-paper-ink">
            {error}
          </p>
        )}

        {samples.length > 0 && (
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => onSelectSample(sample)}
                className="group flex items-center gap-2.5 rounded-xl border border-paper-border bg-white px-3.5 py-3 text-left shadow-paper transition hover:-translate-y-0.5 hover:border-amber-300"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paper-goldbg text-paper-gold">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-paper-ink">
                  {sample.title}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-paper-muted transition group-hover:translate-x-0.5 group-hover:text-paper-gold" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
