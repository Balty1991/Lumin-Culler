import { useMemo, useState } from 'react';
import { useLxPhotos } from './useLxPhotos';
import { useStore, type PhotoView } from '../state/store';
import { startOfDay } from '../core/todayDigest';
import { photoTime } from './days';
import { makeCollage, shareCollage } from './collage';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { StoryButton } from './Story';
import { makeCalendar, makeYearBook, missingMonths, shareYearBook } from './yearBook';
import { intlTag } from '../i18n';

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
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();
  const kept = useMemo(() => photos.filter(p => p.status === 'selected' && !p.aside), [photos]);
  const week = useMemo(() => bestPer(kept.filter(p => photoTime(p) >= startOfDay(now) - 6 * DAY_MS), p => startOfDay(photoTime(p)), 7), [kept, now]);
  const year = new Date(now).getFullYear();
  // „Cele mai frumoase”: ultimele 30 de zile, după frumusețea văzută de AI (CLIP + LAION),
  // cel mult una pe oră (o rafală nu umple colajul cu aceeași scenă).
  const { beauty, beautyMonth } = useMemo(() => {
    const pick = (from: number, to: number) => {
      const best = new Map<number, PhotoView>();
      for (const p of kept) {
        const t = photoTime(p);
        if (p.aesthetic === undefined || t < from || t >= to) continue;
        const k = Math.floor(t / 3_600_000);
        const cur = best.get(k);
        if (!cur || (p.aesthetic ?? 0) > (cur.aesthetic ?? 0)) best.set(k, p);
      }
      return [...best.values()].sort((a, b) => (b.aesthetic ?? 0) - (a.aesthetic ?? 0)).slice(0, 10).sort((a, b) => photoTime(a) - photoTime(b));
    };
    const recent = pick(startOfDay(now) - 30 * DAY_MS, Infinity);
    if (recent.length >= 6) return { beauty: recent, beautyMonth: null as number | null };
    // Luna asta e săracă: cea mai recentă lună din trecut cu destule poze frumoase.
    const months = [...new Set(kept.filter(p => p.aesthetic !== undefined).map(p => { const d = new Date(photoTime(p)); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }))].sort((a, b) => b - a);
    for (const m of months) {
      const d = new Date(m);
      const list = pick(m, new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime());
      if (list.length >= 6) return { beauty: list, beautyMonth: m };
    }
    return { beauty: recent, beautyMonth: null as number | null };
  }, [kept, now]);
  const beautyMonthName = beautyMonth !== null ? new Date(beautyMonth).toLocaleDateString(intlTag(locale), { month: 'long', year: 'numeric' }) : '';
  // Retrospectiva anului: câte două pe lună, cele mai frumoase (CLIP + LAION), în ordine.
  const yearFilm = useMemo(() => {
    const byMonth = new Map<number, PhotoView[]>();
    for (const p of kept) {
      const d = new Date(photoTime(p));
      if (d.getFullYear() !== year) continue;
      byMonth.set(d.getMonth(), [...(byMonth.get(d.getMonth()) ?? []), p]);
    }
    const sc = (p: PhotoView) => p.aesthetic ?? p.aiScore / 12;
    return [...byMonth.keys()].sort((a, b) => a - b).flatMap(m => {
      const list = byMonth.get(m)!.sort((a, b) => sc(b) - sc(a));
      const out: PhotoView[] = [];
      for (const p of list) { if (out.length >= 2) break; if (out.every(o => Math.abs(photoTime(o) - photoTime(p)) > 3 * 3_600_000)) out.push(p); }
      return out;
    }).sort((a, b) => photoTime(a) - photoTime(b));
  }, [kept, year]);
  const yearPicks = useMemo(() => bestPer(kept.filter(p => new Date(photoTime(p)).getFullYear() === year), p => new Date(photoTime(p)).getMonth(), 7), [kept, year]);

  const share = async (kind: 'week' | 'year' | 'beauty', list: PhotoView[]) => {
    setBusy(kind);
    try {
      const title = tr(kind === 'week' ? 'lx.recap.week.title' : kind === 'beauty' ? (beautyMonthName ? 'lx.recap.beautyMonth.title' : 'lx.recap.beauty.title') : 'lx.recap.year.title', { count: list.length, year, month: beautyMonthName });
      const range = kind !== 'year'
        ? `${new Date(photoTime(list[0])).toLocaleDateString(intlTag(locale), { day: 'numeric', month: 'short' })} – ${new Date(photoTime(list[list.length - 1])).toLocaleDateString(intlTag(locale), { day: 'numeric', month: 'short' })}`
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

  const [bookProgress, setBookProgress] = useState('');
  const book = async () => {
    setBusy('book');
    try {
      const fmt = (m: number) => new Date(year, m, 1).toLocaleDateString(intlTag(locale), { month: 'long' });
      const blob = await makeYearBook(year, kept, {
        title: tr('lx.book.title'), subtitle: tr('lx.book.subtitle', { count: kept.filter(p => new Date(photoTime(p)).getFullYear() === year).length }),
        month: m => fmt(m).charAt(0).toUpperCase() + fmt(m).slice(1)
      }, (d, t) => setBookProgress(`${d}/${t}`));
      if (blob) await shareYearBook(blob, `cherrypic-${year}.pdf`);
      else useStore.getState().setNotice(tr('lx.recap.failed'));
    } catch {
      useStore.getState().setNotice(tr('lx.recap.failed'));
    } finally { setBusy(null); setBookProgress(''); }
  };

  const calendar = async () => {
    setBusy('calendar');
    try {
      const loc = intlTag(locale);
      const month = (m: number) => { const n = new Date(2024, m, 1).toLocaleDateString(loc, { month: 'long' }); return n.charAt(0).toUpperCase() + n.slice(1); };
      const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: 'short' }).replace('.', ''));
      const blob = await makeCalendar(year + 1, kept, { title: tr('lx.calendar.title'), month, weekdays }, (d, t) => setBookProgress(`${d}/${t}`));
      if (blob) await shareYearBook(blob, `cherrypic-calendar-${year + 1}.pdf`);
      else useStore.getState().setNotice(tr('lx.recap.failed'));
    } catch {
      useStore.getState().setNotice(tr('lx.recap.failed'));
    } finally { setBusy(null); setBookProgress(''); }
  };

  const bookMissing = missingMonths('book', year, kept);
  const calMissing = missingMonths('calendar', year, kept);
  const monthNames = (ms: number[]) => ms.length > 4 ? String(ms.length) : ms.map(m => new Date(2024, m, 1).toLocaleDateString(intlTag(locale), { month: 'short' }).replace('.', '')).join(', ');

  const cards: { kind: 'week' | 'year' | 'beauty'; list: PhotoView[] }[] = [];
  if (week.length >= 3) cards.push({ kind: 'week', list: week });
  if (beauty.length >= 6) cards.push({ kind: 'beauty', list: beauty });
  if (yearPicks.length >= 4) cards.push({ kind: 'year', list: yearPicks });
  if (!cards.length) return null;
  // Duminica, săptămâna vine prima și se vede mai tare.
  const sunday = new Date(now).getDay() === 0;

  return (
    <>
      {cards.map(c => (
        <section key={c.kind} className={`lx-recap ${c.kind}${sunday && c.kind === 'week' ? ' hot' : ''}`}>
          <div className="lx-recap-strip" aria-hidden="true">
            {c.list.slice(0, 5).map((p, i) => <span key={p.id} style={{ ['--i' as string]: i }}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></span>)}
          </div>
          <div className="lx-recap-text">
            <b>{tr(c.kind === 'week' ? 'lx.recap.week.title' : c.kind === 'beauty' ? (beautyMonthName ? 'lx.recap.beautyMonth.title' : 'lx.recap.beauty.title') : 'lx.recap.year.title', { count: c.list.length, year, month: beautyMonthName })}</b>
            <span>{tr(c.kind === 'week' ? 'lx.recap.week.sub' : c.kind === 'beauty' ? 'lx.recap.beauty.sub' : 'lx.recap.year.cta')}</span>
          </div>
          <div className="lx-recap-actions">
            <button className="lx-btn primary small" disabled={busy !== null} onClick={() => void share(c.kind, c.list)}>
              {busy === c.kind ? '…' : tr('lx.recap.share')}
            </button>
            <StoryButton className="lx-btn ghost small" ids={(c.kind === 'year' && yearFilm.length >= c.list.length ? yearFilm : c.list).slice(0, 24).map(p => p.id)}
              title={tr(c.kind === 'week' ? 'lx.story.weekTitle' : c.kind === 'beauty' ? 'lx.recap.beauty.title' : 'lx.story.yearTitle', { year, count: c.list.length })}
              subtitle={tr('lx.story.daySub', { count: Math.min(12, c.list.length) })} />
            {c.kind === 'year' && calMissing.length === 0 && (
              <button className="lx-btn ghost small" disabled={busy !== null} onClick={() => void calendar()}>
                {busy === 'calendar' ? `… ${bookProgress}` : `🗓 ${tr('lx.calendar.button', { year: year + 1 })}`}
              </button>
            )}
            {c.kind === 'year' && bookMissing.length === 0 && (
              <button className="lx-btn ghost small" disabled={busy !== null} onClick={() => void book()}>
                {busy === 'book' ? `… ${bookProgress}` : `📖 ${tr('lx.book.button')}`}
              </button>
            )}
          </div>
          {/* Fără poze din fiecare lună, cartea și calendarul nu se propun singure —
              rămân ca opțiune, cu lunile care lipsesc spuse pe față. */}
          {c.kind === 'year' && (calMissing.length > 0 || bookMissing.length > 0) && (
            <div className="lx-recap-anyway">
              {bookMissing.length > 0 && (
                <button className="lx-link" disabled={busy !== null} onClick={() => void book()}>
                  {busy === 'book' ? `… ${bookProgress}` : `📖 ${tr('lx.book.anyway', { months: monthNames(bookMissing) })}`}
                </button>
              )}
              {calMissing.length > 0 && (
                <button className="lx-link" disabled={busy !== null} onClick={() => void calendar()}>
                  {busy === 'calendar' ? `… ${bookProgress}` : `🗓 ${tr('lx.calendar.anyway', { year: year + 1, months: monthNames(calMissing) })}`}
                </button>
              )}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
