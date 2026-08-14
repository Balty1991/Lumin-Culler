import { useRef, useState, type KeyboardEvent } from 'react';
import { StarIcon } from './icons';
import { useStore } from '../state/store';
import { t } from '../i18n';

const STARS = [1, 2, 3, 4, 5];

/**
 * Rating 1-5 stele — axa separata de decizia pick/respinge (ca in Lightroom).
 * Click pe steaua deja setata o sterge (revine la 0), nu doar o reconfirma.
 *
 * Tiparul ARIA de radiogroup era pornit pe jumatate — bug real gasit de auditul
 * UI, aceeasi clasa cu cel din PhotoInfoTabs: existau `role="radiogroup"` si
 * `role="radio"`, deci un cititor de ecran anunta "buton radio, 3 din 5" si
 * promitea navigare cu sagetile, dar:
 *   - sagetile nu faceau nimic (niciun handler);
 *   - toate cele 5 stele erau opriri separate de Tab, in loc de UNA singura
 *     (tabindex rulant), deci pe tastatura trebuia sa treci prin fiecare stea
 *     ca sa iesi din grup — de doua ori pe ecran (DetailView si Workspace au
 *     fiecare cate un rand de stele);
 *   - comportamentul de STERGERE la reapasare (specific acestui control, nu al
 *     unui radiogroup obisnuit) nu era anuntat nicaieri, deci un utilizator de
 *     cititor de ecran nu avea nicio cale sa afle ca poate reveni la "fara nota".
 */
export function StarRating({ rating, onRate, size = 'md' }: {
  rating: number;
  onRate: (n: number) => void;
  size?: 'sm' | 'md';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? rating;
  const locale = useStore(s => s.locale);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Singura oprire de Tab din grup: steaua selectata, sau prima cand nu exista
   * inca nicio nota (regula standard pentru un radiogroup gol).
   */
  const tabStop = rating >= 1 && rating <= 5 ? rating : 1;

  const focusStar = (n: number) => {
    onRate(n);
    btnRefs.current[n - 1]?.focus();
  };

  /**
   * stopPropagation e ESENTIAL, nu politete: DetailView si Workspace asculta
   * Sagetile pe `window` ca sa treaca la poza urmatoare/precedenta. Fara ea, o
   * sageata apasata cu focusul pe stele ar schimba nota SI ar sari la alta poza
   * in acelasi timp — utilizatorul ar vedea nota aplicata pe un cadru pe care
   * nu-l mai are in fata.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    let next: number;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = n === 5 ? 1 : n + 1; break;
      case 'ArrowLeft': case 'ArrowDown': next = n === 1 ? 5 : n - 1; break;
      case 'Home': next = 1; break;
      case 'End': next = 5; break;
      default: return;
    }
    // Doar dupa ce stim ca era o tasta de navigare — altfel am inghiti Tab-ul,
    // adica exact iesirea din grup.
    e.preventDefault();
    e.stopPropagation();
    focusStar(next);
  };

  return (
    <div
      className={`star-rating star-rating-${size}`}
      onMouseLeave={() => setHover(null)}
      role="radiogroup"
      aria-label={t(locale, 'starRating.ariaLabel')}
    >
      {STARS.map(n => {
        const checked = rating === n;
        const base = t(locale, n > 1 ? 'starRating.stars' : 'starRating.star', { n });
        return (
          <button
            key={n}
            ref={el => { btnRefs.current[n - 1] = el; }}
            type="button"
            className="star-rating-btn"
            role="radio"
            aria-checked={checked}
            tabIndex={n === tabStop ? 0 : -1}
            // Sufixul apare DOAR pe steaua deja selectata: acolo apasarea chiar
            // sterge nota, iar pe celelalte anuntul ar fi fals.
            aria-label={checked ? `${base}, ${t(locale, 'starRating.clearHint')}` : base}
            onMouseEnter={() => setHover(n)}
            onKeyDown={e => onKeyDown(e, n)}
            onClick={() => onRate(checked ? 0 : n)}
          >
            <StarIcon fill={n <= display ? 'currentColor' : 'none'} />
          </button>
        );
      })}
    </div>
  );
}
