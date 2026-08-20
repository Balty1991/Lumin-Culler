import type { CSSProperties } from 'react';

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
}

export function EditSlider({ label, value, min, max, onChange, display }: EditSliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="edit-slider-row" style={{ '--fill': `${pct}%` } as CSSProperties}>
      <span className="edit-slider-label" aria-hidden="true">{label}</span>
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
