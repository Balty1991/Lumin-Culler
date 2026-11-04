import { useState } from 'react';
import type { PhotoView } from '../state/store';
import { useStore } from '../state/store';
import { useTr } from './context';
import { burstFilmAvailable, type BurstFilm } from './burstFilm';
import { makeGrowthFilm, pickGrowthFaces } from './growthFilm';
import { FilmSheet } from './FilmSheet';
import { ageAt, readBirthdays } from './birthdays';
import { monthLabel } from './format';
import { logError } from '../core/errorLog';

/** „Cum a crescut {name}”: filmul cu fața aliniată, lună de lună (pagina omului). */
export function GrowthButton({ name, list }: { name: string; list: PhotoView[] }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [film, setFilm] = useState<BurstFilm | null>(null);
  if (!burstFilmAvailable()) return null;
  const make = async () => {
    setBusy(true); setPct(0);
    try {
      const picks = await pickGrowthFaces(name, list);
      if (picks.length < 3) { useStore.getState().setNotice(tr('lx.growth.few', { name })); return; }
      const bday = readBirthdays()[name];
      const r = await makeGrowthFilm(picks, at => {
        const m = monthLabel(at, locale);
        const a = bday ? ageAt(bday, at) : null;
        return {
          caption: m.charAt(0).toUpperCase() + m.slice(1),
          sub: a ? tr(a.years > 0 ? (a.months > 0 ? 'lx.person.ageYm' : 'lx.person.ageY') : 'lx.person.ageM', { years: a.years, months: a.months, name }) : null
        };
      }, {}, setPct);
      if (r) setFilm(r); else useStore.getState().setNotice(tr('lx.burstFilm.noPhotos'));
    } catch (e) {
      logError('growth', e instanceof Error ? e.message : String(e), 'GrowthButton');
      useStore.getState().setNotice(tr('lx.burstFilm.engineFailed'));
    } finally { setBusy(false); setPct(0); }
  };
  return (
    <>
      <button className={busy ? 'lx-btn primary small lx-busy-btn' : 'lx-btn primary small'} style={busy ? { ['--pct' as string]: `${Math.round(pct * 100)}%` } : undefined}
        disabled={busy} onClick={() => void make()}>
        ✨ {busy ? `${tr('lx.growth.making')} · ${Math.round(pct * 100)}%` : tr('lx.growth.button', { name })}
      </button>
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </>
  );
}
