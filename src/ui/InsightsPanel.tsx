import { useEffect, useRef, useState } from 'react';
import { db } from '../core/db';
import { summarizeAccuracy, type AccuracySummary } from '../core/learning/accuracy';
import { computeCalibration, worstBin, type CalibrationSummary } from '../core/learning/calibration';
import { findHabits, type Habit } from '../core/learning/habits';
import { translateSceneTag } from '../core/sceneTagLabels';
import { useStore } from '../state/store';
import { contextEngine } from '../core/learning/ContextEngine';
import { useModalFocusTrap } from './useModalFocusTrap';
import { InsightsChart, type InsightsChartWeight } from './InsightsChart';
import { SparkleIcon, TrashIcon, XIcon } from './icons';
import { t } from '../i18n';

interface Summary {
  contextKey: string;
  sampleCount: number;
  confidence: 'cold' | 'warming' | 'trained';
  notes: string[];
  topWeights: InsightsChartWeight[];
  allWeights: InsightsChartWeight[];
}

const SCENE_TYPES = new Set(['portrait', 'group', 'landscape', 'detail']);
const SCENE_KEYS: Record<string, string> = {
  portrait: 'insights.scene.portrait', group: 'insights.scene.group',
  landscape: 'insights.scene.landscape', detail: 'insights.scene.detail'
};
const SUBJECT_KEYS: Record<string, string> = {
  known: 'insights.subject.known', strangers: 'insights.subject.strangers', mixed: 'insights.subject.mixed'
};

/**
 * contextKey e "[gen:]sceneType[:subiect]" — genul (ContextEngine 2.0, ales liber
 * de utilizator) e un prefix OPTIONAL, deci nu putem presupune un numar fix de
 * segmente. Primul segment care NU e unul din cele 4 sceneType cunoscute e
 * tratat ca gen; altfel (fara gen) primul segment chiar e sceneType-ul.
 */
function contextLabel(key: string, tr: (key: string, params?: Record<string, string | number>) => string): string {
  const parts = key.split(':');
  const genre = parts.length > 0 && !SCENE_TYPES.has(parts[0]) ? parts.shift() : undefined;
  const [scene, subject] = parts;
  const sceneLabel = SCENE_KEYS[scene] ? tr(SCENE_KEYS[scene]) : scene;
  const base = subject ? `${sceneLabel} · ${SUBJECT_KEYS[subject] ? tr(SUBJECT_KEYS[subject]) : subject}` : sceneLabel;
  return genre ? `${genre} — ${base}` : base;
}

/** Panou de explicabilitate: ce a invatat ContextEngine, per tip de scena, din corectiile manuale. */
export function InsightsPanel() {
  const open = useStore(s => s.insightsOpen);
  const setOpen = useStore(s => s.setInsightsOpen);
  const askConfirm = useStore(s => s.askConfirm);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null);
  const [calibrare, setCalibrare] = useState<CalibrationSummary | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  // Escape-to-close — vezi acelasi tipar in EditPanel.tsx/MenuDrawer.tsx (bug
  // real gasit de auditul QA: acest panou nu avea niciunul).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const reload = () => { void contextEngine.summarize(locale).then(s => setSummary(s)); };

  useEffect(() => {
    if (!open) { setSummary(null); setExpanded(new Set()); setAccuracy(null); setHabits([]); return; }
    let alive = true;
    void contextEngine.summarize(locale).then(s => { if (alive) setSummary(s); });
    // Raspunsurile corecte exista deja: fiecare decizie manuala a salvat si ce
    // propunea AI-ul, si ce ai ales tu. Vezi core/learning/accuracy.ts.
    void db.corrections.toArray().then(async rows => {
      if (!alive) return;
      setAccuracy(summarizeAccuracy(rows));
      // Aceleasi corectii, alta intrebare: nu "cat de des nimereste", ci
      // "inseamna ceva cifra pe care o arata". Vezi learning/calibration.ts.
      setCalibrare(computeCalibration(rows));
      // Tiparele au nevoie si de metadatele pozei (ora capturii, subiecte,
      // focala), care nu stau pe corectie — le luam prin photoId. Pozele
      // sterse intre timp cad pur si simplu din analiza.
      //
      // bulkGet DOAR pe pozele cu o decizie manuala, nu toata biblioteca: o
      // inregistrare de analiza contine embedding-ul de continut (1024 de
      // numere) si cate unul per fata, deci `db.analyses.toArray()` pe o
      // biblioteca de cateva mii de poze ar trage zeci de MB in memorie ca sa
      // citeasca din ele trei campuri mici. Numarul de decizii manuale e cu
      // ordine de marime mai mic si — spre deosebire de biblioteca — nu creste
      // cu fiecare import, ci doar cu cat lucrezi efectiv.
      const ids = [...new Set(rows.map(c => c.photoId))];
      const [photos, analyses] = await Promise.all([db.photos.bulkGet(ids), db.analyses.bulkGet(ids)]);
      if (!alive) return;
      // bulkGet intoarce undefined pe pozitiile fara inregistrare (sterse intre timp)
      const photoById = new Map(photos.flatMap(p => (p ? [[p.id, p] as const] : [])));
      const analysisById = new Map(analyses.flatMap(a => (a ? [[a.photoId, a] as const] : [])));
      setHabits(findHabits(rows.flatMap(c => {
        const photo = photoById.get(c.photoId);
        if (!photo) return [];
        const analysis = analysisById.get(c.photoId);
        return [{
          kept: c.userDecision,
          capturedAt: photo.capturedAt,
          sceneTags: analysis?.sceneTags,
          focalLength35mm: analysis?.focalLength35mm
        }];
      })));
    });
    return () => { alive = false; };
  }, [open, locale]);

  if (!open) return null;

  const toggleExpanded = (contextKey: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(contextKey)) next.delete(contextKey); else next.add(contextKey);
      return next;
    });
  };

  const confirmReset = async (contextKey: string) => {
    if (await askConfirm(tr('insights.confirmReset', { context: contextLabel(contextKey, tr) }), { danger: true })) {
      void contextEngine.reset(contextKey).then(reload);
    }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.aiPreferences')} tabIndex={-1}>
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" /> {tr('menu.aiPreferences')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {/* Cifra pe care o aplicatie care decide in locul tau ti-o datoreaza, si
            pe care aproape nicio aplicatie AI nu o da: cat de des a avut
            dreptate, masurat pe pozele pe care le-ai judecat chiar tu. Poate
            arata si prost — un indicator care nu poate arata rau e o reclama,
            nu un indicator. */}
        {accuracy && (
          <section className="accuracy">
            <h3>{tr('insights.accuracy.title')}</h3>
            <div className="accuracy-rows">
              {accuracy.keepPrecision !== null && (
                <p>{tr('insights.accuracy.keep', { percent: Math.round(accuracy.keepPrecision * 100) })}</p>
              )}
              {accuracy.rejectPrecision !== null && (
                <p>{tr('insights.accuracy.reject', { percent: Math.round(accuracy.rejectPrecision * 100) })}</p>
              )}
            </div>
            {accuracy.trend && (
              <p className="accuracy-trend">
                {tr(
                  accuracy.trend.recent > accuracy.trend.earlier ? 'insights.accuracy.trend.up'
                  : accuracy.trend.recent < accuracy.trend.earlier ? 'insights.accuracy.trend.down'
                  : 'insights.accuracy.trend.flat',
                  { recent: Math.round(accuracy.trend.recent * 100), earlier: Math.round(accuracy.trend.earlier * 100) }
                )}
              </p>
            )}
            <p className="accuracy-basis hint">{tr('insights.accuracy.basis', { count: accuracy.total })}</p>
          </section>
        )}

        {/* CALIBRAREA — alta intrebare decat acordul de mai sus, si de-aia sta
            separat: acolo scrie cat de des nimereste motorul, aici daca
            increderea lui inseamna ceva. Conteaza fiindca pragurile care
            hotarasc ce se decide singur sunt exprimate in scor: un scor
            decalibrat taie in locul gresit. Vezi core/learning/calibration.ts. */}
        {calibrare && (
          <section className="accuracy calibration">
            <h3>{tr('insights.calibration.title')}</h3>
            <p>{tr(`insights.calibration.verdict.${calibrare.verdict}`)}</p>
            {(() => {
              const banda = worstBin(calibrare);
              if (!banda) return null;
              return (
                <p className="accuracy-trend">
                  {tr('insights.calibration.worst', {
                    from: banda.from,
                    to: banda.to,
                    predicted: Math.round(banda.predicted * 100),
                    observed: Math.round(banda.observed * 100)
                  })}
                </p>
              );
            })()}
            {/* Curba, ca sa se vada forma, nu doar cuvantul. Fiecare banda are
                doua bare: cat a prezis motorul si cat s-a intamplat. */}
            <div className="calibration-bins">
              {calibrare.bins.map(b => (
                <div key={b.from} className="calibration-bin" title={tr('insights.calibration.binTitle', {
                  from: b.from, to: b.to, count: b.count,
                  predicted: Math.round(b.predicted * 100), observed: Math.round(b.observed * 100)
                })}>
                  <span className="calibration-bars" aria-hidden="true">
                    <i className="calibration-pred" style={{ height: `${Math.max(2, b.predicted * 100)}%` }} />
                    <i className="calibration-obs" style={{ height: `${Math.max(2, b.observed * 100)}%` }} />
                  </span>
                  <span className="calibration-label mono">{b.from}</span>
                </div>
              ))}
            </div>
            <p className="calibration-legend hint">
              <i className="calibration-pred" aria-hidden="true" /> {tr('insights.calibration.predicted')}
              <i className="calibration-obs" aria-hidden="true" /> {tr('insights.calibration.observed')}
            </p>
            <p className="accuracy-basis hint">{tr('insights.calibration.basis', { count: calibrare.total })}</p>
          </section>
        )}

        {/* Aceleasi corectii, dar intoarse spre TINE, nu spre motor: ce tipare
            exista in ce arunci, pe care nu le stiai. Vezi core/learning/habits.ts
            pentru pragurile care despart o observatie de un horoscop. */}
        {habits.length > 0 && (
          <section className="habits">
            <h3>{tr('insights.habits.title')}</h3>
            <ul>
              {habits.map(h => (
                <li key={h.kind + h.key}>
                  {tr(`insights.habits.${h.kind}.${h.keepRate >= h.baseline ? 'more' : 'less'}`, {
                    group: h.kind === 'subject' ? translateSceneTag(h.key, locale) : tr(`insights.habits.band.${h.key}`),
                    percent: Math.round(h.keepRate * 100),
                    baseline: Math.round(h.baseline * 100)
                  })}
                  <span className="habits-basis mono">{tr('insights.habits.basis', { count: h.count })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary === null && <p className="hint"><SparkleIcon className="inline-icon spin" /> {tr('insights.loading')}</p>}

        {summary && summary.length === 0 && (
          <p className="hint">{tr('insights.empty')}</p>
        )}

        {summary && summary.length > 0 && (
          <ul className="insights">
            {summary.map(s => (
              <li key={s.contextKey} className={`insight confidence-${s.confidence}`}>
                <div className="insight-head">
                  <b>{contextLabel(s.contextKey, tr)}</b>
                  <span className="mono confidence-tag">{tr('insights.sampleCount', { count: s.sampleCount, confidence: tr(`insights.confidence.${s.confidence}`) })}</span>
                </div>
                {s.notes.length > 0
                  ? (
                    <>
                      <p>{s.notes.join(' · ')}</p>
                      <InsightsChart weights={s.topWeights} />
                    </>
                  )
                  : <p className="hint">{tr('insights.stillLearning')}</p>}

                {expanded.has(s.contextKey) && (
                  <div className="insight-all-weights">
                    <p className="factor-row-label mono">{tr('insights.allWeightsLabel', { count: s.allWeights.length })}</p>
                    <InsightsChart weights={s.allWeights} />
                  </div>
                )}

                <div className="insight-actions">
                  <button className="ghost small" onClick={() => toggleExpanded(s.contextKey)}>
                    {expanded.has(s.contextKey) ? tr('insights.hideWeights') : tr('insights.showWeights', { count: s.allWeights.length })}
                  </button>
                  <button className="ghost small danger" onClick={() => confirmReset(s.contextKey)}>
                    <TrashIcon className="inline-icon" /> {tr('insights.reset')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
