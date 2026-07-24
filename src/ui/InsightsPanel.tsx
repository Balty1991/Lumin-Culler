import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { contextEngine } from '../core/learning/ContextEngine';
import { useModalFocusTrap } from './useModalFocusTrap';
import { InsightsChart, type InsightsChartWeight } from './InsightsChart';
import { SparkleIcon, TrashIcon } from './icons';
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
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const reload = () => { void contextEngine.summarize(locale).then(s => setSummary(s)); };

  useEffect(() => {
    if (!open) { setSummary(null); setExpanded(new Set()); return; }
    let alive = true;
    void contextEngine.summarize(locale).then(s => { if (alive) setSummary(s); });
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

  const confirmReset = (contextKey: string) => {
    if (window.confirm(tr('insights.confirmReset', { context: contextLabel(contextKey, tr) }))) {
      void contextEngine.reset(contextKey).then(reload);
    }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.aiPreferences')} tabIndex={-1}>
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" /> {tr('menu.aiPreferences')}</span>
          <button className="ghost" onClick={() => setOpen(false)}>{tr('detail.close')}</button>
        </header>

        {summary === null && <p className="hint">{tr('insights.loading')}</p>}

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
