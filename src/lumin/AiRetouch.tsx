import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { cloudAiEdit, ensureCloud, type AiEditResult } from './cloud';
import { saveEditedBlob } from './saveEdited';
import { canSharpen, originalUri, sharpUrl } from './sharp';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { clarityOnDevice, cutoutOnDevice } from '../core/onDeviceEdit';
import { db } from '../core/db';
import { portraitOnDevice } from '../core/portraitEdit';

/**
 * lumin/AiRetouch.tsx
 * „Retuș AI”: editarea complexă (lumină, culoare, cer, ten) făcută de un model
 * generativ pe server. Ții apăsat pe poză ca să vezi originalul; salvezi o copie.
 */
/** Fața principală (cea mai mare, ușor favorizată spre centru): acolo cade focusul, ca la cameră. */
async function mainFaceCenter(id: string): Promise<{ x: number; y: number } | null> {
  const a = await db.analyses.get(id).catch(() => undefined);
  const faces = a?.faces ?? [];
  let best: { x: number; y: number; s: number } | null = null;
  for (const f of faces) {
    const [x, y, w, h] = f.box as number[];
    const cx = x + w / 2, cy = y + h / 2;
    const score = w * h * (1.2 - Math.hypot(cx - 0.5, cy - 0.5));
    if (!best || score > best.s) best = { x: cx, y: cy, s: score };
  }
  return best ? { x: Math.min(1, Math.max(0, best.x)), y: Math.min(1, Math.max(0, best.y)) } : null;
}

export type ToolKind = 'retouch' | 'clarity' | 'cutout' | 'portrait';

export function AiRetouch({ photo, onClose, kind = 'retouch' }: { photo: PhotoView; onClose: () => void; kind?: ToolKind }) {
  const tr = useTr();
  const [state, setState] = useState<'work' | 'done' | 'error'>('work');
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [why, setWhy] = useState('');
  const [peek, setPeek] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Portret: cât de tare se estompează și pe ce rămâne clar (atingere pe poză). */
  const [strength, setStrength] = useState(0.7);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const srcBlob = useRef<Blob | null>(null);
  const pressAt = useRef(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (kind !== 'retouch') {
        // Pe telefon, gratuit: claritate (Real-ESRGAN) sau decupaj pe fundal alb (U²-Net).
        if (!srcBlob.current) {
          const url = (canSharpen() ? await sharpUrl(photo.id, kind === 'clarity' ? 1024 : 1600).catch(() => null) : null) ?? await getCachedPreviewUrl(photo.id);
          srcBlob.current = url ? await fetch(url).then(x => x.blob()).catch(() => null) : null;
        }
        const src = srcBlob.current;
        setState('work');
        const out = src ? await (kind === 'clarity' ? clarityOnDevice(src) : kind === 'portrait' ? portraitOnDevice(src, strength, focus ?? (await mainFaceCenter(photo.id)) ?? undefined, await originalUri(photo.id).catch(() => null)) : cutoutOnDevice(src, 'white')) : null;
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
  }, [photo.id, strength, focus]);
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
      <div className="lx-enhance-stage"
        onPointerDown={() => { pressAt.current = performance.now(); if (kind !== 'portrait') setPeek(true); else window.setTimeout(() => { if (pressAt.current) setPeek(true); }, 260); }}
        onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
          const quick = pressAt.current && performance.now() - pressAt.current < 250;
          pressAt.current = 0; setPeek(false);
          // Portret: o atingere scurtă alege ce rămâne clar.
          if (kind === 'portrait' && quick && state === 'done') {
            const img = e.currentTarget.querySelector('img');
            const r = img?.getBoundingClientRect();
            if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
              setFocus({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
            }
          }
        }}
        onPointerCancel={() => { pressAt.current = 0; setPeek(false); }} onPointerLeave={() => { pressAt.current = 0; setPeek(false); }}>
        {state === 'done' && url && !peek
          ? <img className="lx-ai-retouch-img" src={url} alt="" draggable={false} />
          : <span className="lx-ai-retouch-orig"><Thumb id={photo.id} lqip={photo.lqip} edits={photo.edits} full /></span>}
        {state === 'work' && <div className="lx-enhance-wait lx-ai-retouch-wait"><span className="lx-spinner" />{tr(kind === 'retouch' ? 'lx.aiRetouch.working' : 'lx.tool.working')}</div>}
        {state === 'done' && <span className="lx-enhance-tag right">{tr(peek ? 'lx.enhance.before' : 'lx.enhance.after')}</span>}
      </div>
      <div className="lx-viewer-info">
        {kind === 'portrait' && (
          <div className="lx-seg small lx-portrait-strength" role="radiogroup" aria-label={tr('lx.portrait.strength')}>
            {[0.4, 0.7, 1].map(v => (
              <button key={v} role="radio" aria-checked={strength === v} className={strength === v ? 'on' : ''} disabled={state === 'work'} onClick={() => setStrength(v)}>
                {tr(v === 0.4 ? 'lx.portrait.low' : v === 0.7 ? 'lx.portrait.mid' : 'lx.portrait.high')}
              </button>
            ))}
          </div>
        )}
        <p className="lx-hint center">{state === 'error' ? why : state === 'done' ? tr(kind === 'portrait' ? 'lx.portrait.hint' : 'lx.aiRetouch.hint') : tr(kind === 'retouch' ? 'lx.aiRetouch.wait' : 'lx.tool.local')}</p>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
          <button className="lx-btn primary" disabled={state !== 'done' || saving} onClick={() => void save()}>{tr('lx.enhance.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
