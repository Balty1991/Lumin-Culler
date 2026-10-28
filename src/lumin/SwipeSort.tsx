import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStore } from '../state/store';
import { RitualDone } from '../ui/RitualDone';
import { reasonsFor } from './reasons';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';

type Verdict = 'keep' | 'drop' | 'unsure';
/** Cât trebuie tras cardul ca să conteze ca decizie. */
const COMMIT_PX = 96;
const FLY_MS = 220;

/**
 * lumin/SwipeSort.tsx
 * Sortarea: un pachet de carduri. Dreapta = Păstrez, stânga = Nu azi.
 * Pe fiecare card, ce crede AI-ul (cu motivul) ÎNAINTE să decizi; după
 * decizie, dacă nu ați fost de acord, AI-ul spune că a notat lecția.
 * Swipe-ul doar marchează: la final, un singur buton mută „Nu azi” în coș.
 */
export function SwipeSort() {
  const ids = useLx(s => s.sortIds);
  const title = useLx(s => s.sortTitle);
  const close = useLx(s => s.closeSort);
  const photos = useStore(s => s.photos);
  const setStatus = useStore(s => s.setStatus);
  const undo = useStore(s => s.undo);
  const tr = useTr();

  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const [decisions, setDecisions] = useState(0);
  const [lesson, setLesson] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);

  // Ce credea AI-ul la deschidere: decizia ta de acum nu-i schimbă părerea de atunci.
  const [aiView, setAiView] = useState<Map<string, Verdict>>(new Map());
  useEffect(() => {
    if (!ids) return;
    const byId = new Map(useStore.getState().photos.map(p => [p.id, p]));
    setAiView(new Map(ids.map(id => {
      const s = byId.get(id)?.status;
      return [id, s === 'selected' ? 'keep' : s === 'rejected' ? 'drop' : 'unsure'] as [string, Verdict];
    })));
    setIndex(0);
    setDx(0);
    setDecisions(0);
    setLesson(null);
  }, [ids]);

  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const queue = useMemo(() => (ids ?? []).filter(id => byId.has(id)), [ids, byId]);
  const current = index < queue.length ? byId.get(queue[index]) : undefined;
  const next = index + 1 < queue.length ? byId.get(queue[index + 1]) : undefined;

  useEffect(() => {
    if (!lesson) return;
    const t = window.setTimeout(() => setLesson(null), 1800);
    return () => window.clearTimeout(t);
  }, [lesson]);

  if (!ids) return null;

  const decide = (keep: boolean) => {
    if (!current || flying) return;
    const ai = aiView.get(current.id) ?? 'unsure';
    setFlying(keep ? 'right' : 'left');
    void setStatus(current.id, keep ? 'selected' : 'rejected');
    setDecisions(n => n + 1);
    if ((ai === 'keep' && !keep) || (ai === 'drop' && keep)) setLesson(tr(keep ? 'lx.sort.lessonKeep' : 'lx.sort.lessonDrop'));
    window.setTimeout(() => { setFlying(null); setDx(0); setIndex(i => i + 1); }, FLY_MS);
  };
  const back = () => {
    if (index === 0 || flying) return;
    void undo();
    setIndex(i => i - 1);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (flying) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setDx(e.clientX - drag.current.x);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dx > COMMIT_PX) decide(true);
    else if (dx < -COMMIT_PX) decide(false);
    else setDx(0);
  };

  const ai = current ? aiView.get(current.id) ?? 'unsure' : 'unsure';
  const series = current?.groupId ? photos.filter(p => p.groupId === current.groupId) : [];
  const seriesBest = series.length > 1 ? [...series].sort((a, b) => b.aiScore - a.aiScore)[0] : null;
  const offset = flying === 'right' ? 520 : flying === 'left' ? -520 : dx;
  const intent = offset > 30 ? 'keep' : offset < -30 ? 'drop' : null;

  return (
    <div className="lx-sort" role="dialog" aria-modal="true" aria-label={title ?? tr('lx.sort.title')}>
      <header className="lx-sort-top">
        <button className="lx-icon-btn" onClick={close} aria-label={tr('lx.close')}>✕</button>
        <div className="lx-sort-title">
          <b>{title ?? tr('lx.sort.title')}</b>
          {current && <span>{index + 1} / {queue.length}</span>}
        </div>
        <button className="lx-icon-btn" onClick={back} disabled={index === 0} aria-label={tr('lx.undo')}>↺</button>
      </header>
      {current && (
        <div className="lx-sort-bar" aria-hidden="true"><i style={{ width: `${(index / queue.length) * 100}%` }} /></div>
      )}

      {current ? (
        <>
          <div className="lx-deck">
            {next && (
              <div className="lx-card-photo under" aria-hidden="true">
                <Thumb id={next.id} lqip={next.lqip} className="lx-card-img" />
              </div>
            )}
            <div
              className={`lx-card-photo top${flying ? ' flying' : ''}${drag.current ? ' dragging' : ''}`}
              style={{ transform: `translateX(${offset}px) rotate(${offset / 22}deg)` }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            >
              <Thumb key={current.id} id={current.id} lqip={current.lqip} full className="lx-card-img" />
              <span className={`lx-stamp keep${intent === 'keep' ? ' on' : ''}`}>{tr('lx.keep')}</span>
              <span className={`lx-stamp drop${intent === 'drop' ? ' on' : ''}`}>{tr('lx.notToday')}</span>
              <div className="lx-card-ai">
                <span className={`lx-verdict ${ai}`}>
                  <i className="lx-dot" />{tr(`lx.ai.${ai}`)}
                  <b>{current.aiScore}</b>
                </span>
                <div className="lx-chips">
                  {reasonsFor(current).map(r => <span key={r.key} className={`lx-chip ${r.tone}`}>{tr(r.key)}</span>)}
                </div>
                {seriesBest && (
                  <span className="lx-series-note">
                    {seriesBest.id === current.id
                      ? tr('lx.sort.seriesBest', { count: series.length })
                      : tr('lx.sort.seriesOther', { count: series.length })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {lesson && <div className="lx-lesson" role="status">{lesson}</div>}

          <div className="lx-sort-actions">
            <button className="lx-round drop" onClick={() => decide(false)} aria-label={tr('lx.notToday')}>
              <span>✕</span><small>{tr('lx.notToday')}</small>
            </button>
            <button className="lx-round keep" onClick={() => decide(true)} aria-label={tr('lx.keep')}>
              <span>✓</span><small>{tr('lx.keep')}</small>
            </button>
          </div>
        </>
      ) : (
        <div className="lx-sort-done">
          <div className="lx-done-wrap">
            <RitualDone ids={queue} decided={decisions} />
          </div>
          <button className="lx-btn primary wide" onClick={close}>{tr('lx.sort.finish')}</button>
        </div>
      )}
    </div>
  );
}
