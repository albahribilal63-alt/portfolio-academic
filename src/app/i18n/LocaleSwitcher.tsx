import { useLocale } from './LocaleProvider';

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useLocale();

  return (
    <label className="locale-switcher">
      <span className="sr-only">{t('Language')}</span>
      <select aria-label={t('Language')} onChange={(event) => setLocale(event.target.value as 'ar' | 'fr')} value={locale}>
        <option value="ar">العربية</option>
        <option value="fr">Français</option>
      </select>
    </label>
  );
}