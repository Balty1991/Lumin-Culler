import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { Icon } from './icons';
import { photoTime } from './days';
import { useLx } from './lxStore';
import { useLxPhotos } from './useLxPhotos';
import { intlTag } from '../i18n';
import { addCapsule, isOpen, markSeen, openTimeFor, readCapsules, rescheduleCapsules, type Capsule } from './capsule';
import { FilmCreator } from './FilmCreator';
import { burstFilmAvailable } from './burstFilm';
import { requestNotificationAccess } from '../core/nativeNotifications';

/**
 * lumin/Capsule.tsx
 * „Capsula timpului”: creezi (poze + un mesaj pentru tine din viitor), stă
 * sigilată, apoi se deschide cu animație în ziua aleasă.
 */
const MAX = 20;
const WHEN = [1, 6, 12, 60] as const;

function useCapsules(): Capsule[] {
  const [list, setList] = useState(readCapsules);
  useEffect(() => {
    const on = () => setList(readCapsules());
    window.addEventListener('lx-capsules', on);
    return () => window.removeEventListener('lx-capsules', on);
  }, []);
  return list;
}

function dateLabel(at: number, locale: string, withDay = true): string {
  return new Date(at).toLocaleDateString(intlTag(locale), withDay ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' });
}

/** Textele notificării, în limba aplicației (și la refacerea alarmelor la pornire). */
function useNotifyText() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  return (c: Pick<Capsule, 'createdAt' | 'photoIds'>) => ({
    title: tr('lx.capsule.notifyTitle', { date: dateLabel(c.createdAt, locale, false) }),
    body: tr('lx.capsule.notifyBody', { count: c.photoIds.length })
  });
}

export function CapsuleCreator({ initialIds, onClose }: { initialIds: string[]; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const photos = useStore(s => s.photos);
  const notifyText = useNotifyText();
  const [ids, setIds] = useState<string[]>(initialIds.slice(0, MAX));
  const [message, setMessage] = useState('');
  const [months, setMonths] = useState<(typeof WHEN)[number]>(12);
  const [sealing, setSealing] = useState(false);
  // De ales: pozele din ultimele 7 zile (păstrate întâi), plus cele deja puse.
  // Pozele de ales: din ultima săptămână sau din toate zilele (cele mai noi întâi).
  const [allDays, setAllDays] = useState(false);
  const candidates = useMemo(() => {
    const since = allDays ? 0 : Date.now() - 7 * 86_400_000;
    return photos
      .filter(p => ids.includes(p.id) || (photoTime(p) >= since && p.status !== 'rejected' && !p.aside))
      .sort((a, b) => photoTime(b) - photoTime(a))
      .slice(0, allDays ? 800 : 300);
  }, [photos, ids, allDays]);
  const toggle = (id: string) => setIds(cur => (cur.includes(id) ? cur.filter(x => x !== id) : cur.length >= MAX ? cur : [...cur, id]));
  const openAt = openTimeFor(months);
  const seal = async () => {
    setSealing(true);
    await requestNotificationAccess().catch(() => 'denied');
    addCapsule(ids, message, openAt, notifyText({ createdAt: Date.now(), photoIds: ids }));
    // Animația de sigilare, apoi gata.
    window.setTimeout(() => {
      useStore.getState().setNotice(tr('lx.capsule.sealed', { date: dateLabel(openAt, locale) }));
      onClose();
    }, 1300);
  };
  return createPortal(
    <div className="lx lx-enhance lx-fm lx-capsule-make" role="dialog" aria-modal="true" aria-label={tr('lx.capsule.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.capsule.title')}</span>
        <span className="lx-fm-count">{ids.length}/{MAX}</span>
      </header>
      {sealing ? (
        <div className="lx-capsule-stage">
          <div className="lx-capsule-orb sealing"><Icon name="lock" size={44} /></div>
          <p className="lx-capsule-msg">{tr('lx.capsule.sealing')}</p>
        </div>
      ) : (
        <div className="lx-fm-body">
          <section className="lx-fm-section">
            <b>{tr('lx.capsule.message')}</b>
            <textarea className="lx-capsule-text" maxLength={500} rows={3} value={message} placeholder={tr('lx.capsule.messageHint')} onChange={e => setMessage(e.target.value)} />
          </section>
          <section className="lx-fm-section">
            <div className="lx-fm-opt">
              <span>{tr('lx.capsule.opens')}</span>
              <div className="lx-enhance-styles" role="radiogroup">
                {WHEN.map(m => (
                  <button key={m} role="radio" aria-checked={months === m} className={months === m ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setMonths(m)}>
                    {tr(`lx.capsule.in.${m}`)}
                  </button>
                ))}
              </div>
              <span>{dateLabel(openAt, locale)}</span>
            </div>
          </section>
          <section className="lx-fm-section">
            <div className="lx-fm-head">
              <b>{tr('lx.capsule.photos')}</b>
              <div className="lx-enhance-styles lx-fm-days" role="radiogroup">
                <button role="radio" aria-checked={!allDays} className={!allDays ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setAllDays(false)}>{tr('lx.capsule.week')}</button>
                <button role="radio" aria-checked={allDays} className={allDays ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setAllDays(true)}>{tr('lx.filmMaker.allDays')}</button>
              </div>
            </div>
            <p className="lx-hint lx-fm-hint">{tr('lx.capsule.pickHint', { max: MAX })}</p>
            <div className="lx-fm-grid">
              {candidates.map(p => {
                const n = ids.indexOf(p.id);
                return (
                  <button key={p.id} className={n >= 0 ? 'lx-fm-pick on' : 'lx-fm-pick'} onClick={() => toggle(p.id)} aria-pressed={n >= 0}>
                    <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
                    {n >= 0 && <span className="lx-fm-num"><Icon name="check" size={12} /></span>}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
      {!sealing && (
        <div className="lx-viewer-info">
          <div className="lx-decide-actions">
            <button className="lx-btn primary" disabled={ids.length === 0} onClick={() => void seal()}><Icon name="lock" size={18} /> {tr('lx.capsule.seal')}</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

/** Deschiderea: capsula se crapă în lumină, mesajul apare literă cu literă, apoi pozele. */
export function CapsuleOpen({ capsule, onClose }: { capsule: Capsule; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const photos = useStore(s => s.photos);
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState(0);
  const [film, setFilm] = useState(false);
  const ids = capsule.photoIds.filter(id => photos.some(p => p.id === id));
  useEffect(() => { markSeen(capsule.id); }, [capsule.id]);
  useEffect(() => {
    if (stage !== 0) return;
    const t = window.setTimeout(() => setStage(1), 1600);
    return () => window.clearTimeout(t);
  }, [stage]);
  useEffect(() => {
    if (stage !== 1) return;
    if (typed >= capsule.message.length) { const t = window.setTimeout(() => setStage(2), capsule.message ? 500 : 0); return () => window.clearTimeout(t); }
    const t = window.setTimeout(() => setTyped(n => n + 1), 32);
    return () => window.clearTimeout(t);
  }, [stage, typed, capsule.message]);
  return createPortal(
    <div className="lx lx-enhance lx-capsule-open" role="dialog" aria-modal="true" aria-label={tr('lx.capsule.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.capsule.fromDate', { date: dateLabel(capsule.createdAt, locale) })}</span>
        <span />
      </header>
      <div className="lx-capsule-stage" onClick={() => { if (stage === 0) setStage(1); else if (stage === 1) setTyped(capsule.message.length); }}>
        <div className={stage === 0 ? 'lx-capsule-orb' : 'lx-capsule-orb open'}><Icon name={stage === 0 ? 'lock' : 'sparkle'} size={44} /></div>
        {stage >= 1 && capsule.message && <p className="lx-capsule-msg typed">„{capsule.message.slice(0, typed)}{typed < capsule.message.length ? '▍' : '”'}</p>}
        {stage === 0 && <p className="lx-capsule-msg">{tr('lx.capsule.tapToOpen')}</p>}
        {stage === 2 && (
          <div className="lx-capsule-photos">
            {ids.map((id, i) => {
              const p = photos.find(x => x.id === id)!;
              return (
                <button key={id} style={{ animationDelay: `${i * 90}ms` }} onClick={e => { e.stopPropagation(); onClose(); useLx.getState().openViewer(ids, i); }}>
                  <Thumb id={id} lqip={p.lqip} edits={p.edits} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      {stage === 2 && burstFilmAvailable() && ids.length >= 2 && (
        <div className="lx-viewer-info">
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => setFilm(true)}><Icon name="film" size={18} /> {tr('lx.onThisDay.film')}</button>
          </div>
        </div>
      )}
      {film && <FilmCreator startId={ids[0]} initialIds={ids} initialTransition="fade" onClose={() => setFilm(false)} />}
    </div>,
    document.body
  );
}

/** Pe Azi: capsulele deschise (cu evidențiere cât sunt noi), cele sigilate și invitația. */
export function CapsuleCard() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const list = useCapsules();
  const photos = useLxPhotos();
  const notifyText = useNotifyText();
  const [making, setMaking] = useState(false);
  const [opening, setOpening] = useState<Capsule | null>(null);
  // Alarmele capsulelor sigilate se refac la fiecare pornire.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { rescheduleCapsules(notifyText); }, []);
  const now = Date.now();
  const fresh = list.filter(c => isOpen(c, now) && !c.seen);
  const opened = list.filter(c => isOpen(c, now) && c.seen);
  const sealed = list.filter(c => !isOpen(c, now)).sort((a, b) => a.openAt - b.openAt);
  const todayKept = useMemo(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    return photos.filter(p => photoTime(p) >= d0.getTime() && p.status === 'selected').map(p => p.id);
  }, [photos]);
  // Fără capsule: crearea e în Studio; aici apar doar cele sigilate și cele deschise.
  if (!list.length) return null;
  return (
    <>
      {fresh.map(c => (
        <button key={c.id} className="lx-card lx-capsule-card fresh" onClick={() => setOpening(c)}>
          <span className="lx-capsule-mini open"><Icon name="sparkle" size={22} /></span>
          <span><b>{tr('lx.capsule.openedTitle')}</b><small>{tr('lx.capsule.fromDate', { date: dateLabel(c.createdAt, locale) })}</small></span>
          <span aria-hidden="true">›</span>
        </button>
      ))}
      <section className="lx-card lx-capsule-card">
        <span className="lx-capsule-mini"><Icon name="lock" size={20} /></span>
        <span>
          <b>{tr('lx.capsule.title')}</b>
          <small>{sealed.length
            ? tr('lx.capsule.next', { count: sealed.length, date: dateLabel(sealed[0].openAt, locale) })
            : tr('lx.capsule.invite')}</small>
        </span>
        <button className="lx-btn ghost small" onClick={() => setMaking(true)}>{tr('lx.capsule.create')}</button>
      </section>
      {opened.length > 0 && (
        <div className="lx-chips lx-capsule-past">
          {opened.map(c => <button key={c.id} className="lx-chip-btn" onClick={() => setOpening(c)}>{dateLabel(c.createdAt, locale, false)}</button>)}
        </div>
      )}
      {making && <CapsuleCreator initialIds={todayKept} onClose={() => setMaking(false)} />}
      {opening && <CapsuleOpen capsule={opening} onClose={() => setOpening(null)} />}
    </>
  );
}
