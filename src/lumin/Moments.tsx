import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLx } from './lxStore';
import { useLxPhotos } from './useLxPhotos';
import { Thumb } from './Thumb';
import { Icon } from './icons';
import { intlTag } from '../i18n';
import { FilmSheet } from './FilmSheet';
import { FilmCreator } from './FilmCreator';
import { burstFilmAvailable, type BurstFilm } from './burstFilm';
import { beenHere, firstsOf, yearDays } from './moments';
import { makeYearMinute } from './yearMinute';
import { ageAt, readBirthdays } from './birthdays';
import { showNotification } from '../core/nativeNotifications';
import { logError } from '../core/errorLog';

/* ───────────── „Ai mai fost aici” ───────────── */

const HERE_KEY = 'lx.beenHere.notified';
const ago = (tr: (k: string, p?: Record<string, string | number>) => string, years: number) => (years === 1 ? tr('lx.ago.1') : tr('lx.ago.n', { count: years }));

/**
 * Pe Azi: o poză făcută zilele astea într-un loc unde ai mai fost cu ani în urmă,
 * lângă cea de atunci. Prima dată când apare, și o notificare (o singură dată pe loc).
 */
export function BeenHereCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const list = useMemo(() => beenHere(photos).slice(0, 2), [photos]);
  useEffect(() => {
    if (!list.length) return;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(HERE_KEY) ?? '[]') as string[]; } catch { /* nimic */ }
    const fresh = list.filter(x => !seen.includes(x.old.id));
    if (!fresh.length) return;
    const x = fresh[0];
    const who = x.old.personNames?.[0];
    void showNotification({
      title: tr('lx.here.notifyTitle'),
      body: who ? tr('lx.here.notifyWith', { when: ago(tr, x.years), name: who }) : tr('lx.here.notifyBody', { when: ago(tr, x.years) }),
      channelName: tr('lx.here.channel')
    }).catch(() => false);
    try { localStorage.setItem(HERE_KEY, JSON.stringify([...seen, ...fresh.map(f => f.old.id)].slice(-200))); } catch { /* fără */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  if (!list.length) return null;
  return (
    <section className="lx-section">
      <div className="lx-section-head"><h2>{tr('lx.here.title')}</h2></div>
      {list.map(x => {
        const ids = [x.old.id, ...x.others.map(o => o.id), x.recent.id];
        const who = x.old.personNames?.length ? x.old.personNames.slice(0, 2).join(' & ') : null;
        return (
          <button key={x.recent.id} className="lx-card lx-here" onClick={() => useLx.getState().openViewer(ids, 0)}>
            <span className="lx-here-pair">
              <span><Thumb id={x.old.id} edits={x.old.edits} lqip={x.old.lqip} /><small>{new Date(x.old.capturedAt!).getFullYear()}</small></span>
              <span><Thumb id={x.recent.id} edits={x.recent.edits} lqip={x.recent.lqip} /><small>{tr('lx.pair.now')}</small></span>
            </span>
            <b>{who ? tr('lx.here.with', { when: ago(tr, x.years), name: who }) : tr('lx.here.body', { when: ago(tr, x.years) })}</b>
            <small>{new Date(x.old.capturedAt!).toLocaleDateString(intlTag(locale), { day: 'numeric', month: 'long', year: 'numeric' })}{x.others.length ? ` · ${tr('lx.here.more', { count: x.others.length })}` : ''}</small>
          </button>
        );
      })}
    </section>
  );
}

/* ───────────── „Premierele” ───────────── */

export function FirstsCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [open, setOpen] = useState<string | null>(null);
  const people = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of photos) for (const name of p.personNames ?? []) n.set(name, (n.get(name) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k)
      .filter(name => firstsOf(photos, name).length >= 2).slice(0, 4);
  }, [photos]);
  if (!people.length) return null;
  return (
    <section className="lx-card lx-growth-card">
      <span className="lx-profile-badge" aria-hidden="true">1</span>
      <div>
        <b>{tr('lx.firsts.title')}</b>
        <small>{tr('lx.firsts.sub')}</small>
        <div className="lx-chips">{people.map(n => <button key={n} className="lx-chip-btn" onClick={() => setOpen(n)}>{n}</button>)}</div>
      </div>
      {open && <FirstsSheet name={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

const WRONG_KEY = 'lx.firsts.wrong';
function readWrong(): Record<string, Record<string, string[]>> {
  try { return JSON.parse(localStorage.getItem(WRONG_KEY) ?? '{}') as Record<string, Record<string, string[]>>; } catch { return {}; }
}

export function FirstsSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const [wrong, setWrong] = useState(() => readWrong()[name] ?? {});
  const list = useMemo(() => firstsOf(photos, name, wrong), [photos, name, wrong]);
  // „Nu e bine”: poza nu mai e luată pentru premiera asta; se caută următoarea.
  const reject = (key: string, id: string) => {
    const all = readWrong();
    const mine = { ...(all[name] ?? {}), [key]: [...((all[name] ?? {})[key] ?? []), id] };
    try { localStorage.setItem(WRONG_KEY, JSON.stringify({ ...all, [name]: mine })); } catch { /* fără */ }
    setWrong(mine);
  };
  const [film, setFilm] = useState(false);
  const bday = readBirthdays()[name];
  const ids = list.map(f => f.photo.id);
  return createPortal(
    <div className="lx lx-enhance lx-fm" role="dialog" aria-modal="true" aria-label={tr('lx.firsts.of', { name })}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.firsts.of', { name })}</span>
        <span />
      </header>
      <div className="lx-fm-body">
        {!list.length ? <p className="lx-empty">{tr('lx.firsts.none', { name })}</p> : (
          <div className="lx-firsts">
            {list.map((f, i) => {
              const a = bday ? ageAt(bday, f.at) : null;
              return (
                <button key={f.key} className="lx-firsts-item" onClick={() => { onClose(); useLx.getState().openViewer(ids, i); }}>
                  <span className="lx-firsts-dot" aria-hidden="true" />
                  <span className="lx-firsts-thumb"><Thumb id={f.photo.id} edits={f.photo.edits} lqip={f.photo.lqip} /></span>
                  <span className="lx-firsts-text">
                    <b>{tr(`lx.firsts.k.${f.key}`)}</b>
                    <small>{new Date(f.at).toLocaleDateString(intlTag(locale), { day: 'numeric', month: 'long', year: 'numeric' })}
                      {a ? ` · ${tr(a.years > 0 ? (a.months > 0 ? 'lx.person.ageYm' : 'lx.person.ageY') : 'lx.person.ageM', { years: a.years, months: a.months, name })}` : ''}</small>
                  </span>
                  <span role="button" tabIndex={0} className="lx-firsts-wrong" onClick={e => { e.stopPropagation(); reject(f.key, f.photo.id); }}>{tr('lx.firsts.wrong')}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="lx-hint center">{tr('lx.firsts.hint')}</p>
      </div>
      {burstFilmAvailable() && list.length >= 2 && (
        <div className="lx-viewer-info">
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => setFilm(true)}><Icon name="film" size={18} /> {tr('lx.onThisDay.film')}</button>
          </div>
        </div>
      )}
      {film && <FilmCreator startId={ids[0]} initialIds={ids.slice(0, 12)} initialTransition="fade" onClose={() => setFilm(false)} />}
    </div>,
    document.body
  );
}

/* ───────────── „Un an într-un minut” ───────────── */

export function YearMinuteCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const years = useMemo(() => {
    const out: number[] = [];
    const ys = [...new Set(photos.filter(p => p.capturedAt).map(p => new Date(p.capturedAt!).getFullYear()))].sort((a, b) => b - a);
    for (const y of ys) if (yearDays(photos, y).length >= 20) out.push(y);
    return out.slice(0, 4);
  }, [photos]);
  const [busy, setBusy] = useState<number | null>(null);
  const [pct, setPct] = useState(0);
  const [film, setFilm] = useState<BurstFilm | null>(null);
  if (!years.length || !burstFilmAvailable()) return null;
  const make = async (year: number) => {
    setBusy(year); setPct(0);
    try {
      const days = yearDays(photos, year);
      const tag = intlTag(locale);
      const f = await makeYearMinute(days.map(p => ({ id: p.id, at: p.capturedAt! })),
        at => new Date(at).toLocaleDateString(tag, { day: 'numeric', month: 'short' }), tr('lx.yearMin.cardTitle', { year }), 'happy', setPct);
      if (f) setFilm(f); else useStore.getState().setNotice(tr('lx.magic.failed'));
    } catch (e) {
      logError('yearMinute', e instanceof Error ? e.message : String(e), 'Moments');
      useStore.getState().setNotice(tr('lx.magic.failed'));
    } finally { setBusy(null); setPct(0); }
  };
  return (
    <section className="lx-card lx-growth-card">
      <span className="lx-profile-badge" aria-hidden="true">60″</span>
      <div>
        <b>{tr('lx.yearMin.title')}</b>
        <small>{busy !== null ? tr('lx.yearMin.making', { percent: Math.round(pct * 100) }) : tr('lx.yearMin.sub')}</small>
        <div className="lx-chips">
          {years.map(y => <button key={y} className={busy === y ? 'lx-chip-btn on' : 'lx-chip-btn'} disabled={busy !== null} onClick={() => void make(y)}>{y}</button>)}
        </div>
      </div>
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </section>
  );
}

/** Din Studio: alegi anul, se face filmul, apoi îl vezi. */
export function YearMinuteSheet({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const years = useMemo(() => {
    const ys = [...new Set(photos.filter(p => p.capturedAt).map(p => new Date(p.capturedAt!).getFullYear()))].sort((a, b) => b - a);
    return ys.filter(y => yearDays(photos, y).length >= 10).slice(0, 6);
  }, [photos]);
  const [busy, setBusy] = useState<number | null>(null);
  const [pct, setPct] = useState(0);
  const [film, setFilm] = useState<BurstFilm | null>(null);
  const make = async (year: number) => {
    setBusy(year); setPct(0);
    try {
      const days = yearDays(photos, year);
      const tag = intlTag(locale);
      const f = await makeYearMinute(days.map(p => ({ id: p.id, at: p.capturedAt! })),
        at => new Date(at).toLocaleDateString(tag, { day: 'numeric', month: 'short' }), tr('lx.yearMin.cardTitle', { year }), 'happy', setPct);
      if (f) setFilm(f); else useStore.getState().setNotice(tr('lx.magic.failed'));
    } catch (e) {
      logError('yearMinute', e instanceof Error ? e.message : String(e), 'Moments');
      useStore.getState().setNotice(tr('lx.magic.failed'));
    } finally { setBusy(null); setPct(0); }
  };
  return createPortal(
    <div className="lx lx-enhance lx-fm" role="dialog" aria-modal="true" aria-label={tr('lx.yearMin.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.yearMin.title')}</span>
        <span />
      </header>
      <div className="lx-fm-body lx-pick-center">
        <span className="lx-studio-hero" aria-hidden="true">60″</span>
        <p className="lx-hint center">{busy !== null ? tr('lx.yearMin.making', { percent: Math.round(pct * 100) }) : years.length ? tr('lx.yearMin.sub') : tr('lx.studio.few')}</p>
        {busy !== null && <div className="lx-studio-bar"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>}
        <div className="lx-chips lx-pick-years">
          {years.map(y => <button key={y} className={busy === y ? 'lx-chip-btn on' : 'lx-chip-btn'} disabled={busy !== null} onClick={() => void make(y)}>{y}</button>)}
        </div>
      </div>
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </div>,
    document.body
  );
}
