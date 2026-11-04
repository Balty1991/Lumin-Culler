import { useState } from 'react';
import { isClipPlatform } from '../core/clip/clipEngine';
import { useTr } from './context';
import { dataMode, setDataMode, type DataMode } from './dataMode';
import { ENGINES } from './engines';

/**
 * Prima pornire: cât descarcă AI-ul și pe ce rețea. Apare o singură dată, pe Azi.
 */
export function EnginesIntro() {
  const tr = useTr();
  const [chosen, setChosen] = useState(dataMode());
  if (chosen || !isClipPlatform()) return null;
  const mb = 224 + ENGINES.reduce((a, e) => a + e.mb, 0);
  const pick = (m: DataMode) => {
    setDataMode(m);
    setChosen(m);
    void import('./clipBackfill').then(x => x.startClipBackfill(m === 'any'));
  };
  return (
    <section className="lx-card lx-engines-intro">
      <b>{tr('lx.intro.title')}</b>
      <p>{tr('lx.intro.body', { mb: Math.round(mb / 10) * 10 })}</p>
      <div className="lx-decide-actions">
        <button className="lx-btn ghost" onClick={() => pick('wifi')}>{tr('lx.intro.wifi')}</button>
        <button className="lx-btn primary" onClick={() => pick('any')}>{tr('lx.intro.any')}</button>
      </div>
    </section>
  );
}
