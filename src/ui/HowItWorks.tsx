import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * ui/HowItWorks.tsx
 * „Vezi cum merge” (20 de secunde), la prima pornire, pentru cine încă n-are
 * poze multe sau vrea să știe la ce să se aștepte: trei scene desenate, fără
 * nicio poză reală — 20 de poze ale zilei → AI-ul scoate neclarele și dublurile
 * → rămân cele 4 bune, pe Azi, iar nimic nu se șterge fără om.
 */
const TILES = 20;
// Ce face AI-ul cu fiecare dală: b = neclară, d = dublură, k = păstrată.
const FATE = 'kbdkddbkdbddbdkbddbd';
const HUES = [12, 340, 200, 40, 160, 280, 20, 190, 330, 60, 220, 300, 100, 0, 250, 30, 180, 320, 80, 140];

export function HowItWorks({ tr, onClose }: { tr: (k: string, p?: Record<string, string | number>) => string; onClose: () => void }) {
  const [scene, setScene] = useState(0);
  useEffect(() => {
    if (scene >= 3) return;
    const t = window.setTimeout(() => setScene(s => s + 1), 4200);
    return () => window.clearTimeout(t);
  }, [scene]);
  const kept = [...FATE].map((f, i) => (f === 'k' ? i : -1)).filter(i => i >= 0);
  return createPortal(
    <div className="hiw" role="dialog" aria-modal="true" aria-label={tr('fr.demo.title')}>
      <button className="hiw-close" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
      <div className="hiw-dots" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} className={i <= scene ? 'on' : ''} />)}</div>
      <div className={`hiw-grid s${Math.min(scene, 3)}`} aria-hidden="true">
        {Array.from({ length: TILES }, (_, i) => (
          <span key={i} className={`hiw-tile ${FATE[i]}`} style={{ ['--h' as string]: HUES[i], ['--i' as string]: i }}>
            <i />{scene >= 1 && FATE[i] === 'b' && <b>≈</b>}{scene >= 1 && FATE[i] === 'd' && <b>⧉</b>}{scene >= 2 && FATE[i] === 'k' && <b className="ok">✓</b>}
          </span>
        ))}
      </div>
      <p className="hiw-text" aria-live="polite">{tr(`fr.demo.s${Math.min(scene, 3)}`, { kept: kept.length, total: TILES })}</p>
      {scene >= 3 && <button className="v3-cta fr-cta" onClick={onClose}><span>{tr('fr.demo.go')}</span><span className="v3-mono">→</span></button>}
    </div>,
    document.body
  );
}
