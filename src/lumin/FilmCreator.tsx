import { usePacedPhotos } from './useLxPhotos';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Icon } from './icons';
import { Thumb } from './Thumb';
import { photoTime } from './days';
import { FILM_MAX_PHOTOS, makeBurstFilm, type BurstFilm, type FilmOptions } from './burstFilm';
import { FilmSheet } from './FilmSheet';
import { logError } from '../core/errorLog';
import { useHoldAnalysis } from './useHoldAnalysis';

/**
 * Creatorul de mini-film: omul alege pozele (pornind de la seria pozei deschise),
 * le pune în ordinea lui și alege viteza, trecerea, formatul și culorile.
 * Cerut: „un creator manual la miniserie, să adaugi tu fotografiile și să-l poți
 * personaliza”. Filmul se face tot pe telefon, apoi se vede înainte de salvare.
 */
type Choice<T extends string> = { value: T; label: string };

export function FilmCreator({ startId, initialIds, initialTransition, onClose }: { startId: string; initialIds: string[]; initialTransition?: 'ai' | 'fade'; onClose: () => void }) {
  useHoldAnalysis();
  const tr = useTr();
  const photos = usePacedPhotos();
  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const [ids, setIds] = useState<string[]>(() => (initialIds.length ? initialIds : [startId]).slice(0, FILM_MAX_PHOTOS));
  const [active, setActive] = useState<string | null>(null);
  const [allDays, setAllDays] = useState(false);
  const [speed, setSpeed] = useState<NonNullable<FilmOptions['speed']>>('normal');
  const [transition, setTransition] = useState<NonNullable<FilmOptions['transition']> | null>(initialTransition ?? null);
  const [loop, setLoop] = useState<NonNullable<FilmOptions['loop']>>('bounce');
  const [format, setFormat] = useState<NonNullable<FilmOptions['format']>>('orig');
  const [look, setLook] = useState<NonNullable<FilmOptions['look']>>('natural');
  const [music, setMusic] = useState<NonNullable<FilmOptions['music']>>('calm');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [film, setFilm] = useState<BurstFilm | null>(null);

  // Mișcarea AI are sens doar pentru o serie (aceeași scenă); poze diferite: trecere lină.
  const sameBurst = useMemo(() => {
    const g = byId.get(ids[0])?.groupId;
    return !!g && ids.every(id => byId.get(id)?.groupId === g) && ids.length <= 8;
  }, [ids, byId]);
  const trans = transition ?? (sameBurst ? 'ai' : 'fade');

  // Pozele de unde alegi: ziua pozei deschise, sau toate (cele mai apropiate în timp).
  const candidates = useMemo(() => {
    const start = byId.get(startId);
    const t0 = start ? photoTime(start) : Date.now();
    const day = new Date(t0).toDateString();
    // Fără capturi de ecran și documente (raportat: grila era plină de capturi).
    const live = photos.filter(p => ids.includes(p.id) || (p.status !== 'rejected' && !p.aside));
    const list: PhotoView[] = allDays
      ? [...live].sort((a, b) => Math.abs(photoTime(a) - t0) - Math.abs(photoTime(b) - t0)).slice(0, 600)
      : live.filter(p => new Date(photoTime(p)).toDateString() === day);
    return list.sort((a, b) => photoTime(b) - photoTime(a));
  }, [photos, byId, startId, allDays, ids]);

  const toggle = (id: string) => setIds(cur => {
    if (cur.includes(id)) return cur.filter(x => x !== id);
    if (cur.length >= FILM_MAX_PHOTOS) { useStore.getState().setNotice(tr('lx.filmMaker.max', { count: FILM_MAX_PHOTOS })); return cur; }
    return [...cur, id];
  });
  const move = (d: -1 | 1) => setIds(cur => {
    const i = active ? cur.indexOf(active) : -1;
    const j = i + d;
    if (i < 0 || j < 0 || j >= cur.length) return cur;
    const n = [...cur];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const byTime = () => setIds(cur => [...cur].sort((a, b) => photoTime(byId.get(a)!) - photoTime(byId.get(b)!)));

  const make = async () => {
    setBusy(true); setPct(0);
    try {
      const r = await makeBurstFilm(ids, setPct, { speed, transition: trans, loop, format, look, music });
      if (r) setFilm(r);
      else useStore.getState().setNotice(tr('lx.burstFilm.noPhotos'));
    } catch (e) {
      logError('film', e instanceof Error ? e.message : String(e), 'FilmCreator');
      useStore.getState().setNotice(tr('lx.burstFilm.engineFailed'));
    } finally { setBusy(false); setPct(0); }
  };

  const chips = <T extends string>(label: string, value: T, set: (v: T) => void, options: Choice<T>[]) => (
    <div className="lx-fm-opt">
      <span>{label}</span>
      <div className="lx-enhance-styles" role="radiogroup" aria-label={label}>
        {options.map(o => (
          <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => set(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );

  return createPortal(
    <div className="lx lx-enhance lx-fm" role="dialog" aria-modal="true" aria-label={tr('lx.filmMaker.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.filmMaker.title')}</span>
        <span className="lx-fm-count">{ids.length}/{FILM_MAX_PHOTOS}</span>
      </header>

      <div className="lx-fm-body">
        {/* Ordinea filmului: atingi o poză ca s-o muți sau s-o scoți. */}
        <section className="lx-fm-section">
          <div className="lx-fm-head">
            <b>{tr('lx.filmMaker.order')}</b>
            <button className="lx-link" onClick={byTime} disabled={ids.length < 2}>{tr('lx.filmMaker.byTime')}</button>
          </div>
          <div className="lx-tidy-row lx-fm-strip">
            {ids.map((id, i) => {
              const p = byId.get(id);
              return (
                <button key={id} className={active === id ? 'lx-tidy-photo keep lx-fm-sel' : 'lx-tidy-photo keep'} onClick={() => setActive(a => (a === id ? null : id))} aria-pressed={active === id}>
                  {p && <Thumb id={id} lqip={p.lqip} edits={p.edits} />}
                  <span className="lx-fm-num">{i + 1}</span>
                </button>
              );
            })}
          </div>
          {active && ids.includes(active) ? (
            <div className="lx-fm-tools">
              <button className="lx-chip-btn" onClick={() => move(-1)} disabled={ids.indexOf(active) === 0}>‹ {tr('lx.filmMaker.earlier')}</button>
              <button className="lx-chip-btn" onClick={() => move(1)} disabled={ids.indexOf(active) === ids.length - 1}>{tr('lx.filmMaker.later')} ›</button>
              <button className="lx-chip-btn" onClick={() => { toggle(active); setActive(null); }}><Icon name="x" size={14} /> {tr('lx.filmMaker.remove')}</button>
            </div>
          ) : <p className="lx-hint lx-fm-hint">{ids.length < 2 ? tr('lx.filmMaker.needTwo') : tr('lx.filmMaker.tapToMove')}</p>}
        </section>

        {/* Pozele de adăugat. */}
        <section className="lx-fm-section">
          <div className="lx-fm-head">
            <b>{tr('lx.filmMaker.add')}</b>
            <div className="lx-enhance-styles lx-fm-days" role="radiogroup">
              <button role="radio" aria-checked={!allDays} className={!allDays ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setAllDays(false)}>{tr('lx.filmMaker.thisDay')}</button>
              <button role="radio" aria-checked={allDays} className={allDays ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setAllDays(true)}>{tr('lx.filmMaker.allDays')}</button>
            </div>
          </div>
          <div className="lx-fm-grid">
            {candidates.map(p => {
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

        {/* Personalizarea. */}
        <section className="lx-fm-section">
          {chips(tr('lx.filmMaker.speed'), speed, setSpeed, [
            { value: 'slow', label: tr('lx.filmMaker.speed.slow') },
            { value: 'normal', label: tr('lx.filmMaker.speed.normal') },
            { value: 'fast', label: tr('lx.filmMaker.speed.fast') }
          ])}
          {chips(tr('lx.filmMaker.transition'), trans, v => setTransition(v), [
            { value: 'ai', label: tr('lx.filmMaker.transition.ai') },
            { value: 'fade', label: tr('lx.filmMaker.transition.fade') }
          ])}
          {chips(tr('lx.filmMaker.loop'), loop, setLoop, [
            { value: 'bounce', label: tr('lx.filmMaker.loop.bounce') },
            { value: 'forward', label: tr('lx.filmMaker.loop.forward') }
          ])}
          {chips(tr('lx.filmMaker.format'), format, setFormat, [
            { value: 'orig', label: tr('lx.filmMaker.format.orig') },
            { value: 'square', label: tr('lx.filmMaker.format.square') },
            { value: 'story', label: tr('lx.filmMaker.format.story') }
          ])}
          {chips(tr('lx.filmMaker.look'), look, setLook, [
            { value: 'natural', label: tr('lx.filmMaker.look.natural') },
            { value: 'warm', label: tr('lx.filmMaker.look.warm') },
            { value: 'vivid', label: tr('lx.filmMaker.look.vivid') },
            { value: 'bw', label: tr('lx.filmMaker.look.bw') }
          ])}
          {chips(tr('lx.filmMaker.music'), music, setMusic, [
            { value: 'calm', label: tr('lx.filmMaker.music.calm') },
            { value: 'happy', label: tr('lx.filmMaker.music.happy') },
            { value: 'none', label: tr('lx.filmMaker.music.none') }
          ])}
          {trans === 'ai' && !sameBurst && <p className="lx-hint lx-fm-hint">{tr('lx.filmMaker.aiHint')}</p>}
        </section>
      </div>

      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className={busy ? 'lx-btn primary lx-busy-btn' : 'lx-btn primary'} style={busy ? { ['--pct' as string]: `${Math.round(pct * 100)}%` } : undefined}
            disabled={busy || ids.length < 2} onClick={() => void make()}>
            <Icon name="film" size={18} /> {busy ? `${tr('lx.filmMaker.making')} · ${Math.round(pct * 100)}%` : tr('lx.filmMaker.make')}
          </button>
        </div>
      </div>
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </div>,
    document.body
  );
}
