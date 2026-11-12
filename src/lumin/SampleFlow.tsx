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
    const best = [...kept].sort((a, b) => Number((b.faceCount ?? 0) > 0) - Number((a.faceCount ?? 0) > 0) || b.aiScore - a.aiScore);
    return {
      total: mine.length,
      kept: kept.length,
      series: seriesExtras(real).extras.length,
      blurry: selectBlurry(real).length,
      blinks: selectBlinks(real).length,
      aside: mine.length - real.length,
      best: best.slice(0, 6)
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
        <div className="lx-sample-best">
          {sum.best.map((p, i) => (
            <button key={p.id} onClick={() => useLx.getState().openViewer(sum.best.map(x => x.id), i)}>
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
  const started = useRef<{ at: number; done: number } | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!open) { started.current = null; setFinished(false); return; }
    // Cât e deschis, nimeni nu atinge aplicația: analiza merge plin.
    analysisPool.setGentle(false);
    analysisPool.setBackground(false);
    return () => {
      if (useLx.getState().reader) { analysisPool.setGentle(true); analysisPool.setBackground(true); }
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (reader && !started.current) started.current = { at: Date.now(), done: reader.done };
    if (!reader && started.current) setFinished(true);
  }, [open, reader]);
  // Ultimele poze citite, ca „orbită” în jurul inelului.
  const orbit = useMemo(() => photos.slice(-8).reverse(), [photos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const done = reader?.done ?? 0;
  const total = reader?.total ?? 0;
  const pct = finished ? 100 : total ? Math.round((done / total) * 100) : 0;
  let eta = '';
  if (reader && started.current && done - started.current.done >= 4) {
    const rate = (done - started.current.done) / ((Date.now() - started.current.at) / 60000);
    const min = Math.max(1, Math.round((total - done) / Math.max(rate, 1)));
    eta = min >= 90 ? tr('lx.work.etaH', { hours: Math.round(min / 60) }) : tr('lx.work.etaMin', { minutes: min });
  }
  return createPortal(
    <div className="lx lx-work" role="dialog" aria-modal="true" aria-label={tr('lx.work.title')}>
      <div className="lx-work-aurora" aria-hidden="true" />
      <div className="lx-work-core">
        <div className="lx-work-ring" style={{ ['--p' as string]: `${pct}` }}>
          <div className="lx-work-orbit" aria-hidden="true">
            {orbit.map((p, i) => (
              <span key={p.id} style={{ ['--i' as string]: `${i}` }}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></span>
            ))}
          </div>
          <b>{pct}%</b>
        </div>
        <h2>{finished ? tr('lx.work.done') : tr('lx.work.title')}</h2>
        <p>{finished ? tr('lx.work.doneSub') : total ? tr('lx.work.count', { done, total }) : tr('lx.work.starting')}</p>
        {!finished && eta && <p className="lx-work-eta">{eta}</p>}
        {!finished && <p className="lx-work-tip">{tr('lx.work.tip')}</p>}
        <button className={finished ? 'lx-btn primary wide' : 'lx-btn ghost wide'} onClick={() => setWorkMode(false)}>
          {finished ? tr('lx.work.see') : tr('lx.work.useApp')}
        </button>
      </div>
    </div>,
    document.body
  );
}
