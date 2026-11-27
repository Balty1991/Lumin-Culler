import { useMemo, useState } from 'react';
import { autonomyOfferFor, readOfferSnooze, snoozeOffer } from './autonomyOffer';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Orb } from './Orb';
import { formatBytes, freedSummary, readAutonomy, readSafety, readTwin, writeAutonomy, type Autonomy } from './twin';
import { renderFreedCard, shareCard } from './shareCards';

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

/** Siguranța, în cuvinte: cât de des ai fost de acord cu ce a scos AI-ul și câți dragi ai salvat. */
export function SafetyLine() {
  const tr = useTr();
  const s = readSafety();
  if (s.rejectPrecision === null) return <p className="lx-hint lx-safety">{tr('lx.safety.learning', { count: s.rejects, need: 15 })}</p>;
  return (
    <p className={s.safe ? 'lx-hint lx-safety ok' : 'lx-hint lx-safety warn'}>
      {tr('lx.safety.precision', { percent: Math.round(s.rejectPrecision * 100), count: s.rejects })}
      {' '}{s.peopleRescued > 0 ? tr('lx.safety.rescued', { count: s.peopleRescued }) : tr('lx.safety.noneLost')}
      {!s.safe && <> {tr('lx.safety.brake')}</>}
    </p>
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

/**
 * Autonomia câștigată, pe Azi: când copia te nimerește des și sigur, îți
 * propune pasul următor. „Mai târziu” o amână 7 zile; la „tot” nu mai apare.
 */
export function AutonomyOfferCard() {
  const tr = useTr();
  const premiumLocked = useStore(s => s.premiumLocked);
  const [hidden, setHidden] = useState(false);
  const offer = useMemo(() => {
    const twin = readTwin();
    return autonomyOfferFor({
      percent: twin.percent, decisions: twin.decisions, safe: readSafety().safe,
      autonomy: readAutonomy(), snoozedUntil: readOfferSnooze(), now: Date.now(),
    });
  }, []);
  if (!offer || hidden) return null;
  const accept = () => {
    const st = useStore.getState();
    // „Decid tot” e Pro: fără abonament se deschide ecranul Pro și cardul rămâne.
    if (offer.pro && st.premiumLocked && st.gatePremium('acceptAll')) return;
    writeAutonomy(offer.to);
    useStore.setState({ notice: tr(`lx.twin.auto.${offer.to}.sub`) });
    setHidden(true);
  };
  return (
    <section className="lx-card lx-auto-result" role="status">
      <span className="lx-eyebrow">{tr('lx.twin.offer.eyebrow')}</span>
      <b>{tr(`lx.twin.offer.${offer.to}`, { percent: offer.percent })}</b>
      {offer.pro && <span>{tr('lx.twin.offer.allSub')}</span>}
      <div className="lx-decide-actions">
        <button className="lx-btn primary" onClick={accept}>
          {tr('lx.twin.offer.yes')}{offer.pro && premiumLocked && <b className="lx-pro">PRO</b>}
        </button>
        <button className="lx-btn ghost" onClick={() => { snoozeOffer(); setHidden(true); }}>{tr('lx.twin.offer.later')}</button>
      </div>
    </section>
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
        <button className="lx-link" onClick={() => {
          const size = formatBytes(total, locale);
          const detail = tr('lx.freed.total', { size });
          void renderFreedCard(size, detail, tr('lx.share.cta')).then(blob => {
            if (blob) void shareCard(blob, `cherrypic-eliberat-${Date.now()}.jpg`, detail, tr('lx.share.cta'));
          });
        }}>{tr('lx.freed.share')}</button>
      </div>
    </section>
  );
}
