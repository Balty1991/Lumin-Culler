import { useEffect, useState } from 'react';
import { analysisPool } from '../core/workerPool';

/**
 * lumin/readerYield.ts
 * Citirea galeriei face pauză cât omul folosește aplicația (ca derularea să rămână fluidă).
 * Cerut: „să apară undeva, să știe utilizatorii asta”. Verificat o dată pe secundă, doar cât
 * cititorul rulează.
 */
export function useReaderYielding(active: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) { setOn(false); return; }
    const tick = () => setOn(analysisPool.isYielding());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return on;
}
