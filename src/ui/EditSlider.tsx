import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  /**
   * Apelat la FIECARE miscare a degetului, pentru previzualizarea live. Cand e
   * dat, sliderul isi tine singur valoarea cat timp e tras, iar `onChange` se
   * cheama o singura data, la ridicarea degetului.
   *
   * De ce: fara asta, fiecare eveniment de miscare urca valoarea in starea
   * panoului de editare, care re-randeaza TOT (poza, cele treisprezece slidere,
   * stilurile, bara de unelte) inainte sa apuce sa deseneze ceva. Profilat pe un
   * drag de 40 de pasi: 11 cadre din 53 treceau de 33ms, adica sub 30 de cadre
   * pe secunda — exact senzatia de sacadat. Asa, in timpul tragerii se
   * re-randeaza doar sliderul asta, iar poza se deseneaza direct din valoarea
   * primita, fara drum prin React.
   */
  onLive?: (value: number) => void;
}

export function EditSlider({ label, value, min, max, onChange, display, neutral, onLive }: EditSliderProps) {
  /** Valoarea aratata: a noastra cat timp degetul e pe slider, a panoului in rest. */
  const [dragValue, setDragValue] = useState<number | null>(null);
  const draggingRef = useRef(false);
  // O schimbare venita din afara (Auto, un stil, Reseteaza) trebuie sa se vada
  // imediat, chiar daca degetul tocmai a lasat sliderul.
  useEffect(() => { if (!draggingRef.current) setDragValue(null); }, [value]);
  const shown = dragValue ?? value;
  const commit = (next: number) => {
    draggingRef.current = false;
    gestureRef.current = null;
    setDragValue(null);
    onChange(next);
  };

  /**
   * Bug real raportat de utilizator: "cand dau cu degetul sa derulez la
   * celelalte slidere, se activeaza cand ating ecranul".
   *
   * Un input de tip range ia in primire orice atingere care cade pe el si muta
   * bulina acolo — inclusiv atingerea cu care omul voia doar sa deruleze lista
   * in jos. Rezultatul: nu puteai ajunge la sliderele de dedesubt fara sa
   * strici valoarea celui peste care ai trecut.
   *
   * Solutia e cea din editoarele mari, si nu cere niciun buton in plus:
   * gestul se judeca dupa DIRECTIE. Pe verticala e derulare — sliderul isi pune
   * inapoi valoarea de la inceputul gestului si nu mai asculta pana la
   * ridicarea degetului. Pe orizontala e reglaj. `touch-action: pan-y` (vezi
   * styles) lasa browserul sa deruleze mai departe in acelasi timp.
   */
  const gestureRef = useRef<{ x: number; y: number; startValue: number; axis: 'nedecis' | 'orizontal' | 'derulare' } | null>(null);
  /** Cat trebuie sa se miste degetul ca directia sa fie clara (px). */
  const AXIS_LOCK_PX = 6;
  const pct = max > min ? ((shown - min) / (max - min)) * 100 : 0;
  const canReset = neutral !== undefined && shown !== neutral;
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
          onClick={e => { e.preventDefault(); commit(neutral!); }}
          title={resetLabel}
          aria-label={resetLabel}
        >
          {label}
        </button>
      ) : (
        <span className="edit-slider-label" aria-hidden="true">{label}</span>
      )}
      <span className="edit-slider-value mono" aria-hidden="true">{display ?? shown}</span>
      <input
        type="range" min={min} max={max} step={1}
        value={shown}
        onPointerDown={e => {
          gestureRef.current = { x: e.clientX, y: e.clientY, startValue: shown, axis: 'nedecis' };
        }}
        onPointerMove={e => {
          const g = gestureRef.current;
          if (!g || g.axis !== 'nedecis') return;
          const dx = Math.abs(e.clientX - g.x);
          const dy = Math.abs(e.clientY - g.y);
          if (dx < AXIS_LOCK_PX && dy < AXIS_LOCK_PX) return;
          g.axis = dy > dx ? 'derulare' : 'orizontal';
          if (g.axis === 'derulare') {
            // Atingerea de start a mutat deja bulina — o punem la loc.
            draggingRef.current = false;
            setDragValue(null);
            onLive?.(g.startValue);
          }
        }}
        onChange={e => {
          const next = Number(e.target.value);
          // Degetul deruleaza lista, nu regleaza sliderul: valoarea nu se schimba.
          if (gestureRef.current?.axis === 'derulare') return;
          if (!onLive) { onChange(next); return; }
          draggingRef.current = true;
          setDragValue(next);
          onLive(next);
        }}
        // Ridicarea degetului (sau iesirea din camp) e momentul in care valoarea
        // urca in starea panoului si se scrie in baza — o singura data per gest.
        onPointerUp={e => {
          if (onLive && draggingRef.current) commit(Number((e.target as HTMLInputElement).value));
          gestureRef.current = null;
        }}
        onPointerCancel={() => {
          // Browserul a preluat gestul pentru derulare: valoarea se intoarce de
          // unde a plecat, ca si cum degetul n-ar fi atins niciodata sliderul.
          const g = gestureRef.current;
          if (g && draggingRef.current) { draggingRef.current = false; setDragValue(null); onLive?.(g.startValue); }
          gestureRef.current = null;
        }}
        onBlur={e => { if (onLive && draggingRef.current) commit(Number(e.target.value)); }}
        // Tastatura nu genereaza pointerup: acolo fiecare apasare e deja finala.
        onKeyUp={e => { if (onLive && draggingRef.current) commit(Number((e.target as HTMLInputElement).value)); }}
        // Bug real gasit de auditul QA: label-ul invaluia si numele SI valoarea,
        // deci numele accesibil calculat le includea pe amandoua, iar cititorul
        // de ecran anunta valoarea a doua oara (nativ, la fiecare schimbare).
        aria-label={label}
      />
    </label>
  );
}
