import { useRef, useState } from 'react';
import {
  ArrowRight,
  Columns3,
  FileText,
  MousePointerClick,
  ShieldCheck,
  Upload,
} from 'lucide-react';
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
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-3xl">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paper-ink text-[13px] font-semibold text-white">
              R
            </span>
            <span className="text-sm font-semibold tracking-tight text-paper-ink">
              RefPin <span className="font-normal text-paper-muted">· 浮页</span>
            </span>
          </div>
          <span className="rounded-full border border-paper-goldborder bg-paper-goldbg px-3 py-1 text-[11px] text-paper-goldtext">
            sands in shoes · 为科研去除来回翻页的摩擦
          </span>
        </div>

        <div className="text-center">
          <h1 className="text-[34px] font-semibold leading-[1.25] tracking-tight text-paper-ink">
            读论文，再也不用为看图来回翻页。
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-paper-muted">
            鼠标停在 <span className="rounded bg-paper-goldbg px-1 font-medium text-paper-goldtext">Fig. 2</span>{' '}
            或{' '}
            <span className="rounded bg-paper-goldbg px-1 font-medium text-paper-goldtext">[14]</span>{' '}
            上，图表与文献立刻浮在眼前；点一下钉在侧边，视线一毫米不离开当前行。
          </p>
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
            'group mt-10 flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed bg-white px-8 py-12 shadow-paper transition-all',
            dragging
              ? '-translate-y-0.5 border-paper-gold bg-paper-goldbg'
              : 'border-paper-border hover:-translate-y-0.5 hover:border-amber-300',
          )}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-paper-bg text-paper-muted transition group-hover:bg-paper-goldbg group-hover:text-paper-gold">
            <Upload className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium text-paper-ink">
            点击选择，或把 PDF 拖到这里
          </span>
          <span className="text-xs text-paper-muted">
            100% 浏览器本地解析 · 论文不上传任何服务器
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
          <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-center text-xs text-red-600">
            {error}
          </p>
        )}

        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-paper-muted">
            <span className="h-px flex-1 bg-paper-border" />
            一键试读示例
            <span className="h-px flex-1 bg-paper-border" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => onSelectSample(sample)}
                className="group flex items-start gap-3 rounded-xl border border-paper-border bg-white px-4 py-3.5 text-left shadow-paper transition hover:-translate-y-0.5 hover:border-amber-300"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-goldbg text-paper-gold">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-paper-ink">
                      {sample.title}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-paper-muted transition group-hover:translate-x-0.5 group-hover:text-paper-gold" />
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-paper-muted">
                    {sample.subtitle}
                  </span>
                  <span className="mt-1.5 inline-block rounded border border-paper-goldborder bg-paper-goldbg px-1.5 py-0.5 text-[10px] text-paper-goldtext">
                    {sample.badge}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] text-paper-muted">
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="h-3.5 w-3.5" /> 零跳转悬停预览
          </span>
          <span className="flex items-center gap-1.5">
            <Columns3 className="h-3.5 w-3.5" /> 右侧多图对照钉板
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> 断网可用 · 隐私零上传
          </span>
        </div>
      </div>
    </div>
  );
}
