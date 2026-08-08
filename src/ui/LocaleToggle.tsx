import { useStore } from '../state/store';
import { GlobeIcon } from './icons';
import { Tooltip } from './Tooltip';
import { t } from '../i18n';

/**
 * Comutator RO/EN reutilizabil — cerinta directa a utilizatorului: selectorul
 * de limba trebuie vazut DE LA INCEPUT (ecranul de bun venit, ecranul gol
 * dinainte de orice import), nu doar ingropat in meniul lateral (unde ramane
 * si el, neschimbat) — un utilizator strain care nimereste interfata in
 * romana n-ar avea altfel niciun indiciu vizibil ca poate schimba limba
 * inainte sa exploreze tot meniul.
 */
export function LocaleToggle({ side = 'left' }: { side?: 'left' | 'bottom' }) {
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const tr = (key: string) => t(locale, key);

  return (
    <Tooltip label={tr('menu.language.title')} side={side}>
      <button
        className="ghost icon-btn"
        onClick={() => setLocale(locale === 'ro' ? 'en' : 'ro')}
        aria-label={tr('menu.language.title')}
      >
        <GlobeIcon />
      </button>
    </Tooltip>
  );
}
