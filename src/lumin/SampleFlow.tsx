import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { selectBlinks, selectBlurry } from '../state/batchOps';
import { openTasteQuiz, readTasteQuizDone } from '../state/tasteQuiz';
import { analysisPool } from '../core/workerPool';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { seriesExtras } from './LumiFeed';
import { EnhanceSheet } from './Enhance';
import { startFullRead, storedSampleResult } from './galleryReader';
import { useLxPhotos } from './useLxPhotos';
import { translateSceneTag } from '../core/sceneTagLabels';
import { useEngines } from './engines';
import { useModelsState } from './aiModels';
import { recordPair } from '../core/learning/pairs';

/**
 * lumin/SampleFlow.tsx
 * Drumul unui om nou, după motoarele AI:
 *  1. „Prima privire”: cele mai noi ~150 de poze, citite în 2–3 minute (galleryReader).
 *  2. Rezultatul, pe Azi: câte a ales, serii, neclare, ochi închiși, cele mai bune poze, și
 *     trei pași: antrenează AI-ul, încearcă editorul, analizează toată galeria.
 *  3. „Lucrez la galeria ta”: ecran opțional, cu progres și viteză maximă; se poate închide
 *     oricând (aplicația rămâne folosibilă: citirea stă cât omul atinge ecranul).
 */
export function SampleResultCard() {
  const tr = useTr();
  const live = useLx(s => s.sampleResult);
  const setSampleResult = useLx(s => s.setSampleResult);
  const setWorkMode = useLx(s => s.setWorkMode);
  const reader = useLx(s => s.reader);
  const setTab = useLx(s => s.setTab);
  const photos = useLxPhotos();
  const [editing, setEditing] = useState<PhotoView | null>(null);
  const result = live ?? storedSampleResult();
  const sum = useMemo(() => {
    if (!result) return null;
    const ids = new Set(result.ids);
    const mine = photos.filter(p => ids.has(p.id));
    if (!mine.length) return null;
    const real = mine.filter(p => !p.aside);
    const kept = real.filter(p => p.status === 'selected');
    // „Cele mai bune” înseamnă oameni: o cutie de pastile păstrată nu are ce căuta aici (raportat).
    const withPeople = kept.filter(p => (p.faceCount ?? 0) > 0);
    const best = [...(withPeople.length >= 2 ? withPeople : kept)].sort((a, b) => b.aiScore - a.aiScore);
    return {
      total: mine.length,
      kept: kept.length,
      series: seriesExtras(real).extras.length,
      blurry: selectBlurry(real).length,
      blinks: selectBlinks(real).length,
      aside: mine.length - real.length,
      best: best.slice(0, 4)
    };
  }, [result, photos]);
  if (!result || !sum || reader) return null;
  const full = () => {
    setSampleResult(null);
    setWorkMode(true);
    void startFullRead();
  };
  const facts = [
    sum.series > 0 && tr('lx.sample.series', { count: sum.series }),
    sum.blurry > 0 && tr('lx.sample.blurry', { count: sum.blurry }),
    sum.blinks > 0 && tr('lx.sample.blinks', { count: sum.blinks }),
    sum.aside > 0 && tr('lx.sample.aside', { count: sum.aside })
  ].filter(Boolean) as string[];
  return (
    <section className="lx-card lx-sample" role="status">
      <span className="lx-eyebrow">{tr('lx.sample.eyebrow')}</span>
      <b className="lx-sample-title">{tr('lx.sample.title', { total: sum.total, kept: sum.kept })}</b>
      {facts.length > 0 && <div className="lx-sample-facts">{facts.map(f => <span key={f}>{f}</span>)}</div>}
      {sum.best.length > 0 && (
        <div className="lx-sample-best" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
          {sum.best.map((p, i) => (
            <button key={p.id} style={{ aspectRatio: '1', overflow: 'hidden', position: 'relative', padding: 0, border: 0, borderRadius: 14 }} onClick={() => useLx.getState().openViewer(sum.best.map(x => x.id), i)}>
              <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
            </button>
          ))}
        </div>
      )}
      <div className="lx-sample-steps">
        {!readTasteQuizDone() && (
          <button className="lx-sample-step" onClick={openTasteQuiz}>
            <i aria-hidden="true">🎯</i><span><b>{tr('lx.sample.train')}</b><small>{tr('lx.sample.trainSub')}</small></span>
          </button>
        )}
        {sum.best[0] && (
          <button className="lx-sample-step" onClick={() => setEditing(sum.best[0])}>
            <i aria-hidden="true">✨</i><span><b>{tr('lx.sample.edit')}</b><small>{tr('lx.sample.editSub')}</small></span>
          </button>
        )}
        <button className="lx-sample-step" onClick={() => setTab('days')}>
          <i aria-hidden="true">🖼️</i><span><b>{tr('lx.sample.see')}</b><small>{tr('lx.sample.seeSub')}</small></span>
        </button>
      </div>
      <button className="lx-btn primary wide" onClick={full}>
        {result.left > 0 ? tr('lx.sample.full', { count: result.left }) : tr('lx.sample.fullPlain')}
      </button>
      <small className="lx-sample-note">{tr('lx.sample.fullNote')}</small>
      {editing && <EnhanceSheet photo={editing} recipe="perfect" onClose={() => setEditing(null)} />}
    </section>
  );
}

/** Ecranul „Lucrez la galeria ta”: opțional, cu viteză maximă cât e deschis. */
export function WorkModeOverlay() {
  const tr = useTr();
  const open = useLx(s => s.workMode);
  const setWorkMode = useLx(s => s.setWorkMode);
  const reader = useLx(s => s.reader);
  const photos = useStore(s => s.photos);
  // Ritmul din ultimele poze (cel mult ~40), nu de la început: primele poze mergeau repede și
  // estimarea sărea de la „~6 min” la „~2 h” (raportat cu capturi).
  const samples = useRef<{ at: number; done: number }[]>([]);
  const shownEta = useRef<number | null>(null);
  const started = useRef<{ at: number; done: number } | null>(null);
  const [finished, setFinished] = useState(false);
  // Prima privire (1–3 min) se arată singură pe acest ecran, pe viteză maximă, ca omul să nu
  // umble prin aplicație cât lucrează (cerut). „Folosesc aplicația între timp” o închide.
  const sampling = useLx(s => s.sampling);
  const sampleRun = useRef(false);
  useEffect(() => {
    if (sampling && !sampleRun.current) { sampleRun.current = true; setWorkMode(true); }
  }, [sampling, setWorkMode]);
  const forSample = sampleRun.current;
  const close = () => {
    setWorkMode(false);
    if (forSample && finished) useLx.getState().setTab('today');
    sampleRun.current = sampling;
  };
  useEffect(() => {
    if (!open) { started.current = null; samples.current = []; shownEta.current = null; setFinished(false); return; }
    // Cât e deschis, nimeni nu atinge aplicația: analiza merge plin.
    analysisPool.setGentle(false);
    analysisPool.setBackground(false);
    analysisPool.setFocus(true);
    return () => {
      analysisPool.setFocus(false);
      if (useLx.getState().reader) { analysisPool.setGentle(true); analysisPool.setBackground(true); }
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (reader && !started.current) started.current = { at: Date.now(), done: reader.done };
    if (reader) {
      const list = samples.current;
      if (!list.length || list[list.length - 1].done !== reader.done) list.push({ at: Date.now(), done: reader.done });
      while (list.length > 2 && list[list.length - 1].done - list[1].done >= 40) list.shift();
    }
    if (!reader && started.current) setFinished(true);
  }, [open, reader]);
  // Ce s-a citit de când e deschis ecranul: scanerul arată ultima poză, cu ce a văzut AI-ul
  // în ea, iar descoperirile (fețe, serii, neclare, ochi închiși) cresc pe loc. Primele minute
  // decid dacă omul rămâne: să vadă AI-ul lucrând pe pozele LUI, nu doar un procent.
  const locale = useStore(s => s.locale);
  // Înainte de citire: descărcarea motoarelor AI, pe același ecran (un singur drum, nu o fereastră
  // și apoi un card mic pe Azi).
  const eng = useEngines();
  const models = useModelsState();
  const preparing = !reader && (!!eng.busy || models.phase === 'downloading');
  const prepPct = Math.round(100 * (eng.busy ? eng.progress : models.progress));
  const base = useRef<Set<string> | null>(null);
  if (open && !base.current) base.current = new Set(photos.map(p => p.id));
  if (!open && base.current) base.current = null;
  const live = useMemo(() => {
    const fresh = base.current ? photos.filter(p => !base.current!.has(p.id)) : [];
    const real = fresh.filter(p => !p.aside);
    const kept = real.filter(p => p.status === 'selected');
    const withPeople = kept.filter(p => p.faceCount > 0);
    return {
      real,
      latest: real[real.length - 1] ?? fresh[fresh.length - 1],
      faces: real.reduce((a, p) => a + (p.faceCount || 0), 0),
      series: seriesExtras(real).extras.length,
      blurry: selectBlurry(real).length,
      blinks: selectBlinks(real).length,
      best: [...(withPeople.length >= 2 ? withPeople : kept)].sort((a, b) => b.aiScore - a.aiScore).slice(0, 4)
    };
  }, [photos, open]); // eslint-disable-line react-hooks/exhaustive-deps -- base se schimbă odată cu open
  // „Te-am ghicit?”: la final, 12 alegeri ale AI-ului din prima citire, jumătate păstrate,
  // jumătate scoase, puse pe rând. Omul confirmă sau corectează cu un deget; fiecare răspuns
  // intră în „copia ta” (twin.ts), deci procentul „aleg ca tine” apare din prima zi. Scopul
  // aplicației e un AI care alege ca omul, nu un raport: asta e dovada, chiar de la început.
  const guessIds = useMemo(() => pickGuessIds(live.real), [live.real]);
  // Ultimele poze citite, ca „orbită” în jurul inelului.
  // Pozele adevărate (nu capturile și documentele), cele mai noi citite.
  const orbit = useMemo(() => {
    const real = photos.filter(p => !p.aside);
    return (real.length >= 8 ? real : photos).slice(-8).reverse();
  }, [photos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const done = reader?.done ?? 0;
  const total = reader?.total ?? 0;
  const pct = finished ? 100 : preparing ? prepPct : total ? Math.round((done / total) * 100) : 0;
  let eta = '';
  // Media de la deschiderea ecranului (nu doar ultimele poze: pachetele vin în rafale, iar
  // capturile cu text merg mai încet, așa că estimarea sărea între 9 min și 2 h — raportat).
  // Afișată abia după 30 de poze și un minut, și schimbată doar când diferă cu peste 30%.
  const s0 = started.current;
  if (reader && s0 && done - s0.done >= 30 && Date.now() - s0.at >= 60_000) {
    const rate = (done - s0.done) / ((Date.now() - s0.at) / 60000);
    const raw = Math.max(1, Math.round((total - done) / Math.max(rate, 0.5)));
    const prev = shownEta.current;
    const min = prev && Math.abs(raw - prev) / prev < 0.3 ? Math.min(prev, raw) : raw;
    shownEta.current = min;
    // Rotunjit cum vorbește un om: minute până la o oră și jumătate, apoi ore întregi.
    eta = min >= 90 ? tr('lx.work.etaH', { hours: Math.round(min / 60) }) : tr('lx.work.etaMin', { minutes: min < 10 ? min : Math.round(min / 5) * 5 });
  } else if (reader && !finished) {
    eta = tr('lx.work.etaWait');
  }
  return createPortal(
    <div className="lx lx-work" role="dialog" aria-modal="true" aria-label={tr('lx.work.title')}>
      <div className="lx-work-aurora" aria-hidden="true" />
      <div className="lx-work-core">
        <div className="lx-work-ring" style={{ ['--p' as string]: `${pct}` }}>
          <div className="lx-work-orbit" aria-hidden="true">
            {orbit.map((p, i) => (
              <span key={p.id} style={{ ['--i' as string]: `${i}` }}><i><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></i></span>
            ))}
          </div>
          {live.latest && !finished && (
            <div className="lx-work-eye" key={live.latest.id} aria-hidden="true">
              <Thumb id={live.latest.id} lqip={live.latest.lqip} edits={live.latest.edits} />
              <i className="lx-work-scan" />
            </div>
          )}
          <b className={live.latest && !finished ? 'lx-work-pct over' : 'lx-work-pct'}>{pct}%</b>
        </div>
        <h2>{finished ? tr('lx.work.done') : preparing ? tr('lx.work.prep') : tr(forSample ? 'lx.sample.eyebrow' : 'lx.work.title')}</h2>
        <p>{finished ? tr(forSample ? 'lx.sample.doneSub' : 'lx.work.doneSub') : preparing ? tr('lx.work.prepSub') : total ? tr('lx.work.count', { done, total }) : tr('lx.work.starting')}</p>
        {live.latest && !finished && (
          <div className="lx-work-chips" key={live.latest.id} aria-live="polite">
            {live.latest.faceCount > 0 && <span>👤 {tr('lx.work.chip.faces', { count: live.latest.faceCount })}</span>}
            {live.latest.bestSmile >= 0.5 && <span>😊 {tr('lx.work.chip.smile')}</span>}
            {live.latest.faceCount > 0 && !live.latest.allEyesOpen && <span>😑 {tr('lx.work.chip.eyes')}</span>}
            {(live.latest.sceneTags ?? []).filter(t => !/^(fun|leisure|event|skin|flesh)$/i.test(t)).slice(0, 2).map(t => <span key={t}>{translateSceneTag(t, locale)}</span>)}
            {live.latest.aiScore > 0 && <span>★ {Math.round(live.latest.aiScore)}</span>}
          </div>
        )}
        {(live.faces + live.series + live.blurry + live.blinks > 0 || finished) && (
          <div className="lx-work-found">
            <span><b>{live.faces}</b>{tr('lx.work.found.faces')}</span>
            <span><b>{live.series}</b>{tr('lx.work.found.series')}</span>
            <span><b>{live.blurry}</b>{tr('lx.work.found.blurry')}</span>
            <span><b>{live.blinks}</b>{tr('lx.work.found.blinks')}</span>
          </div>
        )}
        {finished && live.best.length > 0 && (
          <div className="lx-work-best">
            <small>{tr('lx.work.best')}</small>
            <div>{live.best.map((p, i) => <i key={p.id} style={{ ['--i' as string]: `${i}` }}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></i>)}</div>
          </div>
        )}
        {!finished && !preparing && live.real.length >= 12 && <TastePairs pool={live.real} />}
        {!finished && !forSample && eta && <p className="lx-work-eta">{eta}</p>}
        {!finished && <p className="lx-work-tip">{tr(forSample ? 'lx.sample.readingSub' : 'lx.work.tip')}</p>}
        {finished && guessIds.length >= 6 && (
          <button className="lx-btn primary wide lx-work-guess" onClick={() => { close(); markGuessDone(); useLx.getState().openSort(guessIds, tr('lx.work.guessTitle'), true); }}>
            {tr('lx.work.guess', { count: guessIds.length })}
          </button>
        )}
        <button className={finished && guessIds.length < 6 ? 'lx-btn primary wide' : 'lx-btn ghost wide'} onClick={close}>
          {finished ? tr('lx.work.see') : tr('lx.work.useApp')}
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Cât citesc pozele: „care îți place mai mult?”, de 3 ori, între două poze ale omului
 * (din aceeași serie când se poate, altfel două cu oameni, apropiate în timp). Fiecare
 * alegere e o pereche pentru modelul de gust (core/learning/pairs): AI-ul pornește deja
 * personalizat, iar așteptarea devine joc, nu timp pierdut.
 */
const PAIRS_WANTED = 3;
function pickPair(pool: readonly PhotoView[], used: ReadonlySet<string>): [PhotoView, PhotoView] | null {
  const free = pool.filter(p => !used.has(p.id));
  const groups = new Map<string, PhotoView[]>();
  for (const p of free) if (p.groupId) groups.set(p.groupId, [...(groups.get(p.groupId) ?? []), p]);
  for (const g of groups.values()) if (g.length >= 2) return [g[0], g[1]];
  const people = free.filter(p => p.faceCount > 0);
  const list = people.length >= 2 ? people : free;
  return list.length >= 2 ? [list[list.length - 2], list[list.length - 1]] : null;
}
function TastePairs({ pool }: { pool: readonly PhotoView[] }) {
  const tr = useTr();
  const [used, setUsed] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState(0);
  // Perechea rămâne pe loc până alege omul (nu sare când vin poze noi).
  const [pair, setPair] = useState<[PhotoView, PhotoView] | null>(null);
  useEffect(() => { if (!pair && done < PAIRS_WANTED) setPair(pickPair(pool, used)); }, [pool, used, pair, done]);
  if (done >= PAIRS_WANTED) return <p className="lx-work-pick-done">✓ {tr('lx.work.pickDone', { count: done })}</p>;
  if (!pair) return null;
  const choose = (w: PhotoView, l: PhotoView) => {
    recordPair(w.id, l.id);
    setUsed(u => new Set([...u, w.id, l.id]));
    setDone(d => d + 1);
    setPair(null);
  };
  return (
    <div className="lx-work-pick" key={pair[0].id + pair[1].id}>
      <small>{tr('lx.work.pick')} <span>{done + 1}/{PAIRS_WANTED}</span></small>
      <div>
        <button onClick={() => choose(pair[0], pair[1])} aria-label={tr('lx.work.pickLeft')}><Thumb id={pair[0].id} lqip={pair[0].lqip} edits={pair[0].edits} /></button>
        <button onClick={() => choose(pair[1], pair[0])} aria-label={tr('lx.work.pickRight')}><Thumb id={pair[1].id} lqip={pair[1].lqip} edits={pair[1].edits} /></button>
      </div>
    </div>
  );
}

/** 12 alegeri ale AI-ului: jumătate păstrate (cele mai sigure), jumătate scoase, alternate. */
export function pickGuessIds(photos: readonly PhotoView[]): string[] {
  const real = photos.filter(p => !p.aside);
  const keep = real.filter(p => p.status === 'selected').sort((a, b) => b.aiScore - a.aiScore).slice(0, 6);
  const drop = real.filter(p => p.status === 'rejected').sort((a, b) => a.aiScore - b.aiScore).slice(0, 6);
  const out: string[] = [];
  for (let i = 0; i < 6; i++) { if (keep[i]) out.push(keep[i].id); if (drop[i]) out.push(drop[i].id); }
  return out;
}
const GUESS_KEY = 'cp.guess.done';
function guessDone(): boolean { try { return localStorage.getItem(GUESS_KEY) === '1'; } catch { return true; } }
function markGuessDone(): void { try { localStorage.setItem(GUESS_KEY, '1'); } catch { /* fără stocare */ } }

/**
 * „Te-am ghicit?” rămâne pe Azi până omul face verificarea sau o închide (raportat: apărea doar
 * o dată, la finalul primei citiri; închisă acolo, nu se mai găsea). Alegerile AI-ului din
 * ultimele poze decise de el.
 */
export function GuessCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [hidden, setHidden] = useState(guessDone);
  const ids = useMemo(() => {
    if (hidden) return [];
    const mine = photos.filter(p => p.aiDecided && !p.aside).sort((a, b) => b.importedAt - a.importedAt).slice(0, 300);
    return pickGuessIds(mine);
  }, [photos, hidden]);
  if (hidden || ids.length < 6) return null;
  const close = () => { markGuessDone(); setHidden(true); };
  return (
    <section className="lx-card lx-guess" role="status">
      <button className="lx-auto-close" onClick={close} aria-label={tr('lx.close')}>✕</button>
      <span className="lx-eyebrow">{tr('lx.guess.eyebrow')}</span>
      <b>{tr('lx.work.guessTitle')}</b>
      <span>{tr('lx.guess.sub', { count: ids.length })}</span>
      <button className="lx-btn primary wide" onClick={() => { close(); useLx.getState().openSort(ids, tr('lx.work.guessTitle'), true); }}>
        {tr('lx.guess.go')}
      </button>
    </section>
  );
}
