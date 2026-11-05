import { useEffect, useMemo, useRef, useState } from 'react';
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

export function EmotionYear({ onClose }: { onClose: () => void }) {
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
  // Luna arătată: cea mai recentă cu poze din anul ales.
  const lastMonth = useMemo(() => Math.max(0, ...[...days.values()].map(d => new Date(d.day).getMonth())), [days]);
  const [month, setMonth] = useState<number>(lastMonth);
  useEffect(() => { setMonth(lastMonth); }, [lastMonth]);
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
        <JoyMonths year={year} days={days} month={month} tag={tag} onMonth={m => { setMonth(m); setPicked(null); }} />
        <JoyMonth year={year} month={month} days={days} picked={picked?.day ?? null} tag={tag} onPick={setPicked}
          onPrev={() => setMonth(m => Math.max(0, m - 1))} onNext={() => setMonth(m => Math.min(11, m + 1))} />
        <p className="lx-joy-help">{tr('lx.joy.help')}</p>
        <JoyTop days={days} tag={tag} onPick={d => { setMonth(new Date(d.day).getMonth()); setPicked(d); }} />
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

/** Anul pe luni: câte zile cu zâmbete are fiecare lună, ca bare (atingi o lună ca s-o vezi). */
function JoyMonths({ year, days, month, tag, onMonth }: { year: number; days: Map<number, DayJoy>; month: number; tag: string; onMonth: (m: number) => void }) {
  const counts = useMemo(() => {
    const c = new Array(12).fill(0);
    for (const d of days.values()) if (d.joy >= 0.4) c[new Date(d.day).getMonth()]++;
    return c;
  }, [days]);
  const max = Math.max(1, ...counts);
  return (
    <div className="lx-joy-bars" role="radiogroup">
      {counts.map((c, m) => (
        <button key={m} role="radio" aria-checked={m === month} className={m === month ? 'on' : undefined} onClick={() => onMonth(m)}>
          <span className="lx-joy-bar"><i style={{ height: `${Math.max(6, (c / max) * 100)}%`, opacity: c ? 1 : 0.25 }} /></span>
          <small>{new Date(year, m, 1).toLocaleDateString(tag, { month: 'narrow' })}</small>
        </button>
      ))}
    </div>
  );
}

/**
 * O lună ca un calendar adevărat (luni–duminică): în zilele cu zâmbete se vede
 * chiar poza, cu un inel roz; zilele cu poze fără zâmbete sunt gri; restul goale.
 * Mărimile sunt calculate în pixeli (fără grile cu proporții, pe care WebView-ul
 * le strica).
 */
function JoyMonth({ year, month, days, picked, tag, onPick, onPrev, onNext }: {
  year: number; month: number; days: Map<number, DayJoy>; picked: number | null; tag: string;
  onPick: (d: DayJoy) => void; onPrev: () => void; onNext: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el); setW(el.clientWidth || 340);
    return () => ro.disconnect();
  }, []);
  const gap = 6;
  const cell = Math.floor((w - gap * 6) / 7);
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const len = new Date(year, month + 1, 0).getDate();
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(tag, { weekday: 'narrow' }));
  const smiles = [...days.values()].filter(d => new Date(d.day).getMonth() === month && d.joy >= 0.4).length;
  const title = first.toLocaleDateString(tag, { month: 'long', year: 'numeric' });
  return (
    <div className="lx-joy-month" ref={ref}>
      <div className="lx-joy-mhead">
        <button className="lx-icon-btn small" onClick={onPrev} disabled={month === 0} aria-label="‹">‹</button>
        <span><b>{title.charAt(0).toUpperCase() + title.slice(1)}</b><small>{smiles ? `${smiles} ★` : ''}</small></span>
        <button className="lx-icon-btn small" onClick={onNext} disabled={month === 11} aria-label="›">›</button>
      </div>
      <div className="lx-joy-week">{weekdays.map((d, i) => <span key={i} style={{ width: cell }}>{d}</span>)}</div>
      <div className="lx-joy-days" style={{ gap }}>
        {Array.from({ length: offset }, (_, i) => <span key={`e${i}`} style={{ width: cell, height: cell }} />)}
        {Array.from({ length: len }, (_, i) => {
          const key = new Date(year, month, i + 1).getTime();
          const d = days.get(key);
          const smile = !!d && d.joy >= 0.4;
          const cls = `lx-joy-day${!d ? ' none' : smile ? ' smile' : ' plain'}${picked === key ? ' on' : ''}`;
          return (
            <button key={key} className={cls} style={{ width: cell, height: cell }} disabled={!d} onClick={() => d && onPick(d)}>
              {smile && <Thumb id={d!.best.id} lqip={d!.best.lqip} edits={d!.best.edits} />}
              <span>{i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Cele mai zâmbitoare zile ale anului, ca o bandă de poze cu data. */
function JoyTop({ days, tag, onPick }: { days: Map<number, DayJoy>; tag: string; onPick: (d: DayJoy) => void }) {
  const tr = useTr();
  const top = useMemo(() => [...days.values()].filter(d => d.joy >= 0.4).sort((a, b) => b.joy - a.joy).slice(0, 10), [days]);
  if (!top.length) return null;
  return (
    <section className="lx-joy-topwrap">
      <h3>{tr('lx.joy.top')}</h3>
      <div className="lx-joy-top">
        {top.map(d => (
          <button key={d.day} onClick={() => onPick(d)}>
            <span className="lx-joy-topimg"><Thumb id={d.best.id} lqip={d.best.lqip} edits={d.best.edits} /></span>
            <small>{new Date(d.day).toLocaleDateString(tag, { day: 'numeric', month: 'short' })}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
