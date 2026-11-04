import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { useLx } from './lxStore';
import { useLxPhotos } from './useLxPhotos';
import { intlTag } from '../i18n';
import { Thumb } from './Thumb';

/**
 * lumin/EmotionYear.tsx
 * „Anul în zâmbete”: un calendar al anului colorat după zâmbetele din poze.
 * Zilele fericite strălucesc; atingi o zi și vezi cel mai frumos zâmbet din ea.
 */
export interface DayJoy { day: number; joy: number; best: PhotoView; ids: string[] }

/** Pe zile (începutul zilei): cel mai mare zâmbet și poza lui (doar zilele cu fețe contează). */
export function joyByDay(photos: readonly PhotoView[], year: number): Map<number, DayJoy> {
  const out = new Map<number, DayJoy>();
  for (const p of photos) {
    if (p.capturedAt === undefined) continue;
    const d = new Date(p.capturedAt);
    if (d.getFullYear() !== year) continue;
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const joy = p.faceCount > 0 ? Math.max(0, Math.min(1, p.bestSmile)) : 0;
    const cur = out.get(key);
    if (!cur) out.set(key, { day: key, joy, best: p, ids: [p.id] });
    else {
      cur.ids.push(p.id);
      if (joy > cur.joy || (joy === cur.joy && p.aiScore > cur.best.aiScore)) { cur.joy = joy; cur.best = p; }
    }
  }
  return out;
}

export function EmotionYearCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [open, setOpen] = useState(false);
  const smiles = useMemo(() => photos.filter(p => p.faceCount > 0 && p.bestSmile >= 0.6).length, [photos]);
  if (smiles < 10) return null;
  return (
    <>
      <button className="lx-card lx-profile-card" onClick={() => setOpen(true)}>
        <span className="lx-joy-badge" aria-hidden="true">
          {[0.9, 0.3, 0.6, 1, 0.5, 0.8, 0.2, 0.7, 0.4].map((v, i) => <i key={i} style={{ opacity: v }} />)}
        </span>
        <span><b>{tr('lx.joy.title')}</b><small>{tr('lx.joy.sub', { count: smiles })}</small></span>
        <span aria-hidden="true">›</span>
      </button>
      {open && <EmotionYear onClose={() => setOpen(false)} />}
    </>
  );
}

function EmotionYear({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const photos = useLxPhotos();
  const years = useMemo(() => [...new Set(photos.filter(p => p.capturedAt).map(p => new Date(p.capturedAt!).getFullYear()))].sort((a, b) => b - a), [photos]);
  const [year, setYear] = useState(() => years[0] ?? new Date().getFullYear());
  const [picked, setPicked] = useState<DayJoy | null>(null);
  const days = useMemo(() => joyByDay(photos, year), [photos, year]);
  const tag = intlTag(locale);
  // Luna cea mai zâmbitoare: media zilelor cu fețe.
  const bestMonth = useMemo(() => {
    const sum = new Array(12).fill(0), n = new Array(12).fill(0);
    for (const d of days.values()) if (d.joy > 0) { const m = new Date(d.day).getMonth(); sum[m] += d.joy; n[m]++; }
    let best = -1, v = 0;
    for (let m = 0; m < 12; m++) if (n[m] >= 3 && sum[m] / n[m] > v) { v = sum[m] / n[m]; best = m; }
    return best;
  }, [days]);
  const happyDays = [...days.values()].filter(d => d.joy >= 0.6).length;
  return createPortal(
    <div className="lx lx-enhance lx-joy" role="dialog" aria-modal="true" aria-label={tr('lx.joy.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.joy.title')}</span>
        <span />
      </header>
      <div className="lx-fm-body">
        {years.length > 1 && (
          <div className="lx-enhance-styles" role="radiogroup">
            {years.map(y => <button key={y} role="radio" aria-checked={y === year} className={y === year ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => { setYear(y); setPicked(null); }}>{y}</button>)}
          </div>
        )}
        <p className="lx-joy-sum">
          {tr('lx.joy.happyDays', { count: happyDays })}
          {bestMonth >= 0 && <> · {tr('lx.joy.bestMonth', { month: new Date(year, bestMonth, 1).toLocaleDateString(tag, { month: 'long' }) })}</>}
        </p>
        <div className="lx-joy-grid">
          {Array.from({ length: 12 }, (_, m) => {
            const len = new Date(year, m + 1, 0).getDate();
            return (
              <div key={m} className="lx-joy-row">
                <span>{new Date(year, m, 1).toLocaleDateString(tag, { month: 'short' })}</span>
                <div>
                  {Array.from({ length: 31 }, (_, i) => {
                    if (i >= len) return <i key={i} className="none" />;
                    const key = new Date(year, m, i + 1).getTime();
                    const d = days.get(key);
                    const cls = !d ? 'empty' : d.joy <= 0 ? 'plain' : 'joy';
                    return (
                      <i key={i} className={picked?.day === key ? `${cls} on` : cls} style={d && d.joy > 0 ? { ['--j' as string]: String(0.25 + d.joy * 0.75) } : undefined}
                        onClick={() => d && setPicked(d)} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="lx-joy-legend"><i className="plain" />{tr('lx.joy.legendPhotos')}<i className="joy" style={{ ['--j' as string]: '1' }} />{tr('lx.joy.legendSmiles')}</div>
        {picked && (
          <button className="lx-card lx-joy-pick" onClick={() => { onClose(); useLx.getState().openViewer(picked.ids, Math.max(0, picked.ids.indexOf(picked.best.id))); }}>
            <span className="lx-joy-thumb"><Thumb id={picked.best.id} lqip={picked.best.lqip} edits={picked.best.edits} /></span>
            <span>
              <b>{new Date(picked.day).toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
              <small>{tr('lx.joy.dayPhotos', { count: picked.ids.length })}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
