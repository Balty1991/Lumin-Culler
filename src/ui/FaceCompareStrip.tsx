import { FaceCropThumb } from './FaceCropThumb';
import { bestFrameForRow, type StripRow } from '../core/faceStrip';
import { EyeClosedIcon, RibbonIcon } from './icons';
import { t, type Locale } from '../i18n';

/**
 * Fasia de comparatie a fetelor: cate un RAND per persoana, cu decupajul ei din
 * fiecare cadru al seriei, in aceeasi ordine.
 *
 * Cu cadrele intregi puse unul langa altul, ca sa raspunzi la "cine clipeste"
 * trebuie sa cauti aceeasi fata in fiecare poza, la alta pozitie si alta marime
 * de fiecare data. Pe randuri, raspunsul e vizibil fara sa cauti nimic.
 *
 * Nu se recalculeaza nimic si nu se re-decodeaza niciun original: cutiile
 * fetelor vin din analiza deja facuta, iar decupajele se taie din miniaturile
 * deja generate.
 */
export function FaceCompareStrip({ rows, locale, onPick, selectedId }: {
  rows: StripRow[];
  locale: Locale;
  /** Tap pe un decupaj = du-te la cadrul acela. */
  onPick: (photoId: string) => void;
  selectedId?: string | null;
}) {
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  if (!rows.length) return null;

  return (
    <section className="face-strip" aria-label={tr('faceStrip.title')}>
      <div className="face-strip-head">
        <h4>{tr('faceStrip.title')}</h4>
        <p className="hint">{tr('faceStrip.hint')}</p>
      </div>
      {rows.map(row => {
        const best = bestFrameForRow(row);
        return (
          <div key={row.key} className="face-strip-row">
            <div className="face-strip-label">
              <span className="face-strip-name">
                {row.personName ?? tr('faceStrip.unknownPerson')}
              </span>
              <span className="face-strip-note mono">
                {row.blinkCount > 0
                  ? tr('faceStrip.blinksIn', { count: row.blinkCount })
                  : tr('faceStrip.allOpen')}
                {/* Cand legatura intre cadre s-a facut doar dupa pozitie, spunem
                    asta: daca oamenii s-au mutat mult intre cadre, randul poate
                    amesteca doua persoane, si e mai bine sa se stie. */}
                {row.match === 'position' && ` · ${tr('faceStrip.byPosition')}`}
              </span>
            </div>
            <div className="face-strip-cells">
              {row.cells.map(cell => (
                cell.face ? (
                  <button
                    key={cell.photoId}
                    type="button"
                    className={
                      'face-strip-cell'
                      + (cell.face.isBlinking ? ' blinking' : '')
                      + (cell.photoId === best ? ' best' : '')
                      + (cell.photoId === selectedId ? ' selected' : '')
                    }
                    onClick={() => onPick(cell.photoId)}
                    aria-label={tr(
                      cell.face.isBlinking ? 'faceStrip.cell.blinking' : 'faceStrip.cell.open',
                      { person: row.personName ?? tr('faceStrip.unknownPerson'), frame: cell.label }
                    )}
                  >
                    <FaceCropThumb photoId={cell.photoId} box={cell.face.box} size={64} className="face-strip-crop" />
                    <span className="face-strip-frame mono" aria-hidden="true">{cell.label}</span>
                    {cell.face.isBlinking && (
                      <span className="face-strip-flag blink" aria-hidden="true"><EyeClosedIcon /></span>
                    )}
                    {cell.photoId === best && !cell.face.isBlinking && (
                      <span className="face-strip-flag best" aria-hidden="true"><RibbonIcon /></span>
                    )}
                  </button>
                ) : (
                  // Celula goala, nu celula lipsa: randul trebuie sa ramana
                  // aliniat cu celelalte, altfel comparatia pe coloane se rupe.
                  <span
                    key={cell.photoId}
                    className="face-strip-cell empty"
                    title={tr('faceStrip.cell.absent', { frame: cell.label })}
                  >
                    <span className="face-strip-frame mono" aria-hidden="true">{cell.label}</span>
                  </span>
                )
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
