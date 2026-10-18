import { useStore } from '../state/store';
import { LOCALE_OPTIONS, t, type Locale } from '../i18n';

/** Limba, vizibilă de la primul ecran. Cinci opțiuni, nu un comutator de două. */
export function LocaleToggle() {
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const tr = (key: string) => t(locale, key);

  return (
    <select
      className="locale-select"
      aria-label={tr('menu.language.title')}
      title={tr('menu.language.title')}
      value={locale}
      onChange={event => setLocale(event.target.value as Locale)}
    >
      {LOCALE_OPTIONS.map(option => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  );
}
