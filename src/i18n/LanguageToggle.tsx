import { useI18n } from './index';

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button type="button" aria-label={t('language.switch')} title={t('language.switch')}
      onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-paper-border bg-paper-card px-1.5 py-1 text-[10px] text-paper-muted hover:border-paper-gold">
      <span lang="en" className={locale === 'en' ? 'font-semibold text-paper-ink' : ''}>EN</span>
      <span aria-hidden="true">/</span>
      <span lang="zh-CN" className={locale === 'zh-CN' ? 'font-semibold text-paper-ink' : ''}>中文</span>
    </button>
  );
}
