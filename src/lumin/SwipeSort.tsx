import { usePacedPhotos } from './useLxPhotos';
import { isBeginner } from './beginner';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStore } from '../state/store';
import { RitualDone } from '../ui/RitualDone';
import { recordDailyGuess } from '../core/tasteScore';
import { recordPersonDecision } from '../core/personTaste';
import { readTwin, recordTwinDecision } from './twin';
import { SELECT_THRESHOLD, REJECT_THRESHOLD } from '../core/importPipeline';
import { personalWhy, useWhyContext } from './why';
import { CloudLine } from './CloudParts';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { haptic } from '../core/device';
import { claimPaywall, setPaywallContext } from './paywallMoment';
import { t } from '../i18n';
import { useHoldAnalysis } from './useHoldAnalysis';
import { renderDayCard, shareCard } from './shareCards';
import { getDisplayUrl } from '../core/previewUrlCache';
import { Icon } from './icons';
import { intlTag } from '../i18n';
import { readRitualDays } from '../core/ritualStreak';
import { startOfDay } from '../core/todayDigest';
import { beautyScore } from './beauty';

type Verdict = 'keep' | 'drop' | 'unsure';
/** Cât trebuie tras cardul ca să conteze ca decizie. */
const COMMIT_PX = 96;
const FLY_MS = 220;
/** Unde ar trage linia un AI generic între „păstrez” și „nu”. */
const MIDPOINT = (SELECT_THRESHOLD + REJECT_THRESHOLD) / 2;

/**
 * lumin/SwipeSort.tsx
 * Sortarea: un pachet de carduri. Dreapta = Păstrez, stânga = Nu azi.
 * Pe fiecare card, ce crede AI-ul (cu motivul) ÎNAINTE să decizi; după
 * decizie, dacă nu ați fost de acord, AI-ul spune că a notat lecția.
 * Swipe-ul doar marchează: la final, un singur buton mută „Nu azi” în coș.
 */
export function SwipeSort() {
  useHoldAnalysis();
  const ids = useLx(s => s.sortIds);
  const title = useLx(s => s.sortTitle);
  const close = useLx(s => s.closeSort);
  const ritual = useLx(s => s.sortRitual);
  // Cronometrul ritualului: 60 s, fără presiune — după minut doar spune că a trecut.
  const [elapsed, setElapsed] = useState(0);
  const [took, setTook] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const photos = usePacedPhotos();
  const setStatus = useStore(s => s.setStatus);
  const undo = useStore(s => s.undo);
  const tr = useTr();
  const why = useWhyContext();

  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const [decisions, setDecisions] = useState(0);
  const [lesson, setLesson] = useState<string | null>(null);
  /** Alt cadru din aceeași rafală, adus în față fără să schimbe rândul pachetului. */
  const [peek, setPeek] = useState<string | null>(null);
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
    startedAt.current = Date.now(); setElapsed(0); setTook(null);
    setLesson(null);
    setPeek(null);
  }, [ids]);

  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const queue = useMemo(() => (ids ?? []).filter(id => byId.has(id)), [ids, byId]);
  const current = index < queue.length ? byId.get(queue[index]) : undefined;
  const next = index + 1 < queue.length ? byId.get(queue[index + 1]) : undefined;
  const shown = (peek && byId.get(peek)) || current;
  useEffect(() => {
    if (!ritual) return;
    if (!current) { setTook(t => t ?? Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))); return; }
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [ritual, !current]);
  // După ce rezultatul e pe ecran (coada s-a terminat), nu în timpul alegerilor.
  useEffect(() => {
    if (current || decisions < 7 || !useStore.getState().premiumLocked) return;
    const timer = window.setTimeout(() => {
      const st = useStore.getState();
      // Nu în primele zile: omul încă învață aplicația (auditul pe persoane).
      if (!st.premiumLocked || isBeginner(st.photos) || !claimPaywall()) return;
      const percent = readTwin().percent;
      setPaywallContext(percent === null
        ? t(st.locale, 'lx.paywall.afterSortPlain', { count: decisions })
        : t(st.locale, 'lx.paywall.afterSort', { percent }));
      useStore.setState({ premiumOpen: true, premiumReason: 'acceptAll' });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [current, decisions]);

  useEffect(() => {
    if (!lesson) return;
    const t = window.setTimeout(() => setLesson(null), 1800);
    return () => window.clearTimeout(t);
  }, [lesson]);

  if (!ids) return null;

  const decide = (keep: boolean) => {
    if (!shown || flying) return;
    haptic(keep ? 'confirm' : 'reject');
    if (!peek && index + 1 === queue.length) window.setTimeout(() => haptic('success'), 260);
    const ai = aiView.get(shown.id) ?? 'unsure';
    void setStatus(shown.id, keep ? 'selected' : 'rejected');
    recordPersonDecision(shown.personNames, keep);
    if ((ai === 'keep' && !keep) || (ai === 'drop' && keep)) setLesson(tr(keep ? 'lx.sort.lessonKeep' : 'lx.sort.lessonDrop'));
    // Și la pozele „nesigure” AI-ul are o înclinație (scorul față de mijloc), luată ÎNAINTE de
    // alegerea omului. Fără ea, sesiunile (făcute mai ales din poze nesigure) nu numărau nimic,
    // iar după 90 de alegeri tot scria „Antrenează-l” (raportat).
    const aiKeep = ai === 'unsure' ? shown.aiScore >= MIDPOINT : ai === 'keep';
    const generic = shown.aiScore - (shown.aiPersonalDelta ?? 0);
    recordDailyGuess({ personal: aiKeep, generic: generic >= MIDPOINT }, keep);
    recordTwinDecision(aiKeep, keep, { firm: ai !== 'unsure', people: (shown.faceCount ?? 0) > 0 });
    if (peek && peek !== current?.id) { setPeek(null); return; }
    setDecisions(n => n + 1);
    setFlying(keep ? 'right' : 'left');
    window.setTimeout(() => { setFlying(null); setDx(0); setPeek(null); setIndex(i => i + 1); }, FLY_MS);
  };
  const later = () => {
    if (!shown || flying) return;
    haptic('tick');
    void setStatus(shown.id, 'candidate');
    if (peek && peek !== current?.id) { setPeek(null); return; }
    setPeek(null);
    setIndex(i => i + 1);
  };
  const showFrame = (id: string) => {
    const at = queue.indexOf(id);
    if (at >= 0) { setPeek(null); setIndex(at); setDx(0); return; }
    setPeek(id);
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
    const next = e.clientX - drag.current.x;
    // O bătaie fină când cardul trece pragul de decizie (în ambele sensuri).
    if ((Math.abs(next) > COMMIT_PX) !== (Math.abs(dx) > COMMIT_PX)) haptic('tick');
    setDx(next);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dx > COMMIT_PX) decide(true);
    else if (dx < -COMMIT_PX) decide(false);
    else setDx(0);
  };

  const ai = shown ? aiView.get(shown.id) ?? 'unsure' : 'unsure';
  const series = shown?.groupId ? photos.filter(p => p.groupId === shown.groupId && !p.aside) : [];
  const seriesBest = series.length > 1 ? [...series].sort((a, b) => b.aiScore - a.aiScore)[0] : null;
  const offset = flying === 'right' ? 520 : flying === 'left' ? -520 : dx;
  const intent = offset > 30 ? 'keep' : offset < -30 ? 'drop' : null;

  return (
    <div className="lx-sort" role="dialog" aria-modal="true" aria-label={title ?? tr('lx.sort.title')}>
      {shown?.lqip && <div className="lx-sort-ambient" aria-hidden="true" style={{ backgroundImage: `linear-gradient(rgb(4 5 10 / .35), rgb(4 5 10 / .84)), url("${shown.lqip}")` }} />}
      <header className="lx-sort-top">
        <button className="lx-icon-btn" onClick={close} aria-label={tr('lx.close')}>✕</button>
        <div className="lx-sort-title">
          <b>{title ?? tr('lx.sort.title')}</b>
          {current && <span>{index + 1} / {queue.length}</span>}
          {ritual && current && (
            <span className={`lx-ritual-ring${elapsed >= 60 ? ' over' : ''}`} style={{ ['--p' as string]: Math.min(1, elapsed / 60) }} role="timer" aria-label={`${Math.max(0, 60 - elapsed)} s`}>
              <b>{Math.max(0, 60 - elapsed)}</b>
            </span>
          )}
        </div>
        <button className="lx-icon-btn" onClick={back} disabled={index === 0} aria-label={tr('lx.undo')}>↺</button>
      </header>
      {current && (
        <div className="lx-sort-bar" aria-hidden="true"><i style={{ width: `${(index / queue.length) * 100}%` }} /></div>
      )}

      {current && shown ? (
        <>
          <div className="lx-deck">
            {next && (
              <div className="lx-card-photo under" aria-hidden="true">
                <Thumb id={next.id} lqip={next.lqip} edits={next.edits} className="lx-card-img" />
              </div>
            )}
            <div
              className={`lx-card-photo top${flying ? ' flying' : ''}${drag.current ? ' dragging' : ''}`}
              style={{ transform: `translateX(${offset}px) rotate(${offset / 22}deg)` }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            >
              {/* Poza întreagă (raportat: „nu o văd în întregime”), pe un fundal estompat din ea. */}
              <Thumb key={`bg-${shown.id}`} id={shown.id} lqip={shown.lqip} edits={shown.edits} className="lx-card-img lx-card-bg" />
              <Thumb key={shown.id} id={shown.id} lqip={shown.lqip} edits={shown.edits} full className="lx-card-img lx-card-whole" />
              <span className={`lx-stamp keep${intent === 'keep' ? ' on' : ''}`}>{tr('lx.keep')}</span>
              <span className={`lx-stamp drop${intent === 'drop' ? ' on' : ''}`}>{tr('lx.notToday')}</span>
              <div className="lx-card-ai">
                <span className={`lx-verdict ${ai}`}>
                  <i className="lx-dot" />{tr(`lx.ai.${ai}`)}
                  <b>{shown.aiScore}</b>
                </span>
                <p className="lx-why">{personalWhy(shown, why, tr)}</p>
                <CloudLine id={shown.id} />
                {seriesBest && (
                  <span className="lx-series-note">
                    {seriesBest.id === shown.id
                      ? tr('lx.sort.seriesBest', { count: series.length })
                      : tr('lx.sort.seriesOther', { count: series.length })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {series.length > 1 && (
            <div className="lx-sort-series" onPointerDown={e => e.stopPropagation()}>
              {series.slice(0, 8).map(p => (
                <button key={p.id} type="button" className={p.id === shown.id ? 'on' : ''} onClick={() => showFrame(p.id)} aria-label={tr('lx.sort.seriesPick')}>
                  <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
                </button>
              ))}
            </div>
          )}

          {lesson && <div className="lx-lesson" role="status">{lesson}</div>}
          {ritual && !lesson && elapsed >= 60 && elapsed < 66 && <div className="lx-lesson" role="status">{tr('lx.ritual60.over')}</div>}

          <div className="lx-sort-actions">
            <button className="lx-round drop" onClick={() => decide(false)} aria-label={tr('lx.notToday')}>
              <span>✕</span><small>{tr('lx.notToday')}</small>
            </button>
            <button className="lx-round later" onClick={later} aria-label={tr('lx.sort.later')}>
              <span>→</span><small>{tr('lx.sort.later')}</small>
            </button>
            <button className="lx-round keep" onClick={() => decide(true)} aria-label={tr('lx.keep')}>
              <span>✓</span><small>{tr('lx.keep')}</small>
            </button>
          </div>
        </>
      ) : (
        <div className="lx-sort-done">
          {ritual && decisions > 0 && <DayRecap ids={queue} seconds={took} />}
          <div className="lx-done-wrap">
            <RitualDone ids={queue} decided={decisions} />
          </div>
          <button className="lx-btn primary wide" onClick={close}>{tr('lx.sort.finish')}</button>
        </div>
      )}
    </div>
  );
}

/** Finalul ritualului: cele mai bune trei poze păstrate azi, timpul și săptămâna ta. */
function DayRecap({ ids, seconds }: { ids: readonly string[]; seconds: number | null }) {
  const tr = useTr();
  const photos = usePacedPhotos();
  const top = useMemo(() => {
    const set = new Set(ids);
    return photos.filter(p => set.has(p.id) && p.status === 'selected')
      .sort((a, b) => beautyScore(b) - beautyScore(a)).slice(0, 3);
  }, [ids, photos]);
  // Ultimele 7 zile, de la stânga (acum 6 zile) la dreapta (azi).
  const week = useMemo(() => {
    const done = new Set(readRitualDays().map(d => startOfDay(d)));
    const today = startOfDay(Date.now());
    done.add(today);
    return Array.from({ length: 7 }, (_, k) => { const d = new Date(today); d.setDate(d.getDate() - (6 - k)); return done.has(startOfDay(d.getTime())); });
  }, []);
  const [sharing, setSharing] = useState(false);
  if (!top.length) return null;
  return (
    <div className="lx-recap">
      <span className="lx-kicker">{tr('lx.ritual60.recap')}{seconds ? ` · ${tr('lx.ritual60.time', { seconds })}` : ''}</span>
      <div className={`lx-recap-grid n${top.length}`}>
        {top.map((p, i) => (
          <button key={p.id} onClick={() => useLx.getState().openViewer(top.map(x => x.id), i)}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></button>
        ))}
      </div>
      <button className="lx-btn ghost small lx-recap-share" disabled={sharing} onClick={() => {
        setSharing(true);
        void (async () => {
          const urls = (await Promise.all(top.map(p => getDisplayUrl(p.id).catch(() => null)))).filter((u): u is string => !!u);
          const line = tr('lx.ritual60.cardLine', { count: top.length });
          const date = new Date().toLocaleDateString(intlTag(useStore.getState().locale), { weekday: 'long', day: 'numeric', month: 'long' });
          const blob = await renderDayCard(urls, line, date, tr('lx.share.cta'));
          if (blob) await shareCard(blob, `cherrypic-ziua-${Date.now()}.jpg`, line, tr('lx.share.cta'));
        })().catch(() => undefined).finally(() => setSharing(false));
      }}><Icon name="share" size={16} /> {tr('lx.ritual60.share')}</button>
      <div className="lx-recap-week" aria-label={tr('lx.ritual60.week')}>
        <span>{tr('lx.ritual60.week')}</span>
        {week.map((on, k) => <i key={k} className={on ? 'on' : ''} />)}
      </div>
    </div>
  );
}
