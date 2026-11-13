import { buildMorningReport, markMorningSeen, morningSeen } from './morningReport';
import { useReaderYielding } from './readerYield';
import { SampleResultCard } from './SampleFlow';
import { storedSampleResult } from './galleryReader';
import { claimPaywall, setPaywallContext, trialDaysLeft } from './paywallMoment';
import { formatBytes } from '../core/freedSpace';
import { listPhotosInRange, readGalleryDateRange, readGalleryOverview, readPhotoFiles } from '../core/nativeMediaLibrary';
import { useEffect, useMemo, useState } from 'react';
import { TrainingCard } from './TrainingCard';
import { useLxPhotos } from './useLxPhotos';
import { todayMissingCount, useStore } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { startOfDay } from '../core/todayDigest';
import { readRitualDays, streakOf } from '../core/ritualStreak';
import { readTasteScore } from '../core/tasteScore';
import { groupDays } from './days';
import { reasonsFor } from './reasons';
import { useLx } from './lxStore';
import { useLxActions, useTr } from './context';
import { Orb } from './Orb';
import { LumiFeed, seriesExtras } from './LumiFeed';
import { IsItThem, WhoIsThis } from './WhoIsThis';
import { openBatterySettings, readBatteryRestriction } from '../core/backgroundAnalysis';
import { continueOnLowBattery, continueWithoutTraining, readerStarted, readerStopped, resumeGalleryReader, stopGalleryReader } from './galleryReader';
import { Thumb } from './Thumb';
import { readTwin } from './twin';
import { plural } from '../i18n';
import { dayLabel, daySummary } from './format';
import { buildCoverage, useGalleryMonths } from './coverage';
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
import { minuteBatch } from './minuteBatch';
import { isBeginner } from './beginner';
import { FilmCreator } from './FilmCreator';
import { RephotoSheet, canRephoto } from './Rephoto';
import { CapsuleCard } from './Capsule';
import { ForgottenCard, MissingCard } from './Insights';
import { BeenHereCard } from './Moments';
import { StudioStrip } from './Studio';
import { FamilyVote } from './FamilyVote';
import { LivePhotoSheet } from './LivePhoto';
import { livePhotoAvailable } from './livePhoto';
import { Icon } from './icons';
import { burstFilmAvailable } from './burstFilm';
import { ENGINES_READY_EVENT, engineReady, enginesFor, refreshEngines, useEngines, ESSENTIAL_ENGINES } from './engines';
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
  const sampling = useLx(s => s.sampling);
  const readerYielding = useReaderYielding(!!reader);
  // Cât stă pe ecran rezultatul primei priviri, el e singurul pas: restul cardurilor spuneau
  // același lucru în alte cuvinte (raportat cu video: „ecranul de acasă e prea încărcat”).
  const liveSample = useLx(s => s.sampleResult);
  const focusSample = sampling || (!reader && (!!liveSample || !!storedSampleResult()));
  const setReaderResult = useLx(s => s.setReaderResult);
  const gatePremium = useStore(s => s.gatePremium);
  const setAutoResult = useLx(s => s.setAutoResult);

  // Finalul primei citiri: oferta Pro pe cifrele omului (câte poze în plus, cât spațiu).
  const readOffer = useMemo(() => {
    if (!readerResult || !premiumLocked) return null;
    const { sets, extras } = seriesExtras(photos);
    if (extras.length < 5 && readerResult.waiting < 20) return null;
    const size = extras.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);
    const text = extras.length >= 5
      ? tr('lx.reader.offer', { extras: extras.length, sets, size: formatBytes(size, useStore.getState().locale), waiting: readerResult.waiting })
      : tr('lx.reader.offerWaiting', { waiting: readerResult.waiting });
    // Înainte / după, pe pozele omului: cât are acum și cât ar rămâne după curățenie.
    const visible = photos.filter(p => !p.aside);
    const leaving = new Set([...extras.map(p => p.id), ...visible.filter(p => p.status === 'rejected').map(p => p.id)]);
    const before = visible.length;
    const after = Math.max(0, before - leaving.size);
    const sample = extras.slice(0, 5);
    return { text, before, after, sample, size };
  }, [readerResult, premiumLocked, photos, tr]);
  // O singură dată, după prima citire mare: oferta se deschide singură, cu „Nu acum” la vedere.
  useEffect(() => {
    if (!readOffer || !readerResult || reader || readerResult.total < 100) return;
    try { if (localStorage.getItem('cherrypic.readOffer.shown') === '1') return; } catch { return; }
    const timer = window.setTimeout(() => {
      // Cât e începător, oferta stă doar pe card (înainte/după); nu se deschide singură.
      if (!useStore.getState().premiumLocked || isBeginner(useStore.getState().photos) || !claimPaywall()) return;
      try { localStorage.setItem('cherrypic.readOffer.shown', '1'); } catch { /* fără stocare */ }
      setPaywallContext(readOffer.text);
      useStore.getState().gatePremium('acceptAll');
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [readOffer, readerResult, reader]);

  const days = useMemo(() => groupDays(photos), [photos]);
  const todayStart = startOfDay();
  const today = days.find(d => d.start === todayStart);
  const past = days.filter(d => d.start < todayStart).slice(0, 4);
  // Cititorul galeriei lucrează în fundal: Azi rămâne Azi, cu o bară mică dedesubt.
  const busy = (!reader || reader.paused === 'import') && (importing || (!!progress && progress.phase !== 'finalizat'));
  // „Un minut azi”: 10 poze vechi nehotărâte pe zi, ca galeria să nu se mai adune.
  const minute = useMemo(() => minuteBatch(photos), [photos]);
  // Modul de început: doar esențialul până la primele decizii (vezi beginner.ts).
  const beginner = useMemo(() => isBeginner(photos), [photos]);
  const sortingActive = busy || !!(reader && reader.paused !== 'import' && reader.paused !== 'training');

  const [inGallery, setInGallery] = useState<number | null>(null);
  useEffect(() => {
    if (!isNativeMediaLibraryAvailable() || busy) return;
    let alive = true;
    void todayMissingCount().then(n => { if (alive && n !== null) setInGallery(n); }).catch(() => {});
    return () => { alive = false; };
  }, [busy, photos.length, todayStart]);

  // Doar pozele de azi pe care aplicația chiar nu le are (vezi todayMissingCount).
  const waitingInGallery = inGallery ?? 0;
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
        ) : today && today.photos.length > 0 && today.photos.length === today.aside.length ? (
          // Azi doar capturi de ecran/documente: „Din 27 de poze, am ales 0” părea o greșeală
          // (raportat cu captură). Spus pe față, cu unde stau.
          <div className="lx-hero-text">
            <h1 className="lx-h1">{tr('lx.today.onlyAside', { count: today.aside.length })}</h1>
            <p className="lx-sub">{tr('lx.today.onlyAsideSub')}</p>
          </div>
        ) : today && today.photos.length > 0 ? (
          <div className="lx-hero-text">
            <h1 className="lx-h1">
              {tr(plural(today.photos.length - today.aside.length, 'lx.today.from.one', 'lx.today.from'), { count: today.photos.length - today.aside.length })}{' '}
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

      <TrialEndCard />
      {/* Redesign (video 13 nov.: 6–7 carduri care spuneau același lucru): câte unul, pe rând.
          Raportul de dimineață doar dimineața și nu peste rezultatul citirii. */}
      {!sortingActive && !focusSample && !readerResult && new Date().getHours() < 12 && <MorningReportCard />}
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
              <b>{tr(reader.paused === 'battery' ? 'lx.reader.paused' : reader.paused === 'charging' ? 'lx.reader.waitCharge' : sampling ? 'lx.sample.reading' : 'lx.reader.title', { done: reader.done, total: reader.total })}</b>
            </div>
            {reader.paused === 'battery' && <button className="lx-btn ghost small" onClick={continueOnLowBattery}>{tr('lx.reader.continue')}</button>}
            <button className="lx-btn ghost small" onClick={stopGalleryReader}>■ {tr('lx.reader.stop')}</button>
          </div>
          <div className="lx-progress small"><i style={{ width: `${reader.total ? Math.round((reader.done / reader.total) * 100) : 0}%` }} /></div>
          <span>{tr(sampling ? 'lx.sample.readingSub' : readerYielding && !reader.paused ? 'lx.reader.pausedUser' : 'lx.reader.sub')}</span>
          {!sampling && !reader.paused && <button className="lx-btn ghost small" onClick={() => useLx.getState().setWorkMode(true)}>⚡ {tr('lx.work.open')}</button>}
          {!reader.paused && reader.total - reader.done > 200 && <span className="lx-reader-fast">{reader.fast ? `⚡ ${tr('lx.reader.fast')}` : tr('lx.reader.fastTip')}</span>}
          <BatteryHint />
        </section>
      )}
      {!reader && readerStopped() && readerStarted() && <ReaderStopped />}
      <SampleResultCard />
      {readerResult && !reader && (
        <section className="lx-card lx-auto-result" role="status">
          <button className="lx-auto-close" onClick={() => setReaderResult(null)} aria-label={tr('lx.close')}>✕</button>
          <span className="lx-eyebrow">{tr('lx.reader.eyebrow')}</span>
          <b>{tr('lx.reader.doneTitle', { total: readerResult.total })}</b>
          <span>{tr('lx.reader.doneSub', { kept: readerResult.kept, waiting: readerResult.waiting })}</span>
          {readOffer && <span className="lx-read-offer">{readOffer.text}</span>}
          {readOffer && readOffer.before > readOffer.after && (
            <div className="lx-ba" aria-label={tr('lx.reader.baLabel', { before: readOffer.before, after: readOffer.after })}>
              <div className="lx-ba-row"><span>{tr('lx.reader.baNow')}</span><i style={{ width: '100%' }} /><b>{readOffer.before}</b></div>
              <div className="lx-ba-row clean"><span>{tr('lx.reader.baClean')}</span><i style={{ width: `${Math.max(8, Math.round((readOffer.after / readOffer.before) * 100))}%` }} /><b>{readOffer.after}</b></div>
              {readOffer.sample.length > 0 && (
                <div className="lx-ba-strip">
                  {readOffer.sample.map(p => <span key={p.id}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /><em aria-hidden="true">✕</em></span>)}
                  {readOffer.size > 0 && <small>{tr('lx.reader.baFree', { size: formatBytes(readOffer.size, useStore.getState().locale) })}</small>}
                </div>
              )}
            </div>
          )}
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => { setReaderResult(null); setTab('days'); }}>{tr('lx.reader.see')}</button>
            {readOffer && <button className="lx-btn ghost" onClick={() => { setPaywallContext(readOffer.text); gatePremium('acceptAll'); }}>{tr('lx.feed.proGo')}</button>}
          </div>
        </section>
      )}

      {/* „Am sortat N poze noi” repeta titlul de sus („Din N poze azi, am ales…”): doar fără el. */}
      {autoResult && autoResult.day === todayStart && !busy && !focusSample && !(today && today.photos.length > 0) && (
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

      {(!today || today.waiting.length === 0) && !busy && minute.ids.length >= 5 && (
        <section className="lx-card lx-decide lx-minute">
          <div>
            <b>⏱ {tr('lx.minute.title')}</b>
            <span>{tr('lx.minute.sub', { count: minute.ids.length, left: minute.left })}</span>
          </div>
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => openSort(minute.ids, tr('lx.minute.title'))}>{tr('lx.minute.go')}</button>
          </div>
        </section>
      )}

      {today && today.waiting.length > 0 && !busy && !focusSample && (
        <section className="lx-card lx-decide">
          <div>
            <b>{tr(plural(today.waiting.length, 'lx.today.unsure.one', 'lx.today.unsure'), { count: today.waiting.length })}</b>
            <span>{today.waiting.length * 4 >= 90
              ? tr('lx.today.unsureSubMin', { minutes: Math.round(today.waiting.length * 4 / 60) })
              : tr('lx.today.unsureSub', { seconds: Math.max(10, today.waiting.length * 4) })}</span>
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

      {/* Antrenamentul doar când nu e deja altceva de făcut aici (citirea, rezultatul, pozele de azi). */}
      {!sortingActive && !focusSample && !reader && !readerResult && !(today && today.waiting.length > 0) && <TrainingCard />}

      {!sortingActive && !beginner && (
        <>
          <WhoIsThis />
          <IsItThem />
          <LumiFeed />
        </>
      )}
      {/* Redesign: Azi scurt — poza zilei, ce te așteaptă, o amintire. Studio are fila lui;
          poza uitată și cifrele zilei stau la „Mai multe”. */}
      {!showStories && !beginner && <OnThisDay heroCoversFirst={!busy} />}

      {/* Galeria ta: starea sortării, curățenia și AI-ul, grupate într-un singur bloc. */}
      {!focusSample && <section className="lx-section">
        <div className="lx-section-head"><h2>{tr('lx.today.galleryGroup')}</h2></div>
        <div className="lx-today-group">
        <GalleryStatus />

        <button className="lx-card lx-ai-mini" onClick={() => setTab('brain')}>
          <Orb mood="learn" size={44} />
          <div>
            <b>{tr('lx.brain.title')}</b>
            <span>{twin.percent !== null ? tr('lx.twin.percent', { percent: twin.percent }) : score.total > 0 ? tr('lx.brain.miniScore', { hits: score.hits, total: score.total }) : tr('lx.brain.miniTrain')}</span>
          </div>
          <span className="lx-chev" aria-hidden="true">›</span>
        </button>
        </div>
      </section>}

      {/* Restul stă strâns: Azi rămâne scurt (cerut de audit: peste 20 de blocuri). */}
      {!beginner && <details className="lx-more">
        <summary>{tr('lx.today.more')}</summary>
        <StudioStrip />
        {!showStories && <ForgottenCard />}
        {!focusSample && today && (today.series.length > 0 || today.aside.length > 0 || today.rejected.length > 0) && (
        <section className="lx-stats">
          <div><b>{today.series.length}</b><span>{tr(plural(today.series.length, 'lx.stat.series.one', 'lx.stat.series'))}</span></div>
          <div><b>{today.rejected.length}</b><span>{tr('lx.stat.notToday')}</span></div>
          <div><b>{today.aside.length}</b><span>{tr('lx.stat.aside')}</span></div>
        </section>
      )}

        <WeekVote />
        <BeenHereCard />
        <CapsuleCard />
        <MissingCard />
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
      </details>}
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
  // Verificat din nou la întoarcerea din Setări: butonul dispare după „Fără restricții”.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void readBatteryRestriction().then(b => setRestricted(b === 'restricted')); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);
  if (!restricted) return null;
  // Un buton adevărat, ca la notificări (cerut), nu un rând de text de urmat.
  return (
    <div className="lx-battery-ask">
      <button className="lx-btn primary small wide" onClick={() => void openBatterySettings()}>⚡ {tr('lx.reader.batteryBtn')}</button>
      <small>{tr('lx.reader.batteryHow')}</small>
    </div>
  );
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
  // Doar cele esențiale (descărcarea în trepte): restul vin în fundal, fără card.
  const list = enginesFor(locale).filter(e => ESSENTIAL_ENGINES.includes(e.id));
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
      <GalleryGlimpse />
      {stuck && (
        <div className="lx-train-pause-actions">
          <button className="lx-btn primary small" onClick={() => retry(models.phase === 'metered')}>{tr(models.phase === 'metered' ? 'lx.enginesWait.useData' : 'lx.enginesWait.retry')}</button>
          <button className="lx-btn ghost small" onClick={go}>{tr('lx.enginesWait.skip')}</button>
        </div>
      )}
    </section>
  );
}

/**
 * Primul minut după instalare: cât se descarcă motoarele, omul vede deja galeria lui —
 * câte poze are, de când, câte a făcut luna asta și ultimele șase. Fără analiză: doar
 * lista galeriei. Tace dacă telefonul nu răspunde sau accesul nu e dat.
 */
function GalleryGlimpse() {
  const tr = useTr();
  const [info, setInfo] = useState<{ total: number; year: number | null; month: number; urls: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void (async () => {
      const now = Date.now();
      const [overview, range, recent] = await Promise.all([readGalleryOverview(), readGalleryDateRange(), listPhotosInRange(now - 30 * 86_400_000, now + 1)]);
      if (!overview.granted || overview.totalCount < 1) return;
      const latest = [...recent.photos].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 6);
      const files = latest.length ? await readPhotoFiles(latest).catch(() => []) : [];
      for (const f of files) made.push(URL.createObjectURL(f.file));
      if (alive) setInfo({ total: overview.totalCount, year: range.earliestMs ? new Date(range.earliestMs).getFullYear() : null, month: recent.photos.length, urls: [...made] });
    })().catch(() => undefined);
    return () => { alive = false; for (const u of made) URL.revokeObjectURL(u); };
  }, []);
  if (!info) return null;
  return (
    <div className="lx-glimpse">
      <b>{tr('lx.glimpse.title', { count: info.total })}</b>
      <span>{[info.year ? tr('lx.glimpse.since', { year: info.year }) : '', info.month > 0 ? tr('lx.glimpse.month', { count: info.month }) : ''].filter(Boolean).join(' ')}</span>
      {info.urls.length > 0 && <div className="lx-glimpse-strip">{info.urls.map(u => <img key={u} src={u} alt="" loading="lazy" decoding="async" />)}</div>}
      <span>{tr('lx.glimpse.next')}</span>
    </div>
  );
}

/**
 * Raportul de dimineață: ce s-a ales din pozele de ieri. Cu Pilotul pornit (Pro), e gata
 * făcut; fără, spune câte au rămas și că Pilotul le poate termina. O dată pe zi.
 */
function MorningReportCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const premiumLocked = useStore(s => s.premiumLocked);
  const [, bump] = useState(0);
  const report = useMemo(() => buildMorningReport(photos), [photos]);
  if (!report || morningSeen(report.day) || (!report.kept.length && !report.waiting.length)) return null;
  const close = () => { markMorningSeen(report.day); bump(n => n + 1); };
  const lx = useLx.getState();
  return (
    <section className="lx-card lx-auto-result lx-morning" role="status">
      <button className="lx-auto-close" onClick={close} aria-label={tr('lx.close')}>✕</button>
      <span className="lx-eyebrow">{tr('lx.morning.eyebrow')}</span>
      <b>{tr('lx.morning.title', { kept: report.kept.length, total: report.total })}</b>
      <span>{[
        report.dropped > 0 ? tr('lx.morning.dropped', { count: report.dropped }) : '',
        report.waiting.length > 0 ? tr('lx.morning.waiting', { count: report.waiting.length }) : tr('lx.morning.allDone')
      ].filter(Boolean).join(' ')}</span>
      {report.kept.length > 0 && (
        <div className="lx-weekly-strip">
          {report.kept.slice(0, 6).map((p, i) => (
            <button key={p.id} className="lx-morning-thumb" onClick={() => lx.openViewer(report.kept.map(x => x.id), i)}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></button>
          ))}
        </div>
      )}
      <div className="lx-decide-actions">
        {report.waiting.length > 0 && <button className="lx-btn primary" onClick={() => { close(); lx.openSort(report.waiting.map(p => p.id), tr('lx.morning.eyebrow')); }}>{tr('lx.morning.check', { count: report.waiting.length })}</button>}
        {report.kept.length > 0 && <button className="lx-btn ghost" onClick={() => lx.openViewer(report.kept.map(p => p.id), 0)}>{tr('lx.morning.see')}</button>}
      </div>
      {premiumLocked && report.waiting.length >= 5 && (
        <button className="lx-link lx-trial-link" onClick={() => { setPaywallContext(tr('lx.morning.offer', { count: report.waiting.length })); useStore.getState().gatePremium('acceptAll'); }}>{tr('lx.morning.pro')}</button>
      )}
    </section>
  );
}

/**
 * Cu două zile înainte de sfârșitul probei: omul află din aplicație când începe plata
 * și de unde anulează. Fără surprize la prima încasare (și mai puține rambursări).
 */
function TrialEndCard() {
  const tr = useTr();
  const premium = useStore(s => s.premium);
  const [hidden, setHidden] = useState(false);
  const left = trialDaysLeft();
  if (!premium || hidden || left === null || left > 2) return null;
  return (
    <section className="lx-card lx-auto-result" role="status">
      <button className="lx-auto-close" onClick={() => setHidden(true)} aria-label={tr('lx.close')}>✕</button>
      <span className="lx-eyebrow">Cherrypic Pro</span>
      <b>{tr(left === 1 ? 'lx.trialEnd.one' : 'lx.trialEnd.title', { count: left })}</b>
      <span>{tr('lx.trialEnd.sub')}</span>
      <div className="lx-decide-actions">
        <a className="lx-btn ghost" href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noreferrer">{tr('lx.trialEnd.manage')}</a>
      </div>
    </section>
  );
}

/** Salutul după oră: Azi vorbește ca un om, nu ca un tabel. */
function greetKey(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? 'lx.greet.night' : h < 12 ? 'lx.greet.morning' : h < 18 ? 'lx.greet.day' : 'lx.greet.evening';
}
