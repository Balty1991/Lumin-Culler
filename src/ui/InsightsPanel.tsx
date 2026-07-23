import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { contextEngine } from '../core/learning/ContextEngine';
import { useModalFocusTrap } from './useModalFocusTrap';
import { InsightsChart, type InsightsChartWeight } from './InsightsChart';
import { SparkleIcon, TrashIcon } from './icons';

interface Summary {
  contextKey: string;
  sampleCount: number;
  confidence: 'cold' | 'warming' | 'trained';
  notes: string[];
  topWeights: InsightsChartWeight[];
  allWeights: InsightsChartWeight[];
}

const SCENE_LABELS: Record<string, string> = { landscape: 'Peisaj', detail: 'Detaliu / obiect' };
const SUBJECT_LABELS: Record<string, string> = { known: 'persoane cunoscute', strangers: 'straini', mixed: 'subiecti mixti' };

function contextLabel(key: string): string {
  const [scene, subject] = key.split(':');
  const sceneLabel = SCENE_LABELS[scene] ?? (scene === 'portrait' ? 'Portret' : scene === 'group' ? 'Grup' : scene);
  return subject ? `${sceneLabel} · ${SUBJECT_LABELS[subject] ?? subject}` : sceneLabel;
}

const CONFIDENCE_LABEL: Record<Summary['confidence'], string> = {
  cold: 'nou', warming: 'se incalzeste', trained: 'antrenat'
};

/** Panou de explicabilitate: ce a invatat ContextEngine, per tip de scena, din corectiile manuale. */
export function InsightsPanel() {
  const open = useStore(s => s.insightsOpen);
  const setOpen = useStore(s => s.setInsightsOpen);
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const reload = () => { void contextEngine.summarize().then(s => setSummary(s)); };

  useEffect(() => {
    if (!open) { setSummary(null); setExpanded(new Set()); return; }
    let alive = true;
    void contextEngine.summarize().then(s => { if (alive) setSummary(s); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const toggleExpanded = (contextKey: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(contextKey)) next.delete(contextKey); else next.add(contextKey);
      return next;
    });
  };

  const confirmReset = (contextKey: string) => {
    if (window.confirm(`Uiti tot ce a invatat AI-ul pentru „${contextLabel(contextKey)}"? Scorurile viitoare pentru acest tip de scena revin la regulile generale de start. Nu poate fi anulat.`)) {
      void contextEngine.reset(contextKey).then(reload);
    }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label="Preferinte AI" tabIndex={-1}>
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" /> Preferinte AI</span>
          <button className="ghost" onClick={() => setOpen(false)}>Inchide</button>
        </header>

        {summary === null && <p className="hint">Se incarca…</p>}

        {summary && summary.length === 0 && (
          <p className="hint">Inca nu exista nimic invatat. Motorul incepe sa invete dupa
          primele ~8 decizii manuale (Selecteaza/Respinge) pentru fiecare tip de scena
          (portret, peisaj, grup...).</p>
        )}

        {summary && summary.length > 0 && (
          <ul className="insights">
            {summary.map(s => (
              <li key={s.contextKey} className={`insight confidence-${s.confidence}`}>
                <div className="insight-head">
                  <b>{contextLabel(s.contextKey)}</b>
                  <span className="mono confidence-tag">{s.sampleCount} decizii · {CONFIDENCE_LABEL[s.confidence]}</span>
                </div>
                {s.notes.length > 0
                  ? (
                    <>
                      <p>{s.notes.join(' · ')}</p>
                      <InsightsChart weights={s.topWeights} />
                    </>
                  )
                  : <p className="hint">Inca invata — mai sunt necesare cateva decizii pe acest tip de scena.</p>}

                {expanded.has(s.contextKey) && (
                  <div className="insight-all-weights">
                    <p className="factor-row-label mono">Toate cele {s.allWeights.length} caracteristici invatate</p>
                    <InsightsChart weights={s.allWeights} />
                  </div>
                )}

                <div className="insight-actions">
                  <button className="ghost small" onClick={() => toggleExpanded(s.contextKey)}>
                    {expanded.has(s.contextKey) ? 'Ascunde toate ponderile' : `Arata toate ponderile (${s.allWeights.length})`}
                  </button>
                  <button className="ghost small danger" onClick={() => confirmReset(s.contextKey)}>
                    <TrashIcon className="inline-icon" /> Reseteaza
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
