import { useEffect, useMemo, useState } from 'react';
import { useLxPhotos } from './useLxPhotos';
import { createPortal } from 'react-dom';
import type { PhotoView } from '../state/store';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { Icon } from './icons';
import { burstFilmAvailable, type BurstFilm, type FilmOptions } from './burstFilm';
import { facePicksFor, GROWTH_MAX, makeGrowthFilm, pickGrowthFaces } from './growthFilm';
import { FilmSheet } from './FilmSheet';
import { ageAt, readBirthdays } from './birthdays';
import { monthLabel } from './format';
import { logError } from '../core/errorLog';

/**
 * „Cum a crescut {name}”: filmul cu fața aliniată, lună de lună (pagina omului).
 * Se deschide cu pozele alese de AI (cea mai bună față din fiecare lună); omul
 * poate scoate și adăuga orice poză a lui. Cerut: „să poți adăuga și manual un
 * set de poze alese de tine”.
 */
export function GrowthButton({ name, list }: { name: string; list: PhotoView[] }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  if (!burstFilmAvailable()) return null;
  return (
    <>
      <button className="lx-btn primary small" onClick={() => setOpen(true)}>✨ {tr('lx.growth.button', { name })}</button>
      {open && <GrowthSheet name={name} list={list} onClose={() => setOpen(false)} />}
    </>
  );
}

function GrowthSheet({ name, list, onClose }: { name: string; list: PhotoView[]; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [auto, setAuto] = useState<string[] | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [speed, setSpeed] = useState<NonNullable<FilmOptions['speed']>>('slow');
  const [music, setMusic] = useState<NonNullable<FilmOptions['music']>>('calm');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [film, setFilm] = useState<BurstFilm | null>(null);
  const byId = useMemo(() => new Map(list.map(p => [p.id, p])), [list]);
  const time = (id: string) => byId.get(id)?.capturedAt ?? 0;
  const sorted = useMemo(() => [...list].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)), [list]);

  // Propunerea AI-ului: cea mai bună față din fiecare lună.
  useEffect(() => {
    let alive = true;
    void pickGrowthFaces(name, list).then(p => { if (!alive) return; const a = p.map(x => x.id); setAuto(a); setIds(a); });
    return () => { alive = false; };
  }, [name, list]);

  const toggle = (id: string) => setIds(cur => {
    if (cur.includes(id)) return cur.filter(x => x !== id);
    if (cur.length >= GROWTH_MAX) { useStore.getState().setNotice(tr('lx.filmMaker.max', { count: GROWTH_MAX })); return cur; }
    return [...cur, id].sort((a, b) => time(a) - time(b));
  });

  const make = async () => {
    setBusy(true); setPct(0);
    try {
      const picks = await facePicksFor(name, ids.map(id => byId.get(id)!).filter(Boolean));
      const bday = readBirthdays()[name];
      const r = await makeGrowthFilm(picks, at => {
        const a = bday ? ageAt(bday, at) : null;
        return {
          caption: at ? monthLabel(at, locale) : '',
          sub: a ? tr(a.years > 0 ? (a.months > 0 ? 'lx.person.ageYm' : 'lx.person.ageY') : 'lx.person.ageM', { years: a.years, months: a.months, name }) : null
        };
      }, { speed, music }, setPct);
      if (r) setFilm(r); else useStore.getState().setNotice(tr('lx.burstFilm.noPhotos'));
    } catch (e) {
      logError('growth', e instanceof Error ? e.message : String(e), 'GrowthButton');
      useStore.getState().setNotice(tr('lx.burstFilm.engineFailed'));
    } finally { setBusy(false); setPct(0); }
  };

  const chips = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => (
    <div className="lx-fm-opt">
      <span>{label}</span>
      <div className="lx-enhance-styles" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => set(v)}>{l}</button>)}
      </div>
    </div>
  );

  return createPortal(
    <div className="lx lx-enhance lx-fm" role="dialog" aria-modal="true" aria-label={tr('lx.growth.button', { name })}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.growth.button', { name })}</span>
        <span className="lx-fm-count">{ids.length}/{GROWTH_MAX}</span>
      </header>
      <div className="lx-fm-body">
        <section className="lx-fm-section">
          <div className="lx-fm-head">
            <b>{tr('lx.growth.inFilm')}</b>
            {auto && <button className="lx-link" onClick={() => setIds(auto)} disabled={ids.join() === auto.join()}>{tr('lx.growth.useAuto')}</button>}
          </div>
          {auto === null ? <div className="lx-enhance-wait"><span className="lx-spinner" /></div> : (
            <div className="lx-tidy-row lx-fm-strip">
              {ids.map((id, i) => {
                const p = byId.get(id);
                return (
                  <button key={id} className="lx-tidy-photo keep" onClick={() => toggle(id)} aria-label={tr('lx.filmMaker.remove')}>
                    {p && <Thumb id={id} lqip={p.lqip} edits={p.edits} />}
                    <span className="lx-fm-num">{i + 1}</span>
                    <span className="lx-fm-x"><Icon name="x" size={12} /></span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="lx-hint lx-fm-hint">{ids.length < 2 ? tr('lx.filmMaker.needTwo') : tr('lx.growth.hint')}</p>
        </section>
        <section className="lx-fm-section">
          <b>{tr('lx.growth.all', { name, count: list.length })}</b>
          <div className="lx-fm-grid">
            {sorted.map(p => {
              const n = ids.indexOf(p.id);
              return (
                <button key={p.id} className={n >= 0 ? 'lx-fm-pick on' : 'lx-fm-pick'} onClick={() => toggle(p.id)} aria-pressed={n >= 0}>
                  <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
                  {n >= 0 && <span className="lx-fm-num">{n + 1}</span>}
                </button>
              );
            })}
          </div>
        </section>
        <section className="lx-fm-section">
          {chips(tr('lx.filmMaker.speed'), speed, setSpeed, [['slow', tr('lx.filmMaker.speed.slow')], ['normal', tr('lx.filmMaker.speed.normal')], ['fast', tr('lx.filmMaker.speed.fast')]])}
          {chips(tr('lx.filmMaker.music'), music, setMusic, [['calm', tr('lx.filmMaker.music.calm')], ['happy', tr('lx.filmMaker.music.happy')], ['none', tr('lx.filmMaker.music.none')]])}
        </section>
      </div>
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className={busy ? 'lx-btn primary lx-busy-btn' : 'lx-btn primary'} style={busy ? { ['--pct' as string]: `${Math.round(pct * 100)}%` } : undefined}
            disabled={busy || ids.length < 2} onClick={() => void make()}>
            <Icon name="film" size={18} /> {busy ? `${tr('lx.growth.making')} · ${Math.round(pct * 100)}%` : tr('lx.filmMaker.make')}
          </button>
        </div>
      </div>
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </div>,
    document.body
  );
}

/**
 * Pe Azi: „Cum a crescut” pentru oamenii cu poze din cele mai multe luni
 * (raportat: „nu apare nicăieri” — era doar pe pagina fiecărui om).
 */
export function GrowthCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [open, setOpen] = useState<string | null>(null);
  const top = useMemo(() => {
    const months = new Map<string, Set<number>>();
    for (const p of photos) {
      if (p.capturedAt === undefined || p.aside) continue;
      const d = new Date(p.capturedAt); const m = d.getFullYear() * 12 + d.getMonth();
      for (const n of p.personNames ?? []) { if (!months.has(n)) months.set(n, new Set()); months.get(n)!.add(m); }
    }
    return [...months.entries()].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 4).map(([n]) => n);
  }, [photos]);
  const list = useMemo(() => (open ? photos.filter(p => p.capturedAt !== undefined && !p.aside && (p.personNames ?? []).includes(open)) : []), [photos, open]);
  if (!top.length || !burstFilmAvailable()) return null;
  return (
    <section className="lx-card lx-growth-card">
      <span className="lx-profile-badge" aria-hidden="true">✨</span>
      <div>
        <b>{tr('lx.growth.cardTitle')}</b>
        <small>{tr('lx.growth.cardSub')}</small>
        <div className="lx-chips">
          {top.map(n => <button key={n} className="lx-chip-btn" onClick={() => setOpen(n)}>{n}</button>)}
        </div>
      </div>
      {open && <GrowthSheet name={open} list={list} onClose={() => setOpen(null)} />}
    </section>
  );
}
