import { BookOpen, Moon, Sun } from 'lucide-react';
import { useReaderStore } from '../../store/useReaderStore';
import { useI18n } from '../../i18n';

const themes = [['light', Sun], ['sepia', BookOpen], ['dark', Moon]] as const;

export function ThemeSwitcher() {
  const theme = useReaderStore(state => state.theme);
  const { t } = useI18n();
  return <div role="group" aria-label={t('theme.choose')} className="inline-flex shrink-0 gap-0.5 rounded-lg border border-paper-border bg-paper-card p-0.5">
    {themes.map(([value, Icon]) => <button key={value} type="button" aria-pressed={value === theme}
      title={t(`theme.${value}`)} aria-label={t(`theme.${value}`)}
      onClick={() => useReaderStore.getState().setTheme(value)}
      className="rounded p-1 text-paper-muted hover:bg-paper-bg aria-pressed:bg-paper-goldbg aria-pressed:text-paper-goldtext">
      <Icon size={13} />
    </button>)}
  </div>;
}
