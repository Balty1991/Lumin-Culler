import { useEffect, useState } from 'react';
import { appCaption } from './shareCards';
import { createPortal } from 'react-dom';
import type { PhotoView } from '../state/store';
import { makeLayoutCollage, shareCollage, type CollageLayout } from './collage';
import { useTr } from './context';
import { learnFromShare } from './signals';
import { useHoldAnalysis } from './useHoldAnalysis';
import { saveEditedBlob } from './saveEdited';
import { useStore } from '../state/store';

/**
 * lumin/CollageSheet.tsx
 * „Colaj”: din pozele unei zile sau ale unui album, cele mai bune, în trei
 * modele (grilă de 4, grilă de 6, polaroid). Atingi modelul, îl vezi mare, apoi îl
 * salvezi sau îl trimiți (raportat: „să le pot și vizualiza, nu direct să apară trimitere”).
 */
const MODELS: { id: string; layout: CollageLayout; count: number }[] = [
  { id: 'grid4', layout: 'grid', count: 4 },
  { id: 'grid6', layout: 'grid', count: 6 },
  { id: 'grid3', layout: 'grid', count: 3 },
  { id: 'polaroid', layout: 'polaroid', count: 4 }
];

export function CollageSheet({ photos, title, subtitle, onClose }: { photos: PhotoView[]; title: string; subtitle: string; onClose: () => void }) {
  useHoldAnalysis();
  const tr = useTr();
  const best = [...photos].sort((a, b) => (b.status === 'selected' ? 1 : 0) - (a.status === 'selected' ? 1 : 0) || b.aiScore - a.aiScore);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<(typeof MODELS)[number] | null>(null);
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

  const make = (m: (typeof MODELS)[number]) => makeLayoutCollage(best.slice(0, m.count).map(p => p.id), m.layout, title, subtitle);
  const send = async (m: (typeof MODELS)[number]) => {
    setBusy(true);
    try {
      const blob = await make(m);
      if (!blob) return;
      await shareCollage(blob, `cherrypic-colaj-${Date.now()}.jpg`, appCaption(title, tr('lx.share.cta')));
      void learnFromShare(best.slice(0, m.count));
    } finally { setBusy(false); }
  };
  const save = async (m: (typeof MODELS)[number]) => {
    setBusy(true);
    try {
      const blob = await make(m);
      const ok = blob ? await saveEditedBlob(blob, 'colaj') : false;
      useStore.getState().setNotice(tr(ok ? 'lx.collage.saved' : 'lx.collage.saveFailed'));
      if (ok) void learnFromShare(best.slice(0, m.count));
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>🧩 {tr('lx.collage.title')}</h2>
        {shown && previews[shown.id] ? (
          <>
            <img className="lx-collage-big" src={previews[shown.id]} alt="" />
            <div className="lx-collage-actions">
              <button className="lx-btn ghost" disabled={busy} onClick={() => setShown(null)}>{tr('lx.collage.back')}</button>
              <button className="lx-btn ghost" disabled={busy} onClick={() => void save(shown)}>{tr('lx.collage.save')}</button>
              <button className="lx-btn primary" disabled={busy} onClick={() => void send(shown)}>{tr('lx.collage.send')}</button>
            </div>
          </>
        ) : (<>
        <div className="lx-collage-models">
          {models.map(m => (
            <button key={m.id} className="lx-collage-model" disabled={busy || !previews[m.id]} onClick={() => setShown(m)}>
              {previews[m.id] ? <img src={previews[m.id]} alt="" /> : <span className="lx-spinner" />}
              <small>{tr(`lx.collage.${m.id}`)}</small>
            </button>
          ))}
        </div>
        <p className="lx-hint">{tr('lx.collage.hint')}</p>
        <button className="lx-btn ghost wide" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
        </>)}
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
