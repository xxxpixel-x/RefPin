import { useEffect, useId, useRef, useState } from 'react';
import { IS_EXTENSION_PAGE } from '../../config/runtime';
import { formatMessage, LocalizedError, message, useI18n, type DisplayMessage } from '../../i18n';
import { createReadingBackup, MAX_BACKUP_BYTES, parseReadingBackup, type ParsedReadingBackup } from '../../storage/readingBackup';
import type { BackupAction } from './SettingsMenu';

interface Props {
  action: BackupAction;
  onClose: () => void;
  onBeforeExport: () => Promise<void>;
  onImport: (backup: ParsedReadingBackup) => Promise<DisplayMessage>;
}

export function ReadingBackupDialog({ action, onClose, onBeforeExport, onImport }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [includeKey, setIncludeKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage>();
  const [result, setResult] = useState<DisplayMessage>();
  const exporting = action === 'export';
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function run(file?: File) {
    setBusy(true);
    setError(undefined);
    try {
      if (file) {
        if (file.size > MAX_BACKUP_BYTES) throw new LocalizedError(message('backup.tooLarge'));
        setResult(await onImport(parseReadingBackup(await file.text())));
      } else {
        await onBeforeExport();
        const backup = await createReadingBackup(includeKey);
        const date = new Date(backup.exportedAt);
        const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('');
        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
        if (blob.size > MAX_BACKUP_BYTES) throw new LocalizedError(message('backup.tooLarge'));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'refpin-backup-' + stamp + '.json';
        document.body.append(link);
        try { link.click(); } finally {
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        onClose();
      }
    } catch (err) {
      setError(err instanceof LocalizedError ? err.uiMessage : message(exporting ? 'backup.exportFailed' : 'backup.importFailed'));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    className="w-[min(26rem,90vw)] rounded-xl border border-paper-border bg-paper-card p-5 text-sm text-paper-ink shadow-float backdrop:bg-black/40">
    <h2 id={titleId} className="font-semibold">{t(exporting ? 'backup.export' : 'backup.import')}</h2>
    {result ? <p role="status" className="mt-3">{formatMessage(result)}</p> : <>
      <p className="mt-2 text-xs leading-relaxed text-paper-muted">{t(exporting ? 'backup.exportHint' : 'backup.importHint')}</p>
      {exporting && <>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeKey} disabled={busy || IS_EXTENSION_PAGE} className="accent-paper-gold"
            onChange={event => setIncludeKey(event.target.checked)} />{t('backup.includeKey')}
        </label>
        {IS_EXTENSION_PAGE && <p className="mt-2 text-xs text-paper-muted">{t('backup.extensionConfig')}</p>}
        {includeKey && <p role="alert" className="mt-2 rounded-md bg-paper-goldbg p-2 text-xs text-paper-goldtext">{t('backup.keyRisk')}</p>}
      </>}
    </>}
    {error && <p role="alert" className="mt-3 text-xs text-paper-ink">{formatMessage(error)}</p>}
    <div className="mt-5 flex justify-end gap-2 text-xs">
      <button type="button" disabled={busy} onClick={onClose}
        className="rounded-md border border-paper-border px-3 py-2 hover:bg-paper-bg">{t(result ? 'common.close' : 'common.cancel')}</button>
      {!result && <button type="button" disabled={busy}
        onClick={() => exporting ? void run() : fileInput.current?.click()}
        className="rounded-md bg-paper-ink px-3 py-2 font-medium text-paper-card disabled:opacity-60">
        {t(busy ? 'backup.working' : exporting ? 'backup.download' : 'backup.choose')}
      </button>}
    </div>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void run(file);
    }} />
  </dialog>;
}
