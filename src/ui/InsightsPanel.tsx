import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { contextEngine } from '../core/learning/ContextEngine';
import { SparkleIcon } from './icons';

interface Summary {
  contextKey: string;
  sampleCount: number;
  confidence: 'cold' | 'warming' | 'trained';
  notes: string[];
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

  useEffect(() => {
    if (!open) { setSummary(null); return; }
    let alive = true;
    void contextEngine.summarize().then(s => { if (alive) setSummary(s); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow">
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
                  ? <p>{s.notes.join(' · ')}</p>
                  : <p className="hint">Inca invata — mai sunt necesare cateva decizii pe acest tip de scena.</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
