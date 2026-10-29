import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { countGalleryPhotosSince, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { startOfDay } from '../core/todayDigest';
import { readRitualDays, streakOf } from '../core/ritualStreak';
import { readTasteScore } from '../core/tasteScore';
import { groupDays } from './days';
import { reasonsFor } from './reasons';
import { useLx } from './lxStore';
import { useLxActions, useTr } from './context';
import { Orb } from './Orb';
import { LumiFeed } from './LumiFeed';
import { continueOnLowBattery, readerStopped, resumeGalleryReader, stopGalleryReader } from './galleryReader';
import { Thumb } from './Thumb';
import { FreedCard } from './TwinParts';
import { DayStory } from './DayStory';
import { readTwin } from './twin';
import { plural } from '../i18n';
import { dayLabel, daySummary } from './format';
import { buildCoverage, useGalleryMonths } from './coverage';
import { CleanupCard } from './Cleanup';
import { onThisDay } from './momentAlbums';
import { Recaps } from './Recaps';

/**
 * lumin/TodayScreen.tsx
 * „Azi”: ecranul principal. Sus, AI-ul și ce face acum (citește, analizează,
 * așteaptă). Dedesubt, rezultatul zilei: pozele alese, mari, cu motivul; un
 * singur buton pentru ce mai cere o decizie. Apoi zilele trecute, pe scurt.
 */
export function TodayScreen() {
  const tr = useTr();
  const { pick } = useLxActions();
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const importing = useStore(s => s.supervisorImporting);
  const locale = useStore(s => s.locale);
  const importToday = useStore(s => s.importToday);
  const acceptDayPicks = useStore(s => s.acceptDayPicks);
  const premiumLocked = useStore(s => s.premiumLocked);
  const openSort = useLx(s => s.openSort);
  const setTab = useLx(s => s.setTab);
  const setOpenDay = useLx(s => s.setOpenDay);
  const autoResult = useLx(s => s.autoResult);
  const reader = useLx(s => s.reader);
  const readerResult = useLx(s => s.readerResult);
  const setReaderResult = useLx(s => s.setReaderResult);
  const gatePremium = useStore(s => s.gatePremium);
  // Proba Pro, o singură dată: chiar după primul „am sortat singură” — atunci
  // omul a văzut ce face Lumi și înțelege ce cumpără („Lumi decide tot”).
  useEffect(() => {
    if (!autoResult || !premiumLocked) return;
    try { if (localStorage.getItem('lumin-trial-offered')) return; } catch { return; }
    const t = window.setTimeout(() => {
      try { localStorage.setItem('lumin-trial-offered', '1'); } catch { /* fără stocare */ }
      gatePremium('acceptAll');
    }, 2500);
    return () => window.clearTimeout(t);
  }, [autoResult, premiumLocked, gatePremium]);
  const setAutoResult = useLx(s => s.setAutoResult);

  const days = useMemo(() => groupDays(photos), [photos]);
  const todayStart = startOfDay();
  const today = days.find(d => d.start === todayStart);
  const past = days.filter(d => d.start < todayStart).slice(0, 4);
  // Cititorul galeriei lucrează în fundal: Azi rămâne Azi, cu o bară mică dedesubt.
  const busy = (!reader || reader.paused === 'import') && (importing || (!!progress && progress.phase !== 'finalizat'));

  const [inGallery, setInGallery] = useState<number | null>(null);
  useEffect(() => {
    if (!isNativeMediaLibraryAvailable() || busy) return;
    let alive = true;
    void countGalleryPhotosSince(todayStart).then(r => { if (alive && r.granted) setInGallery(r.count); }).catch(() => {});
    return () => { alive = false; };
  }, [busy, photos.length, todayStart]);

  const waitingInGallery = Math.max(0, (inGallery ?? 0) - (today?.photos.length ?? 0));
  const streak = streakOf(readRitualDays());
  const score = readTasteScore();
  const twin = readTwin();
  const dateLabel = dayLabel(todayStart, locale);

  const sortToday = async () => {
    await importToday();
    const fresh = groupDays(useStore.getState().photos).find(d => d.start === todayStart);
    if (fresh?.waiting.length) openSort(fresh.waiting.map(p => p.id), tr('lx.sort.today'));
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="lx-screen lx-today">
      <header className="lx-head">
        <span className="lx-eyebrow">{dateLabel}</span>
        {streak > 1 && <span className="lx-pill warm">{tr('lx.streak', { count: streak })}</span>}
      </header>

      <section className="lx-hero">
        <Orb mood={busy ? 'think' : 'idle'} size={busy ? 132 : 112} />
        {busy && progress ? (
          <div className="lx-hero-text">
            <h1 className="lx-h1">{tr(progress.phase === 'citire' ? 'lx.today.reading' : 'lx.today.analysing')}</h1>
            <p className="lx-sub">{tr('lx.today.progress', { done: progress.done, total: progress.total })}</p>
            <div className="lx-progress"><i style={{ width: `${percent}%` }} /></div>
          </div>
        ) : waitingInGallery > 0 ? (
          <div className="lx-hero-text">
            <h1 className="lx-h1">{tr(plural(waitingInGallery, 'lx.today.new.one', 'lx.today.new'), { count: waitingInGallery })}</h1>
            <p className="lx-sub">{tr('lx.today.newSub')}</p>
            <button className="lx-btn primary" onClick={() => void sortToday()}>{tr('lx.today.letAi')}</button>
          </div>
        ) : today && today.photos.length > 0 ? (
          <div className="lx-hero-text">
            <h1 className="lx-h1">
              {tr(plural(today.photos.length, 'lx.today.from.one', 'lx.today.from'), { count: today.photos.length })}{' '}
              <em>{tr(plural(today.kept.length, 'lx.today.kept.one', 'lx.today.kept'), { count: today.kept.length })}</em>
            </h1>
            {today.waiting.length === 0 && <p className="lx-sub">{tr('lx.today.allDone')}</p>}
          </div>
        ) : (
          <div className="lx-hero-text">
            <h1 className="lx-h1">{tr('lx.today.empty')}</h1>
            <p className="lx-sub">{tr('lx.today.emptySub')}</p>
            <button className="lx-btn primary" onClick={() => void (isNativeMediaLibraryAvailable() ? sortToday() : pick())}>
              {tr(isNativeMediaLibraryAvailable() ? 'lx.today.checkGallery' : 'lx.addPhotos')}
            </button>
          </div>
        )}
      </section>

      <LumiFeed />

      {reader && reader.paused !== 'import' && (
        <section className="lx-card lx-reader" role="status">
          <span className="lx-eyebrow">{tr('lx.reader.eyebrow')}</span>
          <b>{tr(reader.paused === 'battery' ? 'lx.reader.paused' : 'lx.reader.title', { done: reader.done, total: reader.total })}</b>
          <div className="lx-progress small"><i style={{ width: `${reader.total ? Math.round((reader.done / reader.total) * 100) : 0}%` }} /></div>
          <span>{tr('lx.reader.sub')}</span>
          <div className="lx-reader-actions">
            {reader.paused === 'battery' && <button className="lx-btn ghost small" onClick={continueOnLowBattery}>{tr('lx.reader.continue')}</button>}
            <button className="lx-btn ghost small" onClick={stopGalleryReader}>■ {tr('lx.reader.stop')}</button>
          </div>
        </section>
      )}
      {!reader && readerStopped() && <ReaderStopped />}
      {readerResult && !reader && (
        <section className="lx-card lx-auto-result" role="status">
          <button className="lx-auto-close" onClick={() => setReaderResult(null)} aria-label={tr('lx.close')}>✕</button>
          <span className="lx-eyebrow">{tr('lx.reader.eyebrow')}</span>
          <b>{tr('lx.reader.doneTitle', { total: readerResult.total })}</b>
          <span>{tr('lx.reader.doneSub', { kept: readerResult.kept, waiting: readerResult.waiting })}</span>
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => { setReaderResult(null); setTab('days'); }}>{tr('lx.reader.see')}</button>
          </div>
        </section>
      )}

      {autoResult && autoResult.day === todayStart && !busy && (
        <section className="lx-card lx-auto-result" role="status">
          <button className="lx-auto-close" onClick={() => setAutoResult(null)} aria-label={tr('lx.close')}>✕</button>
          <span className="lx-eyebrow">{tr('lx.auto.eyebrow')}</span>
          <b>{tr('lx.auto.title', { kept: autoResult.kept, added: autoResult.added })}</b>
          <span>{tr(autoResult.waiting ? 'lx.auto.waiting' : 'lx.auto.done', { count: autoResult.waiting })}</span>
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => { setAutoResult(null); setTab('days'); setOpenDay(todayStart); }}>{tr('lx.auto.see')}</button>
            {today && today.waiting.length > 0 && (
              <button className="lx-btn ghost" onClick={() => { setAutoResult(null); openSort(today.waiting.map(p => p.id), tr('lx.sort.today')); }}>{tr('lx.today.check')}</button>
            )}
          </div>
          {premiumLocked && <button className="lx-link lx-trial-link" onClick={() => gatePremium('acceptAll')}>{tr('lx.trial.cta')}</button>}
        </section>
      )}

      {today && today.kept.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-head">
            <h2>{tr('lx.today.picks')}</h2>
            <button className="lx-link" onClick={() => { setTab('days'); setOpenDay(todayStart); }}>{tr('lx.seeDay')}</button>
          </div>
          <div className="lx-picks" role="list">
            {today.kept.map((p, i) => (
              <button key={p.id} role="listitem" className="lx-pick" style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => useLx.getState().openViewer(today.kept.map(k => k.id), i)}>
                <Thumb id={p.id} lqip={p.lqip} edits={p.edits} className="lx-pick-img" />
                <span className="lx-pick-score">{p.aiScore}</span>
                <span className="lx-pick-why">
                  {reasonsFor(p).filter(r => r.tone === 'good').slice(0, 1).map(r => tr(r.key))[0] ?? tr('lx.reason.best')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {today && today.waiting.length > 0 && !busy && (
        <section className="lx-card lx-decide">
          <div>
            <b>{tr(plural(today.waiting.length, 'lx.today.unsure.one', 'lx.today.unsure'), { count: today.waiting.length })}</b>
            <span>{tr('lx.today.unsureSub', { seconds: Math.max(10, today.waiting.length * 4) })}</span>
          </div>
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => openSort(today.waiting.map(p => p.id), tr('lx.sort.today'))}>{tr('lx.today.check')}</button>
            <button className="lx-btn ghost" onClick={() => void acceptDayPicks(today.waiting.filter(p => p.status === 'review').map(p => p.id))}>
              {tr('lx.today.acceptAll')}{premiumLocked && <b className="lx-pro">PRO</b>}
            </button>
          </div>
        </section>
      )}

      {today && (today.series.length > 0 || today.aside.length > 0 || today.rejected.length > 0) && (
        <section className="lx-stats">
          <div><b>{today.series.length}</b><span>{tr('lx.stat.series')}</span></div>
          <div><b>{today.rejected.length}</b><span>{tr('lx.stat.notToday')}</span></div>
          <div><b>{today.aside.length}</b><span>{tr('lx.stat.aside')}</span></div>
        </section>
      )}

      {today && <DayStory photos={today.photos} />}
      <Recaps />
      <OnThisDay />

      <GalleryStatus />
      <CleanupCard photos={photos} compact />

      <FreedCard />

      <button className="lx-card lx-ai-mini" onClick={() => setTab('brain')}>
        <Orb mood="learn" size={44} />
        <div>
          <b>{tr('lx.brain.title')}</b>
          <span>{twin.percent !== null ? tr('lx.twin.percent', { percent: twin.percent }) : score.total > 0 ? tr('lx.brain.miniScore', { hits: score.hits, total: score.total }) : tr('lx.brain.miniTrain')}</span>
        </div>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>

      {past.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-head">
            <h2>{tr('lx.today.past')}</h2>
            <button className="lx-link" onClick={() => setTab('days')}>{tr('lx.all')}</button>
          </div>
          <div className="lx-daylist">
            {past.map(d => (
              <button key={d.start} className="lx-dayrow" onClick={() => { setTab('days'); setOpenDay(d.start); }}>
                <div className="lx-dayrow-thumbs" aria-hidden="true">
                  {(d.kept.length ? d.kept : d.photos).slice(0, 3).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} edits={p.edits} />)}
                </div>
                <div className="lx-dayrow-text">
                  <b>{dayLabel(d.start, locale, 'short')}</b>
                  <span>{daySummary(d, tr)}</span>
                </div>
                {d.waiting.length > 0
                  ? <span className="lx-pill warm">{d.waiting.length}</span>
                  : <span className="lx-pill ok">✓</span>}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** „Galeria ta: 34% sortată” — un rând pe Azi, cu drum spre Galerie → Luni. */
function GalleryStatus() {
  const tr = useTr();
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const setTab = useLx(s => s.setTab);
  const setView = useLx(s => s.setGalleryView);
  const busy = !!progress && progress.phase !== 'finalizat';
  const counts = useGalleryMonths(busy ? -1 : photos.length);
  if (!counts || counts.size === 0) return null;
  const rows = buildCoverage(counts, photos);
  const gallery = rows.reduce((a, r) => a + r.inGallery, 0);
  const sorted = rows.reduce((a, r) => a + r.seen - r.waiting, 0);
  const unsorted = Math.max(0, gallery - sorted);
  const percent = gallery ? Math.round((sorted / gallery) * 100) : 0;
  return (
    <button className="lx-card lx-gallery-status" onClick={() => { setTab('days'); setView('months'); }}>
      <div>
        <b>{unsorted === 0 ? tr('lx.coverage.done') : tr('lx.coverage.title', { percent })}</b>
        <span>{unsorted === 0 ? tr('lx.coverage.doneSub', { total: gallery }) : tr('lx.coverage.sub', { unsorted, total: gallery })}</span>
        <div className="lx-progress small"><i style={{ width: `${percent}%` }} /></div>
      </div>
      <span className="lx-chev" aria-hidden="true">›</span>
    </button>
  );
}

/** „Acum un an”: cele mai bune poze din aceeași zi, din anii trecuți. */
function OnThisDay() {
  const tr = useTr();
  const photos = useStore(s => s.photos);
  const memories = useMemo(() => onThisDay(photos), [photos]);
  if (!memories.length) return null;
  return (
    <>
      {memories.map(m => {
        const title = tr(m.years === 1 ? 'lx.onThisDay' : 'lx.onThisDay.other', { years: m.years });
        return (
          <section key={m.years} className="lx-section">
            <div className="lx-section-head"><h2>{title}</h2></div>
            <div className="lx-memory">
              {m.photos.map(p => (
                <button key={p.id} onClick={() => useLx.getState().openViewer(m.photos.map(x => x.id), m.photos.indexOf(p))}>
                  <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Citirea a fost oprită de om: cât a rămas și butonul care o reia. */
function ReaderStopped() {
  const tr = useTr();
  const [, bump] = useState(0);
  return (
    <section className="lx-card lx-reader" role="status">
      <span className="lx-eyebrow">{tr('lx.reader.eyebrow')}</span>
      <b>{tr('lx.reader.stopped')}</b>
      <div className="lx-reader-actions">
        <button className="lx-btn primary small" onClick={() => { void resumeGalleryReader(); bump(x => x + 1); }}>▶ {tr('lx.reader.resume')}</button>
      </div>
    </section>
  );
}
