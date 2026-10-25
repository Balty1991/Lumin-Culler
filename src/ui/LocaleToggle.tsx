import { useStore } from '../state/store';
import { t } from '../i18n';
import type { Locale } from '../i18n';

/**
 * Comutator RO/EN — cerinta directa a utilizatorului: pe ecranul de bun venit
 * (inainte ca cineva sa apuce sa deschida meniul lateral, unde exista deja un
 * comutator separat, neschimbat), trebuie sa fie clar DE LA PRIMA PRIVIRE ca
 * exact 2 limbi sunt disponibile — un glob generic nu spune asta. Doua
 * segmente text ("RO"/"EN"), cel activ evidentiat, comunica exact atat cate
 * optiuni exista, fara sa mai fie nevoie de vreo iconita separata.
 */
export function LocaleToggle() {
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const tr = (key: string) => t(locale, key);

  const option = (value: Locale, label: string) => (
    <button
      type="button"
      className={locale === value ? 'locale-toggle-option active' : 'locale-toggle-option'}
      onClick={() => setLocale(value)}
      aria-pressed={locale === value}
    >
      {label}
    </button>
  );

  return (
    <div className="locale-toggle" role="group" aria-label={tr('menu.language.title')} title={tr('menu.language.title')}>
      {option('ro', 'RO')}
      {option('en', 'EN')}
    </div>
  );
}
