import { useEffect, useLayoutEffect, useState } from 'react';
import { useLx, type LxTab } from './lxStore';
import { useTr } from './context';
import { Orb } from './Orb';
import { markTourDone } from './tour';

/**
 * lumin/AppTour.tsx
 * Turul de la prima intrare: câțiva pași peste ecranele adevărate, fiecare cu
 * butonul din bara de jos luminat și o frază despre ce face. Cerut de om:
 * „un mic tutorial al aplicației să știe utilizatorul ce face și cum se
 * utilizează”. Se poate sări oricând; se redeschide din Setări.
 */
interface Step {
  key: string;
  /** Al câtelea buton din bara de jos se luminează (0 Azi, 1 Galerie, 2 +, 3 AI, 4 Setări). */
  dock?: number;
  /** Ecranul arătat dedesubt cât ține pasul. */
  tab?: LxTab;
  swipe?: boolean;
}

const STEPS: Step[] = [
  { key: 'welcome' },
  { key: 'today', dock: 0, tab: 'today' },
  { key: 'swipe', tab: 'today', swipe: true },
  { key: 'gallery', dock: 1, tab: 'days' },
  { key: 'add', dock: 2 },
  { key: 'brain', dock: 3, tab: 'brain' },
  { key: 'settings', dock: 4, tab: 'settings' }
];

export function AppTour({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const setTab = useLx(s => s.setTab);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => { if (step.tab) setTab(step.tab); }, [step.tab, setTab]);

  useLayoutEffect(() => {
    if (step.dock === undefined) { setRect(null); return; }
    const measure = () => {
      const el = document.querySelectorAll<HTMLElement>('.lx-dock > button')[step.dock!];
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step.dock]);

  const close = () => { markTourDone(); setTab('today'); onClose(); };
  const next = () => (last ? close() : setI(i + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pad = 6;
  return (
    <div className="lx-tour" role="dialog" aria-modal="true" aria-labelledby="lx-tour-title">
      {rect ? (
        <div className="lx-tour-hole" style={{
          left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2
        }} />
      ) : <div className="lx-tour-dim" />}
      <div className={`lx-tour-card${rect ? ' up' : ''}`} key={step.key}
        style={rect ? { bottom: window.innerHeight - rect.top + 18 } : undefined}>
        {step.key === 'welcome' && <Orb mood="learn" size={64} />}
        {step.swipe && (
          <div className="lx-tour-swipe" aria-hidden="true">
            <span className="no">{tr('lx.tour.no')}</span>
            <div className="lx-tour-photo" />
            <span className="yes">{tr('lx.tour.yes')}</span>
          </div>
        )}
        <h2 id="lx-tour-title">{tr(`lx.tour.${step.key}.title`)}</h2>
        <p>{tr(`lx.tour.${step.key}.body`)}</p>
        <div className="lx-tour-dots" aria-label={tr('lx.tour.step', { n: i + 1, total: STEPS.length })}>
          {STEPS.map((s, k) => <i key={s.key} className={k === i ? 'on' : ''} />)}
        </div>
        <div className="lx-tour-actions">
          {!last && <button className="lx-btn ghost small" onClick={close}>{tr('lx.tour.skip')}</button>}
          {i > 0 && <button className="lx-btn ghost small" onClick={() => setI(i - 1)}>{tr('lx.tour.back')}</button>}
          <button className="lx-btn primary small" onClick={next} autoFocus>{last ? tr('lx.tour.done') : tr('lx.tour.next')}</button>
        </div>
      </div>
    </div>
  );
}
