import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoView } from '../state/store';
import { makeLayoutCollage, shareCollage, type CollageLayout } from './collage';
import { useTr } from './context';
import { learnFromShare } from './signals';

/**
 * lumin/CollageSheet.tsx
 * „Colaj”: din pozele unei zile sau ale unui album, cele mai bune, în trei
 * modele (grilă de 4, grilă de 6, polaroid). Atingi modelul și îl trimiți.
 */
const MODELS: { id: string; layout: CollageLayout; count: number }[] = [
  { id: 'grid4', layout: 'grid', count: 4 },
  { id: 'grid6', layout: 'grid', count: 6 },
  { id: 'grid3', layout: 'grid', count: 3 },
  { id: 'polaroid', layout: 'polaroid', count: 4 }
];

export function CollageSheet({ photos, title, subtitle, onClose }: { photos: PhotoView[]; title: string; subtitle: string; onClose: () => void }) {
  const tr = useTr();
  const best = [...photos].sort((a, b) => (b.status === 'selected' ? 1 : 0) - (a.status === 'selected' ? 1 : 0) || b.aiScore - a.aiScore);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Doar modelele care se umplu (auditul: „6 poze” cu 5 păstrate lăsa o celulă goală).
  const models = MODELS.filter(m => best.length >= m.count);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      for (const m of models) {
        const blob = await makeLayoutCollage(best.slice(0, m.count).map(p => p.id), m.layout, title, subtitle);
        if (!alive || !blob) continue;
        const u = URL.createObjectURL(blob);
        urls.push(u);
        setPreviews(p => ({ ...p, [m.id]: u }));
      }
    })();
    return () => { alive = false; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (m: (typeof MODELS)[number]) => {
    setBusy(true);
    try {
      const picked = best.slice(0, m.count);
      const blob = await makeLayoutCollage(picked.map(p => p.id), m.layout, title, subtitle);
      if (!blob) return;
      await shareCollage(blob, `cherrypic-colaj-${Date.now()}.jpg`, title);
      void learnFromShare(picked);
      onClose();
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>🧩 {tr('lx.collage.title')}</h2>
        <div className="lx-collage-models">
          {models.map(m => (
            <button key={m.id} className="lx-collage-model" disabled={busy || !previews[m.id]} onClick={() => void send(m)}>
              {previews[m.id] ? <img src={previews[m.id]} alt="" /> : <span className="lx-spinner" />}
              <small>{tr(`lx.collage.${m.id}`)}</small>
            </button>
          ))}
        </div>
        <p className="lx-hint">{tr('lx.collage.hint')}</p>
        <button className="lx-btn ghost wide" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
      </div>
    </div>,
    document.body
  );
}

/** Butonul „🧩 Colaj”, cu foaia lui. Ascuns sub 3 poze. */
export function CollageButton({ photos, title, subtitle, className = 'lx-link' }: { photos: PhotoView[]; title: string; subtitle: string; className?: string }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  if (photos.length < 3) return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>🧩 {tr('lx.collage.button')}</button>
      {open && <CollageSheet photos={photos} title={title} subtitle={subtitle} onClose={() => setOpen(false)} />}
    </>
  );
}
