import type { CSSProperties } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';

/**
 * ui/EditSlider.tsx
 * Un rand de slider din editor. Exista ca sa fie UN SINGUR loc unde se decide
 * cum arata si cum se manevreaza un slider — inainte, acelasi bloc era copiat
 * in trei locuri (ajustari de baza, punct de control, pensula de vindecare),
 * si orice imbunatatire trebuia facuta de trei ori.
 *
 * `--fill` e procentul deja parcurs, trimis in CSS. Bara si-o deseneaza singura
 * (vezi .edit-slider-row input in styles.css) tocmai ca sa poata avea o bulina
 * mare, de prins cu degetul: `accent-color`, care colora portiunea parcursa
 * automat, functioneaza doar cat timp sliderul ramane cel desenat de sistem,
 * iar acela vine cu o bulina de ~16px. Feedback direct de pe telefon:
 * sliderele erau greu de apucat.
 */
export interface EditSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Ce se afiseaza langa nume, daca difera de valoarea bruta (ex. raza in procente). */
  display?: string | number;
  /**
   * Valoarea de la care porneste sliderul. Cand e data si valoarea curenta
   * difera de ea, numele devine buton: o apasare readuce sliderul acolo.
   *
   * De ce era nevoie: un slider dus prea departe se aducea inapoi la zero prin
   * tragere fina cu degetul, pe o bara de cateva sute de pixeli — pe telefon,
   * nimereai 1 sau -2, aproape niciodata exact 0. Orice editor serios are un
   * gest de anulare per unealta, tocmai fiindca reglajul e prin incercari.
   */
  neutral?: number;
}

export function EditSlider({ label, value, min, max, onChange, display, neutral }: EditSliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const canReset = neutral !== undefined && value !== neutral;
  // Reperul de zero: pe un slider bipolar, mijlocul nu e evident cu ochiul.
  const neutralPct = neutral !== undefined && max > min ? ((neutral - min) / (max - min)) * 100 : null;
  const locale = useStore(s => s.locale);
  const resetLabel = t(locale, 'edit.slider.reset', { name: label });
  return (
    <label
      className={canReset ? 'edit-slider-row touched' : 'edit-slider-row'}
      style={{ '--fill': `${pct}%`, ...(neutralPct !== null ? { '--neutral': `${neutralPct}%` } : {}) } as CSSProperties}
    >
      {canReset ? (
        <button
          type="button"
          className="edit-slider-label edit-slider-reset"
          onClick={e => { e.preventDefault(); onChange(neutral!); }}
          title={resetLabel}
          aria-label={resetLabel}
        >
          {label}
        </button>
      ) : (
        <span className="edit-slider-label" aria-hidden="true">{label}</span>
      )}
      <span className="edit-slider-value mono" aria-hidden="true">{display ?? value}</span>
      <input
        type="range" min={min} max={max} step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        // Bug real gasit de auditul QA: label-ul invaluia si numele SI valoarea,
        // deci numele accesibil calculat le includea pe amandoua, iar cititorul
        // de ecran anunta valoarea a doua oara (nativ, la fiecare schimbare).
        aria-label={label}
      />
    </label>
  );
}
