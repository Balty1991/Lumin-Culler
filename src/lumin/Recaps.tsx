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

  const [bookProgress, setBookProgress] = useState('');
  const book = async () => {
    setBusy('book');
    try {
      const fmt = (m: number) => new Date(year, m, 1).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', { month: 'long' });
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
      const loc = locale === 'en' ? 'en-GB' : 'ro-RO';
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
  const monthNames = (ms: number[]) => ms.length > 4 ? String(ms.length) : ms.map(m => new Date(2024, m, 1).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', { month: 'short' }).replace('.', '')).join(', ');

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
            {c.list.slice(0, 5).map((p, i) => <span key={p.id} style={{ ['--i' as string]: i }}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></span>)}
          </div>
          <div className="lx-recap-text">
            <b>{tr(c.kind === 'week' ? 'lx.recap.week.title' : 'lx.recap.year.title', { count: c.list.length, year })}</b>
            <span>{tr(c.kind === 'week' ? 'lx.recap.week.sub' : 'lx.recap.year.cta')}</span>
          </div>
          <div className="lx-recap-actions">
            <button className="lx-btn primary small" disabled={busy !== null} onClick={() => void share(c.kind, c.list)}>
              {busy === c.kind ? '…' : tr('lx.recap.share')}
            </button>
            <StoryButton className="lx-btn ghost small" ids={c.list.slice(0, 12).map(p => p.id)}
              title={tr(c.kind === 'week' ? 'lx.story.weekTitle' : 'lx.story.yearTitle', { year })}
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
