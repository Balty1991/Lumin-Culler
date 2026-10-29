import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { setTrashGuard } from '../state/lastTrash';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { formatBytes } from '../core/freedSpace';

/**
 * lumin/TrashPreview.tsx
 * „Uite ce mut în coș”: înainte ca mai mult de 10 poze să plece deodată, 12
 * exemple (cele mai bune dintre ele întâi — dacă vreuna nu trebuia, se vede
 * imediat), cu totalul și spațiul eliberat. „Da” le mută, „Nu” nu atinge nimic.
 */
const MIN_PREVIEW = 10;

export function TrashPreviewHost() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [req, setReq] = useState<{ ids: string[]; resolve: (ok: boolean) => void } | null>(null);
  useEffect(() => {
    setTrashGuard(ids => (ids.length <= MIN_PREVIEW ? Promise.resolve(true) : new Promise(resolve => setReq({ ids, resolve }))));
    return () => setTrashGuard(null);
  }, []);
  if (!req) return null;
  const byId = new Map(useStore.getState().photos.map(p => [p.id, p]));
  const list = req.ids.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const sample = [...list].sort((a, b) => b.aiScore - a.aiScore).slice(0, 12);
  const bytes = list.reduce((n, p) => n + (p.sizeBytes ?? 0), 0);
  const answer = (ok: boolean) => { req.resolve(ok); setReq(null); };
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={() => answer(false)}>
      <div className="lx-sheet lx-video-sheet" onClick={e => e.stopPropagation()}>
        <h2>🗑 {tr('lx.trashCheck.title', { count: list.length })}</h2>
        <p className="lx-hint">{tr('lx.trashCheck.sub', { size: formatBytes(bytes, locale) })}</p>
        <div className="lx-video-grid">
          {sample.map(p => (
            <div key={p.id} className="lx-video-cell"><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></div>
          ))}
        </div>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={() => answer(false)}>{tr('lx.trashCheck.no')}</button>
          <button className="lx-btn danger" onClick={() => answer(true)}>{tr('lx.trashCheck.yes', { count: list.length })}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
