import { useState } from 'react';
import { useStore } from '../state/store';
import { FREE_PHOTOS_PER_MONTH } from '../core/entitlement';
import {
  allowanceLevel, forgetDismissalIfBelow, readDismissedLevel, shouldShowAllowanceNotice, writeDismissedLevel
} from '../state/freeAllowance';
import { StarIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

/**
 * ui/FreeAllowanceNotice.tsx
 * Plafonul lunar gratuit, spus INAINTE sa incurce pe cineva.
 *
 * Pana acum, un utilizator gratuit il afla in doua feluri, si amandoua prost
 * alese: fie se ducea singur in Meniu → Premium (adica exact cand nu-l durea
 * nimic), fie apasa Exportă si primea, DUPA export, mesajul ca a trecut de
 * limita. Al doilea e cel mai prost moment posibil — omul afla de perete
 * lovindu-se de el.
 *
 * Bannerul asta sta pe drumul obisnuit (teancul de pe ecranul principal), apare
 * o singura data per prag si spune cifrele reale ale omului, nu un slogan.
 * Regula, cu praguri si cu memoria respingerilor, sta separat in
 * state/freeAllowance.ts, ca sa poata fi verificata fara sa randam nimic.
 */
export function FreeAllowanceNotice() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const photosUsed = useStore(s => s.photosUsedThisWindow);
  // premiumLocked, nu doar "nu e abonat": e aceeasi conditie folosita peste tot
  // in aplicatie — exista o cale reala de plata pe dispozitivul asta. Un plafon
  // anuntat fara posibilitatea de a-l ridica ar fi doar o veste proasta.
  const premiumLocked = useStore(s => s.premiumLocked);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);

  const level = allowanceLevel(photosUsed, FREE_PHOTOS_PER_MONTH);
  // Fereastra de 30 de zile se reinnoieste, deci contorul scade singur; cand a
  // scazut sub pragul respins, uitam respingerea (vezi forgetDismissalIfBelow).
  const dismissed = forgetDismissalIfBelow(level, readDismissedLevel());

  if (hiddenThisSession) return null;
  if (!shouldShowAllowanceNotice(level, dismissed, premiumLocked)) return null;

  const remaining = Math.max(0, FREE_PHOTOS_PER_MONTH - photosUsed);
  const dismiss = () => { writeDismissedLevel(level); setHiddenThisSession(true); };

  return (
    <div className="install-prompt" role="status">
      <div className="install-prompt-row">
        <StarIcon className="install-prompt-icon" aria-hidden="true" />
        <span className="install-prompt-text mono">
          {level === 'reached'
            ? tr('app.allowance.reached', { limit: FREE_PHOTOS_PER_MONTH })
            : tr(plural(remaining, 'app.allowance.remaining.one', 'app.allowance.remaining.other'), { remaining, limit: FREE_PHOTOS_PER_MONTH })}
        </span>
        <button className="ghost icon-btn install-prompt-close" onClick={dismiss} aria-label={tr('app.toast.close')}>
          <XIcon />
        </button>
      </div>
      <button className="ghost small install-prompt-install" onClick={() => { setPremiumOpen(true); dismiss(); }}>
        {tr('app.allowance.cta')}
      </button>
    </div>
  );
}
