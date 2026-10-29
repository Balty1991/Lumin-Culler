import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import { getDisplayUrl } from '../core/previewUrlCache';
import type { PhotoView } from '../state/store';
import { shareCollage } from './collage';
import { useTr } from './context';
import { INSTA_FORMATS, INSTA_WIDTH, instaCrop, type InstaFormat } from './instaCrop';
import { canSharpen, sharpUrl } from './sharp';
import { learnFromShare } from './signals';

/**
 * lumin/InstaSheet.tsx
 * „Pentru Instagram”: poza decupată 4:5 (postare), 9:16 (story) sau 1:1, cu
 * fețele bine așezate în cadru (instaCrop.ts), gata de trimis. Fișierul din
 * galerie nu se atinge; decupajul e o copie trimisă direct.
 */
async function loadBitmap(photoId: string): Promise<ImageBitmap | null> {
  const url = (canSharpen() ? await sharpUrl(photoId, 2160).catch(() => null) : null) ?? (await getDisplayUrl(photoId).catch(() => null));
  if (!url) return null;
  try { return await createImageBitmap(await (await fetch(url)).blob()); } catch { return null; }
}

function render(img: ImageBitmap, format: InstaFormat, faces: Parameters<typeof instaCrop>[3], width: number): HTMLCanvasElement {
  const r = instaCrop(img.width, img.height, format, faces);
  const outW = Math.min(width, r.w);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = Math.round(outW * (r.h / r.w));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export function InstaSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [faces, setFaces] = useState<Parameters<typeof instaCrop>[3]>();
  const [previews, setPreviews] = useState<Partial<Record<InstaFormat, string>>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadBitmap(photo.id), db.analyses.get(photo.id)]).then(([bmp, a]) => {
      if (!alive) return;
      if (!bmp) { setFailed(true); return; }
      const f = a?.faces?.map(x => ({ box: x.box }));
      setImg(bmp);
      setFaces(f);
      const out: Partial<Record<InstaFormat, string>> = {};
      for (const format of INSTA_FORMATS) out[format] = render(bmp, format, f, 360).toDataURL('image/jpeg', 0.8);
      setPreviews(out);
    });
    return () => { alive = false; };
  }, [photo.id]);

  const send = async (format: InstaFormat) => {
    if (!img) return;
    setBusy(true);
    try {
      const blob = await new Promise<Blob | null>(r => render(img, format, faces, INSTA_WIDTH).toBlob(r, 'image/jpeg', 0.93));
      if (!blob) return;
      await shareCollage(blob, `cherrypic-${format.replace(':', 'x')}-${photo.id.slice(0, 6)}.jpg`, '');
      void learnFromShare([photo]);
      onClose();
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>{tr('lx.insta.title')}</h2>
        {!failed && !previews['4:5'] && <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.enhance.working')}</div>}
        {failed && <p className="lx-hint">{tr('lx.enhance.failed')}</p>}
        {previews['4:5'] && (
          <div className="lx-insta">
            {INSTA_FORMATS.map(format => (
              <button key={format} className="lx-insta-opt" disabled={busy} onClick={() => void send(format)}>
                <img src={previews[format]} alt="" />
                <b>{format}</b>
                <small>{tr(`lx.insta.${format === '4:5' ? 'post' : format === '9:16' ? 'story' : 'square'}`)}</small>
              </button>
            ))}
          </div>
        )}
        <p className="lx-hint">{tr('lx.insta.hint')}</p>
        <button className="lx-btn ghost wide" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
      </div>
    </div>,
    document.body
  );
}
