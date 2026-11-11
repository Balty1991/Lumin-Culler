import { useEffect, useMemo, useState } from 'react';
import { TrainingCard } from './TrainingCard';
import { useLxPhotos } from './useLxPhotos';
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
import { IsItThem, WhoIsThis } from './WhoIsThis';
import { openBatterySettings, readBatteryRestriction } from '../core/backgroundAnalysis';
import { continueOnLowBattery, continueWithoutTraining, readerStarted, readerStopped, resumeGalleryReader, stopGalleryReader } from './galleryReader';
import { Thumb } from './Thumb';
import { FreedCard } from './TwinParts';
import { readTwin } from './twin';
import { plural } from '../i18n';
import { dayLabel, daySummary } from './format';
import { buildCoverage, useGalleryMonths } from './coverage';
import { CleanupCard } from './Cleanup';
import { onThisDay } from './momentAlbums';
import { StoryButton } from './Story';
import { photoTime } from './days';

/**
 * lumin/TodayScreen.tsx
 * „Azi”: ecranul principal. Sus, AI-ul și ce face acum (citește, analizează,
 * așteaptă). Dedesubt, rezultatul zilei: pozele alese, mari, cu motivul; un
 * singur buton pentru ce mai cere o decizie. Apoi zilele trecute, pe scurt.
 */
import { EnginesIntro } from './EnginesIntro';
import { FilmCreator } from './FilmCreator';
import { RephotoSheet, canRephoto } from './Rephoto';
import { CapsuleCard } from './Capsule';
import { ForgottenCard, MissingCard } from './Insights';
import { BeenHereCard } from './Moments';
import { StudioStrip } from './Studio';
import { VideoToday } from './VideoCleanup';
import { FamilyVote } from './FamilyVote';
import { LivePhotoSheet } from './LivePhoto';
import { livePhotoAvailable } from './livePhoto';
import { Icon } from './icons';
import { burstFilmAvailable } from './burstFilm';
import { ENGINES_READY_EVENT, engineReady, enginesFor, refreshEngines, useEngines } from './engines';
import { useModelsState } from './aiModels';
import { dataMode, enginesWaitWaived, setDataMode, waiveEnginesWait } from './dataMode';
import { isClipPlatform } from '../core/clip/clipEngine';
import { openTasteQuiz } from '../state/tasteQuiz';
import { TodayStories, useStories } from './TodayStories';

export function TodayScreen() {
  const tr = useTr();
  const { pick } = useLxActions();
  const photos = useLxPhotos();
  const progress = useStore(s => s.progress);
  const importing = useStore(s => s.supervisorImporting);
  const locale = useStore(s => s.locale);
  const importToday = useStore(s => s.importToday);
  const premiumLocked = useStore(s => s.premiumLocked);
  const openSort = useLx(s => s.openSort);
  const setTab = useLx(s => s.setTab);
  const setOpenDay = useLx(s => s.setOpenDay);
  const autoResult = useLx(s => s.autoResult);
  const reader = useLx(s => s.reader);
  const readerResult = useLx(s => s.readerResult);
  const setReaderResult = useLx(s => s.setReaderResult);
  const gatePremium = useStore(s => s.gatePremium);
  const setAutoResult = useLx(s => s.setAutoResult);

  const days = useMemo(() => groupDays(photos), [photos]);
  const todayStart = startOfDay();
  const today = days.find(d => d.start === todayStart);
  const past = days.filter(d => d.start < todayStart).slice(0, 4);
  // Cititorul galeriei lucrează în fundal: Azi rămâne Azi, cu o bară mică dedesubt.
  const busy = (!reader || reader.paused === 'import') && (importing || (!!progress && progress.phase !== 'finalizat'));
  const sortingActive = busy || !!(reader && reader.paused !== 'import' && reader.paused !== 'training');

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

  const stories = useStories();
  // Poveștile pe tot ecranul țin locul antetului și al pozei zilei. În timpul unui
  // import cerut de om rămâne ecranul de progres, ca să se vadă ce se întâmplă.
  const showStories = !busy && stories.length > 0;
  const heroShown = useHeroPick() !== null || showStories;
  return (
    <div className="lx-screen lx-today">
      {showStories ? (
        <TodayStories stories={stories} greeting={tr(greetKey())} date={dateLabel}
          streak={streak > 1 ? tr('lx.streak', { count: streak }) : undefined} />
      ) : (
        <header className="lx-head">
          <div className="lx-greet">
            <b>{tr(greetKey())}</b>
            <span className="lx-eyebrow">{dateLabel}</span>
          </div>
          {streak > 1 && <span className="lx-pill warm">{tr('lx.streak', { count: streak })}</span>}
        </header>
      )}

      <EnginesIntro />
      {!busy && !showStories && <DayPhotoHero />}

      {(!showStories || waitingInGallery > 0 || (today && today.photos.length > 0)) && <section className={busy || !heroShown ? 'lx-hero' : 'lx-hero compact'}>
        <Orb mood={busy ? 'think' : 'idle'} size={busy ? 132 : heroShown ? 48 : 112} />
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
            {/* Cu poza zilei deasupra, butonul ei e cel principal: aici unul discret. */}
            <button className={heroShown ? 'lx-btn ghost' : 'lx-btn primary'} onClick={() => void (isNativeMediaLibraryAvailable() ? sortToday() : pick())}>
              {tr(isNativeMediaLibraryAvailable() ? 'lx.today.checkGallery' : 'lx.addPhotos')}
            </button>
          </div>
        )}
      </section>}

      <EnginesWaitCard />
      {reader && reader.paused === 'training' && (
        <section className="lx-card lx-reader lx-train-pause" role="status">
          <span className="lx-eyebrow">{tr('lx.trainPause.eyebrow')}</span>
          <b>{tr('lx.trainPause.title', { count: reader.done })}</b>
          <span>{tr('lx.trainPause.sub', { left: reader.total - reader.done })}</span>
          <div className="lx-train-pause-actions">
            <button className="lx-btn primary" onClick={openTasteQuiz}>{tr('lx.brain.train')}</button>
            <button className="lx-btn ghost small" onClick={continueWithoutTraining}>{tr('lx.trainPause.skip')}</button>
          </div>
        </section>
      )}
      {reader && reader.paused !== 'import' && reader.paused !== 'training' && (
        <section className="lx-card lx-reader compact" role="status">
          {/* Compact (raportat: „aici se mai poate economisi spațiu”): titlul și „Oprește” pe un rând. */}
          <div className="lx-reader-head">
            <div>
              <span className="lx-eyebrow">{tr('lx.reader.eyebrow')}</span>
              <b>{tr(reader.paused === 'battery' ? 'lx.reader.paused' : 'lx.reader.title', { done: reader.done, total: reader.total })}</b>
            </div>
            {reader.paused === 'battery' && <button className="lx-btn ghost small" onClick={continueOnLowBattery}>{tr('lx.reader.continue')}</button>}
            <button className="lx-btn ghost small" onClick={stopGalleryReader}>■ {tr('lx.reader.stop')}</button>
          </div>
          <div className="lx-progress small"><i style={{ width: `${reader.total ? Math.round((reader.done / reader.total) * 100) : 0}%` }} /></div>
          <span>{tr('lx.reader.sub')}</span>
          {!reader.paused && reader.total - reader.done > 200 && <span className="lx-reader-fast">{reader.fast ? `⚡ ${tr('lx.reader.fast')}` : tr('lx.reader.fastTip')}</span>}
          <BatteryHint />
        </section>
      )}
      {!reader && readerStopped() && readerStarted() && <ReaderStopped />}
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
            <button className="lx-btn ghost" onClick={() => void (async () => {
              const ids = today.waiting.filter(p => p.status === 'review').map(p => p.id);
              const st = useStore.getState();
              if (st.premiumLocked) { st.gatePremium('acceptAll'); return; }
              if (!ids.length) { st.setNotice(tr('lx.today.acceptAll.empty')); return; }
              const ok = await st.askConfirm(tr('lx.today.acceptAll.confirm', { count: ids.length }), { confirmLabel: tr('lx.today.acceptAll') });
              if (ok) await st.acceptDayPicks(ids);
            })()}>
              {tr('lx.today.acceptAll')}{premiumLocked && <b className="lx-pro">PRO</b>}
            </button>
          </div>
        </section>
      )}

      {!sortingActive && <TrainingCard />}

      {today && (today.series.length > 0 || today.aside.length > 0 || today.rejected.length > 0) && (
        <section className="lx-stats">
          <div><b>{today.series.length}</b><span>{tr(plural(today.series.length, 'lx.stat.series.one', 'lx.stat.series'))}</span></div>
          <div><b>{today.rejected.length}</b><span>{tr('lx.stat.notToday')}</span></div>
          <div><b>{today.aside.length}</b><span>{tr('lx.stat.aside')}</span></div>
        </section>
      )}

      {!sortingActive && (
        <>
          <WhoIsThis />
          <IsItThem />
          <LumiFeed />
        </>
      )}
      <StudioStrip />
      <WeekVote />
      <BeenHereCard />
      <CapsuleCard />
      <ForgottenCard />
      <MissingCard />
      <OnThisDay heroCoversFirst={!busy} />

      {/* Galeria ta: starea sortării, curățenia și AI-ul, grupate într-un singur bloc. */}
      <section className="lx-section">
        <div className="lx-section-head"><h2>{tr('lx.today.galleryGroup')}</h2></div>
        <div className="lx-today-group">
        <GalleryStatus />
        <CleanupCard photos={photos} compact />
        <VideoToday />

        <FreedCard />

        <button className="lx-card lx-ai-mini" onClick={() => setTab('brain')}>
          <Orb mood="learn" size={44} />
          <div>
            <b>{tr('lx.brain.title')}</b>
            <span>{twin.percent !== null ? tr('lx.twin.percent', { percent: twin.percent }) : score.total > 0 ? tr('lx.brain.miniScore', { hits: score.hits, total: score.total }) : tr('lx.brain.miniTrain')}</span>
          </div>
          <span className="lx-chev" aria-hidden="true">›</span>
        </button>
        </div>
      </section>

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
  const photos = useLxPhotos();
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
function OnThisDay({ heroCoversFirst }: { heroCoversFirst: boolean }) {
  const tr = useTr();
  const photos = useLxPhotos();
  const memories = useMemo(() => onThisDay(photos), [photos]);
  // „Acum un an”, ca mini-film: creatorul se deschide cu pozele amintirii (trecere lină, muzică).
  const [filmFor, setFilmFor] = useState<string[] | null>(null);
  const [redo, setRedo] = useState<{ id: string; at?: number } | null>(null);
  if (!memories.length) return null;
  return (
    <>
      {filmFor && <FilmCreator startId={filmFor[0]} initialIds={filmFor} initialTransition="fade" onClose={() => setFilmFor(null)} />}
      {redo && <RephotoSheet photoId={redo.id} takenAt={redo.at} onClose={() => setRedo(null)} />}
      {memories.map((m, i) => {
        const title = tr(m.years === 1 ? 'lx.onThisDay' : 'lx.onThisDay.other', { years: m.years });
        const best = m.photos[0];
        const showRedo = canRephoto() && !!best && !(heroCoversFirst && i === 0);
        return (
          <section key={m.years} className="lx-section">
            <div className="lx-section-head"><h2>{title}</h2>
              <span className="lx-memory-actions">
                {showRedo && (
                  <button className="lx-link lx-memory-film" onClick={() => setRedo({ id: best.id, at: best.capturedAt })}>
                    {tr('lx.rephoto.title')}
                  </button>
                )}
                {burstFilmAvailable() && m.photos.length >= 2 && <button className="lx-link lx-memory-film" onClick={() => setFilmFor(m.photos.map(p => p.id))}><Icon name="film" size={16} /> {tr('lx.onThisDay.film')}</button>}
              </span>
            </div>
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

/** Cea mai mare rafală din ultimele 7 zile: votul trece telefonul din mână în mână. */
function WeekVote() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [open, setOpen] = useState(false);
  const series = useMemo(() => {
    const week = Date.now() - 7 * 86_400_000;
    const groups = new Map<string, typeof photos>();
    for (const p of photos) {
      if (!p.groupId || p.aside || photoTime(p) < week) continue;
      const g = groups.get(p.groupId);
      if (g) g.push(p); else groups.set(p.groupId, [p]);
    }
    return [...groups.values()].filter(g => g.length >= 3).sort((a, b) => b.length - a.length)[0];
  }, [photos]);
  if (!series) return null;
  return (
    <>
      <button className="lx-card lx-gallery-status" onClick={() => setOpen(true)}>
        <div>
          <b>{tr('lx.vote.week')}</b>
          <span>{tr('lx.vote.weekSub', { count: series.length })}</span>
        </div>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>
      {open && <FamilyVote ids={series.map(p => p.id)} onClose={() => setOpen(false)} />}
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

/** Economia de baterie oprește analiza când ieși din aplicație: un rând care duce la setare. */
function BatteryHint() {
  const tr = useTr();
  const [restricted, setRestricted] = useState(false);
  useEffect(() => {
    let alive = true;
    void readBatteryRestriction().then(b => { if (alive) setRestricted(b === 'restricted'); });
    return () => { alive = false; };
  }, []);
  if (!restricted) return null;
  return <button className="lx-link" onClick={() => void openBatterySettings()}>⚡ {tr('lx.reader.battery')}</button>;
}

/**
 * Poza zilei (redesign, varianta „Amintirea zilei”): o amintire de acum N ani,
 * altfel cea mai frumoasă poză păstrată din ultima săptămână — pe tot cardul,
 * cu „Vezi” și „Film”. Ecranul începe cu o poză, nu cu un cerc.
 */
function useHeroPick(): { photos: ReturnType<typeof useLxPhotos>; title: string; badgeKey: string; years?: number } | null {
  const photos = useLxPhotos();
  const locale = useStore(st => st.locale);
  return useMemo(() => {
    const mem = onThisDay(photos)[0];
    if (mem && mem.photos.length) return { photos: mem.photos, title: dayLabel(photoTime(mem.photos[0]), locale), badgeKey: mem.years === 1 ? 'lx.onThisDay' : 'lx.onThisDay.other', years: mem.years };
    const weekAgo = Date.now() - 7 * 86_400_000;
    const kept = photos.filter(p => p.status === 'selected' && !p.aside && photoTime(p) >= weekAgo);
    const score = (p: (typeof photos)[number]) => (p.aesthetic ?? p.aiScore / 12) + (p.personNames?.length ? 0.6 : 0);
    if (kept.length >= 2) {
      const best = [...kept].sort((a, b) => score(b) - score(a));
      return { photos: best.slice(0, 12), title: dayLabel(photoTime(best[0]), locale), badgeKey: 'lx.hero.weekBest' };
    }
    // Nicio amintire și nimic nou săptămâna asta: ecranul tot începe cu o poză, nu cu un
    // cerc gol. Una dintre cele mai frumoase 30 păstrate, alta în fiecare zi, cu ziua ei.
    const all = photos.filter(p => p.status === 'selected' && !p.aside);
    if (all.length < 3) return null;
    const top = [...all].sort((a, b) => score(b) - score(a)).slice(0, 30);
    const star = top[Math.floor(Date.now() / 86_400_000) % top.length];
    const day = startOfDay(photoTime(star));
    const sameDay = all.filter(p => p.id !== star.id && startOfDay(photoTime(p)) === day).sort((a, b) => score(b) - score(a));
    return { photos: [star, ...sameDay].slice(0, 12), title: dayLabel(photoTime(star), locale), badgeKey: 'lx.hero.fromGallery' };
  }, [photos, locale]);
}

function DayPhotoHero() {
  const tr = useTr();
  const pick = useHeroPick();
  const [redo, setRedo] = useState(false);
  const [live, setLive] = useState(false);
  if (!pick) return null;
  const hero = pick.photos[0];
  const ids = pick.photos.map(p => p.id);
  const canRedo = pick.years !== undefined && canRephoto();
  const canLive = livePhotoAvailable() && !!hero.mediaUri;
  return (
    <section className="lx-day-hero">
      {redo && <RephotoSheet photoId={hero.id} takenAt={hero.capturedAt} onClose={() => setRedo(false)} />}
      {live && <LivePhotoSheet photoId={hero.id} onClose={() => setLive(false)} />}
      <button className="lx-hero-tile in" onClick={() => useLx.getState().openViewer(ids, 0)} aria-label={pick.title}>
        <span className="lx-hero-media"><Thumb id={hero.id} lqip={hero.lqip} edits={hero.edits} full /></span>
        <span className="lx-hero-shade" />
        <span className="lx-hero-caption">
          <span className="lx-hero-badge">{tr(pick.badgeKey, { years: pick.years ?? 1 })}</span>
          <b>{pick.title}</b>
          <span>{tr('lx.hero.count', { count: pick.photos.length })}</span>
        </span>
        {/* Încă trei poze ale zilei, suprapuse în colț: se vede că e o colecție, nu o poză. */}
        {pick.photos.length > 1 && (
          <span className="lx-hero-stack" aria-hidden="true">
            {pick.photos.slice(1, 4).map(ph => <span key={ph.id} className="lx-hero-stack-item"><Thumb id={ph.id} lqip={ph.lqip} edits={ph.edits} /></span>)}
            {pick.photos.length > 4 && <span className="lx-hero-stack-more">+{pick.photos.length - 4}</span>}
          </span>
        )}
      </button>
      <div className="lx-day-hero-actions">
        <button className="lx-btn primary" onClick={() => useLx.getState().openViewer(ids, 0)}>{tr('lx.hero.open')}</button>
        {canLive && <button className="lx-btn ghost" onClick={() => setLive(true)}>{tr('lx.live.title')}</button>}
        {canRedo && <button className="lx-btn ghost" onClick={() => setRedo(true)}>{tr('lx.rephoto.title')}</button>}
        <StoryButton className="lx-btn ghost" ids={ids.slice(0, 12)} title={pick.title} subtitle={tr('lx.hero.count', { count: pick.photos.length })} />
      </div>
    </section>
  );
}

/**
 * Între alegerea din fereastra de după instalare și pornirea citirii: motoarele AI se
 * descarcă, iar Azi spune asta (altfel ecranul părea că nu face nimic câteva minute).
 * Dacă descărcarea nu reușește, omul poate reîncerca sau porni fără ele.
 */
function EnginesWaitCard() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const reader = useLx(s => s.reader);
  const engines = useEngines();
  const models = useModelsState();
  const [, bump] = useState(0);
  useEffect(() => { void refreshEngines(); }, []);
  if (!isClipPlatform() || reader || dataMode() === null || enginesWaitWaived() || !readerStarted() || readerStopped()) return null;
  const list = enginesFor(locale);
  const ready = list.filter(e => engineReady(e, engines.have)).length;
  if (!Object.keys(engines.have).length || ready >= list.length) return null;
  const stuck = !engines.busy && (models.phase === 'error' || models.phase === 'metered');
  const pct = Math.round(((ready + (engines.busy ? Math.min(1, Math.max(0, engines.progress || 0)) : 0)) / list.length) * 100);
  const retry = (any: boolean) => { if (any) setDataMode('any'); void import('./clipBackfill').then(m => m.startClipBackfill(any || undefined)); bump(n => n + 1); };
  const go = () => { waiveEnginesWait(); window.dispatchEvent(new Event(ENGINES_READY_EVENT)); bump(n => n + 1); };
  return (
    <section className="lx-card lx-reader compact" role="status">
      <span className="lx-eyebrow">{tr('lx.enginesWait.eyebrow')}</span>
      <b>{tr(stuck ? (models.phase === 'metered' ? 'lx.enginesWait.metered' : 'lx.enginesWait.error') : 'lx.enginesWait.title', { done: ready, total: list.length })}</b>
      <div className="lx-progress small"><i style={{ width: `${pct}%` }} /></div>
      <span>{tr('lx.enginesWait.sub')}</span>
      {stuck && (
        <div className="lx-train-pause-actions">
          <button className="lx-btn primary small" onClick={() => retry(models.phase === 'metered')}>{tr(models.phase === 'metered' ? 'lx.enginesWait.useData' : 'lx.enginesWait.retry')}</button>
          <button className="lx-btn ghost small" onClick={go}>{tr('lx.enginesWait.skip')}</button>
        </div>
      )}
    </section>
  );
}

/** Salutul după oră: Azi vorbește ca un om, nu ca un tabel. */
function greetKey(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? 'lx.greet.night' : h < 12 ? 'lx.greet.morning' : h < 18 ? 'lx.greet.day' : 'lx.greet.evening';
}
