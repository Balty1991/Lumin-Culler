import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { openStoreListing } from '../../core/storeListing';
import {
  INTRO_KEY,
  LOCALE_KEY,
  readBoot,
  readRescueLocale,
  type BootState,
  type ScreenId
} from '../../rescue/boot';
import { rescueT, type RescueLocale } from '../../rescue/copy';
import { effortCount, formatBytes } from '../../rescue/format';
import { pileKey } from '../../rescue/labels';
import {
  demoPiles,
  effortSeconds,
  holdOf,
  selectionOf,
  suggestedChecked,
  type HeldFile,
  type Pile,
  type PileId
} from '../../rescue/model';
import { scanFrames, streamDemoScan, type ScanFrame } from '../../rescue/scan';
import { BackButton, Brand, SizeHeading } from './chrome';
import LaterScreens from './LaterScreens';
import './rescue.css';

const SettingsScreens = lazy(() => import('./SettingsScreens'));

function languages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function RescueApp({ boot: bootOverride }: { boot?: BootState } = {}) {
  const [boot] = useState(() => bootOverride ?? readBoot(
    typeof window === 'undefined' ? '' : window.location.search,
    localStorage.getItem(INTRO_KEY) === '1'
  ));
  const [locale, setLocale] = useState<RescueLocale>(() => readRescueLocale(localStorage.getItem(LOCALE_KEY), languages()));
  const [screen, setScreen] = useState<ScreenId>(boot.screen);
  const [liveScan, setLiveScan] = useState(boot.liveScan);
  const [piles, setPiles] = useState<Pile[]>(() => initialPiles(boot.screen, boot.liveScan));
  const [scan, setScan] = useState(() => initialScan(boot.screen, boot.liveScan));
  const [checked, setChecked] = useState<Set<string>>(() => initialChecked(boot.screen));
  const [trashed, setTrashed] = useState<HeldFile[]>(() => boot.screen === 'trash' ? seeded() : []);
  const [freed, setFreed] = useState<HeldFile[]>(() => boot.screen === 'freed' ? seeded() : []);
  const [batch, setBatch] = useState<HeldFile[]>(() => boot.screen === 'freed' ? seeded() : []);
  const [pileId, setPileId] = useState<PileId>('videos');

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    if (screen !== 'scan' || !liveScan) return;
    let cancel = false;
    void streamDemoScan(frame => {
      if (cancel) return;
      setScan(frame);
      setPiles(frame.piles);
    }, undefined, () => cancel).then(final => {
      if (cancel || !final) return;
      setPiles(final);
      setChecked(suggestedChecked(final));
      setScreen('home');
    });
    return () => { cancel = true; };
  }, [screen, liveScan]);

  const aside = useMemo(() => new Set([...trashed, ...freed].map(file => file.id)), [trashed, freed]);
  const selectedBytes = useMemo(
    () => piles.reduce((sum, pile) => sum + selectionOf(pile.items, checked, aside).bytes, 0),
    [piles, checked, aside]
  );

  const chooseLocale = (next: RescueLocale) => {
    try { localStorage.setItem(LOCALE_KEY, next); } catch { /* session only */ }
    setLocale(next);
  };

  const startScan = () => {
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* session only */ }
    setPiles([]);
    setScan({ done: 0, total: scanFrames().length, bytes: 0, current: 'videos', piles: [] });
    setScreen('scan');
    setLiveScan(true);
  };

  const onOpen = useCallback((next: ScreenId) => { setScreen(next); }, []);
  const onBack = useCallback(() => {
    setScreen(current => {
      if (current === 'swipe') return 'review';
      if (current === 'paywall') return 'settings';
      if (current === 'intro2') return 'intro1';
      if (current === 'intro3') return 'intro2';
      return 'home';
    });
  }, []);
  const onToggle = useCallback((id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const onReset = useCallback(() => {
    setChecked(prev => {
      const next = new Set(prev);
      const pile = piles.find(item => item.id === pileId);
      if (!pile) return next;
      for (const item of pile.items) {
        if (aside.has(item.id)) continue;
        if (item.suggested) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }, [piles, pileId, aside]);
  const onMove = useCallback(() => {
    const pile = piles.find(item => item.id === pileId);
    if (!pile) return;
    const moving = pile.items.filter(item => checked.has(item.id) && !aside.has(item.id));
    if (moving.length === 0) return;
    setTrashed(prev => [...prev, ...moving.map(({ id, name, bytes }) => ({ id, name, bytes }))]);
    setScreen('trash');
  }, [piles, pileId, checked, aside]);
  const onTrash = useCallback((file: HeldFile) => {
    setTrashed(prev => prev.some(item => item.id === file.id) ? prev : [...prev, file]);
  }, []);
  const onKeep = useCallback((id: string) => {
    setChecked(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const onSwipeEmpty = useCallback((moved: boolean) => {
    setScreen(moved ? 'trash' : 'review');
  }, []);
  const onUndo = useCallback(() => {
    setChecked(prev => {
      const next = new Set(prev);
      for (const file of trashed) next.add(file.id);
      return next;
    });
    setTrashed([]);
    setScreen('home');
  }, [trashed]);
  const onFree = useCallback(() => {
    setBatch(trashed);
    setFreed(prev => [...prev, ...trashed]);
    setTrashed([]);
    setScreen('freed');
  }, [trashed]);

  const showNav = screen !== 'scan' && !screen.startsWith('intro');
  const nav = screen === 'settings' || screen === 'paywall' ? 'settings' : 'home';
  const freedBytes = freed.reduce((sum, file) => sum + file.bytes, 0);

  return (
    <div className="rescue" data-screen={screen}>
      <div className="rescue-frame">
        <main className="rescue-main">
          {screen === 'intro1' || screen === 'intro2' || screen === 'intro3' ? (
            <Intro
              locale={locale}
              screen={screen}
              onNext={() => setScreen(screen === 'intro1' ? 'intro2' : 'intro3')}
              onBack={onBack}
              onScan={startScan}
            />
          ) : null}
          {screen === 'scan' ? <ScanView locale={locale} frame={scan} piles={piles} /> : null}
          {screen === 'home' ? (
            <Home
              locale={locale}
              piles={piles}
              checked={checked}
              aside={aside}
              selectedBytes={selectedBytes}
              trashedBytes={trashed.reduce((sum, file) => sum + file.bytes, 0)}
              freedBytes={freedBytes}
              onOpenPile={id => { setPileId(id); setScreen('review'); }}
              onTrash={() => setScreen('trash')}
            />
          ) : null}
          {screen === 'review' || screen === 'swipe' || screen === 'trash' || screen === 'freed' ? (
            <LaterScreens
              screen={screen}
              locale={locale}
              piles={piles}
              pileId={pileId}
              checked={checked}
              aside={aside}
              trashed={trashed}
              batch={batch}
              onBack={onBack}
              onOpen={onOpen}
              onToggle={onToggle}
              onReset={onReset}
              onMove={onMove}
              onTrash={onTrash}
              onKeep={onKeep}
              onSwipeEmpty={onSwipeEmpty}
              onUndo={onUndo}
              onFree={onFree}
            />
          ) : null}
          {screen === 'settings' || screen === 'paywall' ? (
            <Suspense fallback={null}>
              <SettingsScreens
                screen={screen}
                locale={locale}
                reclaimable={selectedBytes || scan.bytes}
                onBack={onBack}
                onOpen={onOpen}
                onLocale={chooseLocale}
              />
            </Suspense>
          ) : null}
        </main>
        {showNav ? (
          <nav className="rescue-nav" aria-label={rescueT(locale, 'navHome')}>
            <button type="button" aria-current={nav === 'home' ? 'page' : undefined} onClick={() => setScreen('home')}>
              {rescueT(locale, 'navHome')}
            </button>
            <button type="button" aria-current={nav === 'settings' ? 'page' : undefined} onClick={() => setScreen('settings')}>
              {rescueT(locale, 'navSettings')}
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function seeded(): HeldFile[] {
  return holdOf(demoPiles().find(pile => pile.id === 'videos')?.items ?? []);
}

function initialPiles(screen: ScreenId, liveScan: boolean): Pile[] {
  if (screen.startsWith('intro')) return [];
  if (screen === 'scan') return liveScan ? [] : (scanFrames()[1]?.piles ?? []);
  return demoPiles();
}

function initialScan(screen: ScreenId, liveScan: boolean): ScanFrame {
  const frames = scanFrames();
  const last = frames[frames.length - 1];
  if (screen === 'scan' && liveScan) {
    return { done: 0, total: frames.length, bytes: 0, current: 'videos', piles: [] };
  }
  if (screen === 'scan') return frames[1] ?? last;
  return last;
}

function initialChecked(screen: ScreenId): Set<string> {
  if (screen.startsWith('intro') || screen === 'scan') return new Set();
  return suggestedChecked(demoPiles());
}

function Intro(props: {
  locale: RescueLocale;
  screen: 'intro1' | 'intro2' | 'intro3';
  onNext: () => void;
  onBack: () => void;
  onScan: () => void;
}) {
  const { locale, screen } = props;
  const index = screen === 'intro1' ? 1 : screen === 'intro2' ? 2 : 3;
  return (
    <>
      <Brand />
      <p className="rescue-muted">{rescueT(locale, 'step', { index, count: 3 })}</p>
      {screen === 'intro1' ? <h1 className="rescue-vp">{rescueT(locale, 'vp')}</h1> : null}
      {screen === 'intro2' ? (
        <>
          <h1>{rescueT(locale, 'howTitle')}</h1>
          <p>{rescueT(locale, 'howBody')}</p>
        </>
      ) : null}
      {screen === 'intro3' ? (
        <>
          <h1>{rescueT(locale, 'safeTitle')}</h1>
          <p>{rescueT(locale, 'safeBody')}</p>
        </>
      ) : null}
      <div className="rescue-grow">
        {screen !== 'intro1' ? <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} /> : null}
        {screen === 'intro3'
          ? <button type="button" className="rescue-btn" onClick={props.onScan}>{rescueT(locale, 'scanCta')}</button>
          : <button type="button" className="rescue-btn" onClick={props.onNext}>{rescueT(locale, 'next')}</button>}
      </div>
    </>
  );
}

function ScanView(props: { locale: RescueLocale; frame: ScanFrame; piles: readonly Pile[] }) {
  const { locale, frame } = props;
  const size = formatBytes(frame.bytes);
  return (
    <>
      <Brand />
      <p className="rescue-lead">{rescueT(locale, 'scanTitle')}</p>
      <div aria-live="polite">
        {frame.bytes > 0
          ? <SizeHeading locale={locale} template="scanEarly" size={size} />
          : <h1>{rescueT(locale, 'scanWait')}</h1>}
      </div>
      <div
        className="rescue-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={frame.total}
        aria-valuenow={frame.done}
        aria-label={rescueT(locale, 'scanTitle')}
      >
        <span style={{ transform: `scaleX(${frame.total ? frame.done / frame.total : 0})` }} />
      </div>
      <p className="rescue-muted">
        {rescueT(locale, pileKey(frame.current))} · {rescueT(locale, 'scanProgress', { done: frame.done, total: frame.total })}
      </p>
      <div className="rescue-stack">
        {props.piles.map((pile, index) => (
          <p key={pile.id}>{index === 0 ? rescueT(locale, 'fastest') + ' · ' : ''}{rescueT(locale, pileKey(pile.id))}</p>
        ))}
      </div>
    </>
  );
}

function Home(props: {
  locale: RescueLocale;
  piles: readonly Pile[];
  checked: ReadonlySet<string>;
  aside: ReadonlySet<string>;
  selectedBytes: number;
  trashedBytes: number;
  freedBytes: number;
  onOpenPile: (id: PileId) => void;
  onTrash: () => void;
}) {
  const { locale } = props;
  const size = formatBytes(props.selectedBytes);
  return (
    <>
      <Brand />
      <p className="rescue-lead">{rescueT(locale, 'vp')}</p>
      {props.selectedBytes > 0
        ? <SizeHeading locale={locale} template="homeTitle" size={size} />
        : <h1>{rescueT(locale, 'emptyClean')}</h1>}
      <p className="rescue-muted">{rescueT(locale, 'firstFree')}</p>
      <div className="rescue-note">
        <p>{rescueT(locale, 'demo')}</p>
        <button type="button" className="rescue-btn quiet" onClick={() => openStoreListing()}>{rescueT(locale, 'play')}</button>
      </div>
      {props.trashedBytes > 0 ? (
        <button type="button" className="rescue-btn quiet" onClick={props.onTrash}>
          {rescueT(locale, 'trashOpen', { size: formatBytes(props.trashedBytes) })}
        </button>
      ) : null}
      {props.freedBytes > 0 ? <p className="rescue-muted">{rescueT(locale, 'freedSoFar', { size: formatBytes(props.freedBytes) })}</p> : null}
      <div className="rescue-stack">
        {props.piles.map((pile, index) => {
          const name = rescueT(locale, pileKey(pile.id));
          const sel = selectionOf(pile.items, props.checked, props.aside);
          const effort = effortCount(sel.count === 0 ? 0 : effortSeconds(pile.id, sel.count));
          return (
            <article className="rescue-card" key={pile.id}>
              {index === 0 && pile.gbPerSecond > 0 ? <span className="rescue-pill">{rescueT(locale, 'fastest')}</span> : null}
              <h2>{name}</h2>
              {sel.count > 0 ? (
                <>
                  <p>{rescueT(locale, 'pileMeta', { size: formatBytes(sel.bytes), count: sel.count })}</p>
                  <p className="rescue-muted">{rescueT(locale, effort.key, { count: effort.count })}</p>
                </>
              ) : <p className="rescue-muted">{rescueT(locale, 'optIn')}</p>}
              {sel.leftOut > 0 ? <p className="rescue-muted">{rescueT(locale, 'unchecked', { count: sel.leftOut })}</p> : null}
              <button
                type="button"
                className="rescue-btn"
                aria-label={`${rescueT(locale, 'review')} ${name}`}
                onClick={() => props.onOpenPile(pile.id)}
              >
                {rescueT(locale, 'review')}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

