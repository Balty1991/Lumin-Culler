import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { cloudAiEdit, ensureCloud, type AiEditResult } from './cloud';
import { saveEditedBlob } from './saveEdited';
import { canSharpen, sharpUrl } from './sharp';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { clarityOnDevice, cutoutOnDevice } from '../core/onDeviceEdit';

/**
 * lumin/AiRetouch.tsx
 * „Retuș AI”: editarea complexă (lumină, culoare, cer, ten) făcută de un model
 * generativ pe server. Ții apăsat pe poză ca să vezi originalul; salvezi o copie.
 */
export type ToolKind = 'retouch' | 'clarity' | 'cutout';

export function AiRetouch({ photo, onClose, kind = 'retouch' }: { photo: PhotoView; onClose: () => void; kind?: ToolKind }) {
  const tr = useTr();
  const [state, setState] = useState<'work' | 'done' | 'error'>('work');
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [why, setWhy] = useState('');
  const [peek, setPeek] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (kind !== 'retouch') {
        // Pe telefon, gratuit: claritate (Real-ESRGAN) sau decupaj pe fundal alb (U²-Net).
        const url = (canSharpen() ? await sharpUrl(photo.id, kind === 'clarity' ? 1024 : 1600).catch(() => null) : null) ?? await getCachedPreviewUrl(photo.id);
        const src = url ? await fetch(url).then(x => x.blob()).catch(() => null) : null;
        const out = src ? await (kind === 'clarity' ? clarityOnDevice(src) : cutoutOnDevice(src, 'white')) : null;
        if (!alive) return;
        if (out) { setBlob(out); setUrl(URL.createObjectURL(out)); setState('done'); return; }
        setWhy(tr('lx.aiRetouch.err.failed')); setState('error'); return;
      }
      if (!(await ensureCloud(useStore.getState().askConfirm, tr))) { onClose(); return; }
      const r: AiEditResult = await cloudAiEdit(photo.id, 'enhance');
      if (!alive) return;
      if (r.ok) { setBlob(r.image); setUrl(URL.createObjectURL(r.image)); setState('done'); return; }
      if (r.reason === 'premium' || r.reason === 'consent') { onClose(); return; }
      setWhy(tr(`lx.aiRetouch.err.${r.reason}`)); setState('error');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const save = async () => {
    if (!blob) return;
    setSaving(true);
    const ok = await saveEditedBlob(blob, kind === 'retouch' ? 'retus-ai' : kind).catch(() => false);
    useStore.getState().setNotice(tr(ok ? 'lx.magic.saved' : 'lx.magic.failed'));
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <div className="lx lx-enhance lx-ai-retouch" role="dialog" aria-modal="true" aria-label={tr(`lx.tool.${kind}.title`)}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">✨ {tr(`lx.tool.${kind}.title`)}</span>
        <span />
      </header>
      <div className="lx-enhance-stage" onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerCancel={() => setPeek(false)} onPointerLeave={() => setPeek(false)}>
        {state === 'done' && url && !peek
          ? <img className="lx-ai-retouch-img" src={url} alt="" draggable={false} />
          : <span className="lx-ai-retouch-orig"><Thumb id={photo.id} lqip={photo.lqip} edits={photo.edits} full /></span>}
        {state === 'work' && <div className="lx-enhance-wait lx-ai-retouch-wait"><span className="lx-spinner" />{tr(kind === 'retouch' ? 'lx.aiRetouch.working' : 'lx.tool.working')}</div>}
        {state === 'done' && <span className="lx-enhance-tag right">{tr(peek ? 'lx.enhance.before' : 'lx.enhance.after')}</span>}
      </div>
      <div className="lx-viewer-info">
        <p className="lx-hint center">{state === 'error' ? why : state === 'done' ? tr('lx.aiRetouch.hint') : tr(kind === 'retouch' ? 'lx.aiRetouch.wait' : 'lx.tool.local')}</p>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
          <button className="lx-btn primary" disabled={state !== 'done' || saving} onClick={() => void save()}>{tr('lx.enhance.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
