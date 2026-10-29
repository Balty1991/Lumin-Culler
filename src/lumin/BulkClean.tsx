import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { formatBytes } from '../core/freedSpace';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { DEFECT_SHARPNESS } from '../core/importPipeline';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { photoTime } from './days';
import { useLxPhotos } from './useLxPhotos';

/**
 * lumin/BulkClean.tsx
 * Curățenie pe criterii: „capturile mai vechi de 3 luni”, „pozele neclare din
 * ultimul an”, „documentele de peste 6 luni”, „ce am pus la Nu azi”. Se vede
 * întâi ce pleacă (număr, spațiu, primele poze), apoi coșul galeriei — de unde
 * se pot recupera. Nimic păstrat de om nu intră.
 */
type Kind = 'screenshot' | 'blurry' | 'document' | 'rejected';
const KINDS: Kind[] = ['screenshot', 'blurry', 'document', 'rejected'];
const AGES = [0, 1, 3, 6, 12] as const;
const MONTH = 30 * 86_400_000;

export function matchClean(p: PhotoView, kind: Kind, months: number, now = Date.now()): boolean {
  if (!p.mediaUri || p.status === 'selected') return false;
  if (months > 0 && photoTime(p) > now - months * MONTH) return false;
  switch (kind) {
    case 'screenshot': return p.aside === 'screenshot';
    case 'document': return p.aside === 'document';
    case 'blurry': return !p.aside && p.personNames.length === 0 && p.sharpness < DEFECT_SHARPNESS;
    case 'rejected': return p.status === 'rejected';
  }
}

export function BulkCleanButton() {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  if (!isNativeMediaLibraryAvailable()) return null;
  return (
    <>
      <button className="lx-btn ghost wide" onClick={() => setOpen(true)}>🧹 {tr('lx.bulk.open')}</button>
      {open && <BulkCleanSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function BulkCleanSheet({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const trashPhotos = useStore(s => s.trashPhotos);
  const [kind, setKind] = useState<Kind>('screenshot');
  const [months, setMonths] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => photos.filter(p => matchClean(p, kind, months)), [photos, kind, months]);
  const size = list.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);
  const go = async () => {
    if (!list.length) return;
    if (useStore.getState().gatePremium('cleanup')) return;
    setBusy(true);
    try { await trashPhotos(list.map(p => p.id)); onClose(); } finally { setBusy(false); }
  };
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>{tr('lx.bulk.title')}</h2>
        <p className="lx-hint">{tr('lx.bulk.what')}</p>
        <div className="lx-chips">
          {KINDS.map(k => <button key={k} className={kind === k ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setKind(k)}>{tr(`lx.bulk.kind.${k}`)}</button>)}
        </div>
        <p className="lx-hint">{tr('lx.bulk.older')}</p>
        <div className="lx-chips">
          {AGES.map(m => <button key={m} className={months === m ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setMonths(m)}>{m === 0 ? tr('lx.bulk.any') : tr('lx.bulk.months', { count: m })}</button>)}
        </div>
        <b>{tr('lx.bulk.count', { count: list.length, size: formatBytes(size, locale) })}</b>
        {list.length > 0 && (
          <div className="lx-bulk-strip">
            {list.slice(0, 8).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} sharp={false} />)}
          </div>
        )}
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
          <button className="lx-btn danger" disabled={!list.length || busy} onClick={() => void go()}>🗑 {tr('lx.bulk.go', { count: list.length })}</button>
        </div>
        <p className="lx-hint">{tr('lx.clean.safe')}</p>
      </div>
    </div>,
    document.body
  );
}
