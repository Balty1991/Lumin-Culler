import { useMemo, useState } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { startOfDay } from '../core/todayDigest';
import { photoTime } from './days';
import { makeCollage, shareCollage } from './collage';
import { useTr } from './context';
import { Thumb } from './Thumb';

const DAY_MS = 86_400_000;

/** Cele mai bune: câte una pe grupă (zi sau lună), apoi după scor. */
function bestPer(photos: PhotoView[], key: (p: PhotoView) => number, limit: number): PhotoView[] {
  const best = new Map<number, PhotoView>();
  for (const p of photos) {
    const k = key(p);
    const cur = best.get(k);
    if (!cur || p.aiScore > cur.aiScore) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => b.aiScore - a.aiScore).slice(0, limit).sort((a, b) => photoTime(a) - photoTime(b));
}

/**
 * lumin/Recaps.tsx
 * „Săptămâna ta în 7 poze” (cel mai vizibil duminica) și „Anul tău în poze”:
 * câte o poză pe zi / pe lună, din cele păstrate, într-un colaj de trimis.
 */
export function Recaps() {
  const tr = useTr();
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();
  const kept = useMemo(() => photos.filter(p => p.status === 'selected' && !p.aside), [photos]);
  const week = useMemo(() => bestPer(kept.filter(p => photoTime(p) >= startOfDay(now) - 6 * DAY_MS), p => startOfDay(photoTime(p)), 7), [kept, now]);
  const year = new Date(now).getFullYear();
  const yearPicks = useMemo(() => bestPer(kept.filter(p => new Date(photoTime(p)).getFullYear() === year), p => new Date(photoTime(p)).getMonth(), 7), [kept, year]);

  const share = async (kind: 'week' | 'year', list: PhotoView[]) => {
    setBusy(kind);
    try {
      const title = tr(kind === 'week' ? 'lx.recap.week.title' : 'lx.recap.year.title', { count: list.length, year });
      const range = kind === 'week'
        ? `${new Date(photoTime(list[0])).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'short' })} – ${new Date(photoTime(list[list.length - 1])).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'short' })}`
        : tr('lx.recap.year.sub', { count: kept.filter(p => new Date(photoTime(p)).getFullYear() === year).length });
      const blob = await makeCollage(list.map(p => p.id), title, range);
      if (blob) await shareCollage(blob, `lumin-${kind}-${year}.jpg`, title);
      else useStore.getState().setNotice(tr('lx.recap.failed'));
    } catch {
      useStore.getState().setNotice(tr('lx.recap.failed'));
    } finally {
      setBusy(null);
    }
  };

  const cards: { kind: 'week' | 'year'; list: PhotoView[] }[] = [];
  if (week.length >= 3) cards.push({ kind: 'week', list: week });
  if (yearPicks.length >= 4) cards.push({ kind: 'year', list: yearPicks });
  if (!cards.length) return null;
  // Duminica, săptămâna vine prima și se vede mai tare.
  const sunday = new Date(now).getDay() === 0;

  return (
    <>
      {cards.map(c => (
        <section key={c.kind} className={`lx-recap ${c.kind}${sunday && c.kind === 'week' ? ' hot' : ''}`}>
          <div className="lx-recap-strip" aria-hidden="true">
            {c.list.slice(0, 5).map((p, i) => <span key={p.id} style={{ ['--i' as string]: i }}><Thumb id={p.id} lqip={p.lqip} /></span>)}
          </div>
          <div className="lx-recap-text">
            <b>{tr(c.kind === 'week' ? 'lx.recap.week.title' : 'lx.recap.year.title', { count: c.list.length, year })}</b>
            <span>{tr(c.kind === 'week' ? 'lx.recap.week.sub' : 'lx.recap.year.cta')}</span>
          </div>
          <button className="lx-btn primary small" disabled={busy !== null} onClick={() => void share(c.kind, c.list)}>
            {busy === c.kind ? '…' : tr('lx.recap.share')}
          </button>
        </section>
      ))}
    </>
  );
}
