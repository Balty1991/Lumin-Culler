import { useState } from 'react';
import { createPortal } from 'react-dom';
import { isClipPlatform } from '../core/clip/clipEngine';
import { useStore } from '../state/store';
import { useTr } from './context';
import { dataMode, deferEnginesPrompt, setDataMode, type DataMode } from './dataMode';
import { ENGINES, ENGINES_READY_EVENT } from './engines';

let laterThisRun = false;

/**
 * După instalare, ca permisiunile de Galerie și notificări: o fereastră care cere
 * descărcarea motoarelor AI (cât, ce primești, pe ce rețea). Cerut: „să știe
 * utilizatorii după instalare să activeze și să descarce imediat pachetele”.
 * „Mai târziu” o amână până la următoarea pornire.
 */
export function EnginesIntro() {
  const tr = useTr();
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const [chosen, setChosen] = useState(dataMode());
  const [later, setLater] = useState(laterThisRun);
  if (chosen || later || !welcomeSeen || !isClipPlatform()) return null;
  const mb = 224 + ENGINES.filter(e => !e.lang).reduce((a, e) => a + e.mb, 0);
  const pick = (m: DataMode) => {
    setDataMode(m);
    setChosen(m);
    void import('./clipBackfill').then(x => x.startClipBackfill(m === 'any'));
  };
  const perks = ['lx.intro.perk.taste', 'lx.intro.perk.search', 'lx.intro.perk.edit', 'lx.intro.perk.film'] as const;
  return createPortal(
    <div className="lx lx-perm" role="dialog" aria-modal="true" aria-labelledby="lx-perm-title">
      <div className="lx-perm-sheet">
        <span className="lx-perm-icon" aria-hidden="true">✦</span>
        <b id="lx-perm-title">{tr('lx.intro.title')}</b>
        <p>{tr('lx.intro.body', { mb: Math.round(mb / 10) * 10 })}</p>
        <ul>{perks.map(k => <li key={k}>{tr(k)}</li>)}</ul>
        <div className="lx-perm-actions">
          {/* Wi-Fi e alegerea implicită: ~1 GB pe date mobile e mult pentru cine a instalat
              aplicația ca să-și elibereze spațiu (auditul pe persoane). */}
          <button className="lx-btn primary" onClick={() => pick('wifi')}>{tr('lx.intro.wifi')}</button>
          <button className="lx-btn ghost" onClick={() => pick('any')}>{tr('lx.intro.any')}</button>
          <button className="lx-link" onClick={() => { laterThisRun = true; deferEnginesPrompt(); setLater(true); window.dispatchEvent(new Event(ENGINES_READY_EVENT)); }}>{tr('lx.intro.later')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
