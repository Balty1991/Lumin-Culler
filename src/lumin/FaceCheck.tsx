/**
 * lumin/FaceCheck.tsx
 * „E Ami?” — verificare rapidă a fețelor numite de aplicație, cele mai nesigure întâi.
 * Da = fața devine reper (recunoașterea învață); Nu = iese din album și nu mai e pusă
 * la omul ăsta. Raportat de mai multe ori: „încă încurcă persoanele”.
 */
import { useEffect, useState } from 'react';
import { getCachedThumbUrl } from '../core/thumbUrlCache';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLx } from './lxStore';
import { confirmFace, unsureFaces, type UnsureFace } from './faceIdentity';
import { vibrate } from '../ui/haptics';

/** Fața decupată din miniatură, cu puțin context în jur. */
function FaceCrop({ face }: { face: UnsureFace }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    void (async () => {
      const src = await getCachedThumbUrl(face.photoId).catch(() => null);
      if (!src || !alive) return;
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        const [x, y, w, h] = face.box;
        const side = Math.max(w * img.naturalWidth, h * img.naturalHeight) * 1.8;
        const cx = (x + w / 2) * img.naturalWidth, cy = (y + h / 2) * img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = 220; c.height = 220;
        c.getContext('2d')?.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, 220, 220);
        setUrl(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = src;
    })();
    return () => { alive = false; };
  }, [face]);
  return url ? <img className="lx-facecheck-img" src={url} alt="" /> : <span className="lx-facecheck-img" aria-hidden="true" />;
}

export function FaceCheckButton({ name }: { name: string }) {
  const tr = useTr();
  const [faces, setFaces] = useState<UnsureFace[] | null>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const faceVersion = useLx(s => s.faceVersion);
  useEffect(() => {
    let alive = true;
    void unsureFaces(name).then(f => { if (alive) setFaces(f); }).catch(() => {});
    return () => { alive = false; };
  }, [name, faceVersion]);
  if (!faces?.length && !open) return null;
  const face = faces?.[at];
  const next = () => {
    if (!faces || at + 1 >= faces.length) { setOpen(false); setAt(0); useLx.getState().bumpFaces(); return; }
    setAt(at + 1);
  };
  const answer = async (yes: boolean) => {
    if (!face || busy) return;
    setBusy(true);
    vibrate(8);
    try {
      if (yes) await confirmFace(face.photoId, face.faceIndex);
      else await useStore.getState().correctPersonFaces(name, [face.photoId]);
    } finally { setBusy(false); }
    next();
  };
  if (!open) {
    return (
      <button className="lx-btn ghost wide" onClick={() => { setAt(0); setOpen(true); }}>
        🙂 {tr('lx.faceCheck.open', { name, count: faces!.length })}
      </button>
    );
  }
  return (
    <section className="lx-facecheck" aria-live="polite">
      {face ? (
        <>
          <FaceCrop face={face} />
          <p className="lx-facecheck-q">{tr('lx.faceCheck.question', { name })}</p>
          <small className="lx-hint">{at + 1} / {faces!.length}</small>
          <div className="lx-decide-actions">
            <button className="lx-btn ghost" disabled={busy} onClick={() => void answer(false)}>✕ {tr('lx.faceCheck.no')}</button>
            <button className="lx-btn primary" disabled={busy} onClick={() => void answer(true)}>✓ {tr('lx.faceCheck.yes')}</button>
          </div>
          <button className="lx-link" onClick={() => { setOpen(false); setAt(0); useLx.getState().bumpFaces(); }}>{tr('lx.faceCheck.later')}</button>
        </>
      ) : null}
    </section>
  );
}
