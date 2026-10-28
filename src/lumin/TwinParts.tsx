import { useState } from 'react';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Orb } from './Orb';
import { formatBytes, freedSummary, readAutonomy, readTwin, writeAutonomy, type Autonomy } from './twin';

/**
 * lumin/Twin.tsx
 * Piesele „Copiei tale”: cât de bine te imită (inelul cu procentul), cât îi
 * dai voie să facă singură și cât spațiu a eliberat.
 */
export function TwinHero({ compact = false }: { compact?: boolean }) {
  const tr = useTr();
  const twin = readTwin();
  const p = twin.percent;
  return (
    <section className={compact ? 'lx-twin compact' : 'lx-twin'}>
      <div className="lx-twin-ring" style={{ ['--p' as string]: `${p ?? 0}` }}>
        <Orb mood={p === null ? 'think' : 'idle'} size={compact ? 64 : 96} />
      </div>
      <div className="lx-twin-text">
        <span className="lx-eyebrow">{tr('lx.twin.eyebrow')}</span>
        {p === null
          ? <b>{tr('lx.twin.learning')}</b>
          : <b>{tr('lx.twin.percent', { percent: p })}</b>}
        <span>{tr(`lx.twin.level.${twin.level}`)}</span>
        {twin.trend !== null && twin.trend > 0 && <span className="lx-twin-trend">▲ {tr('lx.twin.trend', { points: twin.trend })}</span>}
      </div>
    </section>
  );
}

const LEVELS: Autonomy[] = ['suggest', 'sure', 'all'];

export function AutonomyPicker() {
  const tr = useTr();
  const premiumLocked = useStore(s => s.premiumLocked);
  const gatePremium = useStore(s => s.gatePremium);
  const [value, setValue] = useState<Autonomy>(readAutonomy);
  const choose = (a: Autonomy) => {
    if (a === 'all' && premiumLocked && gatePremium('acceptAll')) return;
    writeAutonomy(a);
    setValue(a);
  };
  return (
    <div className="lx-autonomy" role="radiogroup" aria-label={tr('lx.twin.autonomy')}>
      {LEVELS.map(a => (
        <button key={a} role="radio" aria-checked={value === a} className={value === a ? 'lx-auto-opt on' : 'lx-auto-opt'} onClick={() => choose(a)}>
          <b>{tr(`lx.twin.auto.${a}`)}{a === 'all' && premiumLocked && <span className="lx-pro">PRO</span>}</b>
          <small>{tr(`lx.twin.auto.${a}.sub`)}</small>
        </button>
      ))}
    </div>
  );
}

export function FreedCard() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const { month, total } = freedSummary();
  if (total <= 0) return null;
  return (
    <section className="lx-card lx-freed">
      <span className="lx-freed-icon" aria-hidden="true">◔</span>
      <div>
        <b>{tr('lx.freed.month', { size: formatBytes(month, locale) })}</b>
        <span>{tr('lx.freed.total', { size: formatBytes(total, locale) })}</span>
      </div>
    </section>
  );
}
