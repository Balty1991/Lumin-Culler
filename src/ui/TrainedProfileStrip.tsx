import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { SparkleIcon } from './icons';
import { t } from '../i18n';

/**
 * ui/TrainedProfileStrip.tsx
 * Cât te cunoaște motorul — și faptul că asta trăiește pe un singur telefon.
 *
 * De ce merita loc, si inca in capul meniului: dintre toate lucrurile pe care le
 * are aplicatia, profilul antrenat e singurul care NU se poate reface. Pozele
 * sunt tot in galerie. Setarile se pun in doua minute. Cele cateva sute de
 * decizii din care motorul a invatat ce alegi tu nu exista nicaieri altundeva si
 * nu se pot reconstitui — se pot doar reface, o poza la un moment dat.
 *
 * Pana acum, valoarea asta se acumula complet nevazuta: singurul loc unde
 * aparea era un panou de preferinte pe care trebuie sa-l cauti. Un lucru
 * valoros pe care nu-l vezi crescand nu se simte valoros.
 *
 * PRAGURI, ca sa nu fie o afirmatie goala: pana la MIN_TO_SHOW decizii, "motorul
 * te cunoaste din 3 decizii" ar fi ridicol si ar strica exact increderea pe care
 * incearca s-o construiasca. Sub prag, componenta tace complet.
 *
 * Ce NU face: nu ascunde salvarea profilului in spatele unui abonament. Sunt
 * datele utilizatorului, iar a-i cere bani ca sa si le poata scoate de pe
 * propriul telefon e exact tipul de tinere ostatica pe care o aplicatie
 * "totul ramane la tine" nu are voie sa-l faca. Butonul de salvare e liber.
 */

/** Sub atatea decizii, o afirmatie despre "cat te cunosc" ar suna a lauda goala. */
const MIN_TO_SHOW = 15;
/** De la atatea decizii, profilul reprezinta o munca pe care chiar ar durea s-o pierzi. */
const WORTH_PROTECTING = 60;

export function TrainedProfileStrip({ onAction }: { onAction?: () => void }) {
  const locale = useStore(s => s.locale);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const exportBackup = useStore(s => s.exportBackup);
  const [decisions, setDecisions] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    // count(), nu toArray(): ne trebuie un numar, nu inregistrarile
    void db.corrections.count().then(n => { if (alive) setDecisions(n); });
    return () => { alive = false; };
  }, []);

  if (decisions === null || decisions < MIN_TO_SHOW) return null;
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  return (
    <div className="trained-profile">
      <button
        className="trained-profile-main"
        onClick={() => { setInsightsOpen(true); onAction?.(); }}
      >
        <span className="trained-profile-icon" aria-hidden="true"><SparkleIcon /></span>
        <span className="trained-profile-text">
          <b>{tr('profile.knows', { count: decisions })}</b>
          <span>{tr('profile.see')}</span>
        </span>
      </button>

      {decisions >= WORTH_PROTECTING && (
        <p className="trained-profile-warn">
          {tr('profile.onlyHere')}{' '}
          <button className="trained-profile-link" onClick={() => { void exportBackup(); onAction?.(); }}>
            {tr('profile.save')}
          </button>
        </p>
      )}
    </div>
  );
}
