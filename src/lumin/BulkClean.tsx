import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { settleFreeCleanup, useStore, type PhotoView } from '../state/store';
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
type Kind = 'screenshot' | 'blurry' | 'document' | 'rejected' | 'dark';
const KINDS: Kind[] = ['screenshot', 'blurry', 'dark', 'document', 'rejected'];
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
    case 'dark': return !p.aside && p.personNames.length === 0 && p.exposure < 18;
  }
}

/**
 * „Spune ce să curăț”: o frază obișnuită → ce fel de poze și de când.
 * Fără AI online: cuvinte-cheie în română și engleză. Exemple:
 * „șterge capturile mai vechi de o lună”, „pozele mișcate și întunecate de anul trecut”.
 */
export function parseCleanCommand(text: string): { kinds: Kind[]; months: number | null } {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const kinds: Kind[] = [];
  const add = (k: Kind, re: RegExp) => { if (re.test(t) && !kinds.includes(k)) kinds.push(k); };
  add('screenshot', /captur|screenshot|ecran/);
  add('blurry', /miscat|neclar|blur|ratat|tremurat/);
  add('dark', /intunecat|negre|intuneric|dark/);
  add('document', /document|bon|acte|chitant|factur|receipt/);
  add('rejected', /nu azi|respins|refuzat|rejected/);
  let months: number | null = null;
  const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : /^(o|un|una|a)$/.test(w) ? 1 : /^(doua|doi)$/.test(w) ? 2 : /^trei$/.test(w) ? 3 : /^sase$/.test(w) ? 6 : 1);
  const m = /(?:mai vechi de|de peste|older than|peste)\s+(\w+)?\s*(zi|zile|saptaman|luni|luna|an|ani|day|week|month|year)/.exec(t);
  if (m) {
    const n = num(m[1] ?? '1');
    const u = m[2];
    months = /^an|year/.test(u) ? n * 12 : /saptaman|week/.test(u) ? Math.max(0, Math.round(n / 4)) : /^zi|day/.test(u) ? 0 : n;
  } else if (/anul trecut|last year/.test(t)) months = 12;
  else if (/(toate|oricand|all)/.test(t)) months = 0;
  return { kinds, months };
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
  const [kinds, setKinds] = useState<Kind[]>(['screenshot']);
  const [months, setMonths] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [understood, setUnderstood] = useState<boolean | null>(null);
  const toggle = (k: Kind) => setKinds(v => (v.includes(k) ? (v.length > 1 ? v.filter(x => x !== k) : v) : [...v, k]));
  const apply = () => {
    const r = parseCleanCommand(said);
    if (r.kinds.length) setKinds(r.kinds);
    if (r.months !== null) setMonths(AGES.reduce((best, a) => (Math.abs(a - r.months!) < Math.abs(best - r.months!) ? a : best), AGES[0]));
    setUnderstood(r.kinds.length > 0);
  };
  const list = useMemo(() => photos.filter(p => kinds.some(k => matchClean(p, k, months))), [photos, kinds, months]);
  const size = list.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);
  const go = async () => {
    if (!list.length) return;
    if (useStore.getState().gatePremium('cleanup')) return;
    setBusy(true);
    let used = false;
    try {
      const r = await trashPhotos(list.map(p => p.id));
      used = !r.cancelled && r.deleted > 0;
      onClose();
    } finally { setBusy(false); settleFreeCleanup(used); }
  };
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>{tr('lx.bulk.title')}</h2>
        <form className="lx-say" onSubmit={e => { e.preventDefault(); apply(); }}>
          <input value={said} onChange={e => { setSaid(e.target.value); setUnderstood(null); }} placeholder={tr('lx.bulk.sayPlaceholder')} aria-label={tr('lx.bulk.sayPlaceholder')} />
          <button className="lx-btn primary small" type="submit" disabled={!said.trim()}>{tr('lx.bulk.sayGo')}</button>
        </form>
        {understood === false && <p className="lx-hint">{tr('lx.bulk.sayNo')}</p>}
        <p className="lx-hint">{tr('lx.bulk.what')}</p>
        <div className="lx-chips">
          {KINDS.map(k => <button key={k} className={kinds.includes(k) ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => toggle(k)}>{tr(`lx.bulk.kind.${k}`)}</button>)}
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
