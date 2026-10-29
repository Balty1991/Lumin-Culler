import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../state/store';
import { onTodayLaunch, scheduleDailyDigest, scheduleMorningMemory, startOfDay, updateHomeWidget } from '../core/todayDigest';
import { onThisDay } from './momentAlbums';
import { maybeAskForReviewAfterWin } from '../state/reviewPrompt';
import { freedSummary } from '../core/freedSpace';
import { pickImportFiles } from '../core/filePicker';
import { isNativeMediaLibraryAvailable, pickNativePhotos } from '../core/nativeMediaLibrary';
import { analysisPool } from '../core/workerPool';
import { useAutoThemeWatch } from '../ui/useAutoThemeWatch';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FirstRun } from '../ui/FirstRun';
import { TasteQuiz } from '../ui/TasteQuiz';
import { noticeTone } from '../ui/noticeTone';
import { t } from '../i18n';
import { useLx, type LxTab } from './lxStore';
import { LxActionsContext } from './context';
import { groupDays } from './days';
import { learnFromShare } from './signals';
import { visiblePhotos } from './useLxPhotos';
import { autoBackupIfDue, markRestoreAsked, restorableBackup, setAutoBackup } from './autoBackup';
import { Viewer } from './GalleryWall';
import { superviseUnsure } from './cloud';
import { autoSortToday, decideRestIfAllowed, summarizeToday } from './autoSort';
import { readWholeGallery, readerStopped } from './galleryReader';
import { syncPeopleAlbums } from './phoneAlbums';
import { autoNameFaces, canEmbedFaces, embedMissingFaces } from './faceIdentity';
import { TodayScreen } from './TodayScreen';
import { applyPalette } from '../state/palette';
import { autoArchiveIfDue } from './archive';
import { holdRejectsUntilTrained } from './trainingGate';
import { useModernPhone } from './modernPhone';
import { Orb } from './Orb';
import { UndoBar } from './UndoBar';
import { TrashPreviewHost } from './TrashPreview';
import { tourDone } from './tour';
import './lumin.css';

// Doar Azi se încarcă la pornire; restul ecranelor, la prima deschidere (pornire mai rapidă).
const DaysScreen = lazy(() => import('./DaysScreen').then(m => ({ default: m.DaysScreen })));
const BrainScreen = lazy(() => import('./BrainScreen').then(m => ({ default: m.BrainScreen })));
const SettingsScreen = lazy(() => import('./SettingsScreen').then(m => ({ default: m.SettingsScreen })));
const SwipeSort = lazy(() => import('./SwipeSort').then(m => ({ default: m.SwipeSort })));
const AppTour = lazy(() => import('./AppTour').then(m => ({ default: m.AppTour })));
const PremiumPanel = lazy(() => import('../ui/PremiumPanel').then(m => ({ default: m.PremiumPanel })));

const NOTICE_MS = 4500;
const ACCEPT = 'image/*,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.raw,.rwl,.iiq,.x3f';

const TABS: { id: LxTab; icon: string; label: string }[] = [
  { id: 'today', icon: 'today', label: 'lx.nav.today' },
  { id: 'days', icon: 'days', label: 'lx.nav.days' },
  { id: 'brain', icon: 'brain', label: 'lx.nav.brain' },
  { id: 'settings', icon: 'settings', label: 'lx.nav.settings' }
];

/**
 * Copia automată: pe un telefon nou, Android a pus la loc ce a învățat Cherrypic
 * pe cel vechi; se oferă înapoi o dată. Altfel, copia săptămânală, dacă e vremea.
 */
async function offerRestoreOrBackup(): Promise<void> {
  const file = await restorableBackup();
  if (!file) { await autoBackupIfDue(); return; }
  markRestoreAsked();
  const st = useStore.getState();
  if (!(await st.askConfirm(t(st.locale, 'lx.autoBackup.restore'), { confirmLabel: t(st.locale, 'lx.autoBackup.restoreGo') }))) return;
  await useStore.getState().importBackupFile(file);
  await setAutoBackup(true);
}

/** „Acum un an” din notificarea de dimineață: poza trimisă direct, sau amintirile deschise. */
async function openMemoryAction(action: 'share_memory' | 'see_memory'): Promise<void> {
  const m = onThisDay(visiblePhotos())[0];
  if (!m?.photos.length) return;
  if (action === 'see_memory') { useLx.getState().openViewer(m.photos.map(p => p.id), 0); return; }
  await useStore.getState().exportSelection('apps', [m.photos[0].id]);
  void learnFromShare([m.photos[0]]);
}

/** Pozele de „Acum un an” pentru următoarele 14 dimineți, alese ca pe Azi (păstrate, apoi scor). */
function memoryPicks(): Record<string, { uri: string; years: number }> {
  const photos = visiblePhotos();
  const out: Record<string, { uri: string; years: number }> = {};
  for (let i = 0; i < 14; i++) {
    const at = Date.now() + i * 86_400_000;
    const d = new Date(at);
    const best = onThisDay(photos, at).find(m => m.photos.some(p => p.mediaUri));
    const p = best?.photos.find(x => x.mediaUri);
    if (best && p?.mediaUri) out[`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = { uri: p.mediaUri, years: best.years };
  }
  return out;
}

/** Cea mai bună poză păstrată a zilei: aceeași pe widget, în notificare și la „Trimite familiei”. */
function bestOfDay<T extends { aiScore: number }>(kept: readonly T[]): T | undefined {
  return [...kept].sort((a, b) => b.aiScore - a.aiScore)[0];
}

/**
 * Butoanele din notificarea de seară și din widget: „Trimite familiei” (poza zilei
 * pleacă direct în foaia de trimitere) și „Vezi ziua” (pozele zilei, fără sortare).
 */
async function openDayAction(action: 'share_pod' | 'see_day'): Promise<void> {
  await useStore.getState().importToday().catch(() => 0);
  const day = groupDays(visiblePhotos()).find(d => d.start === startOfDay());
  if (!day?.photos.length) return;
  if (action === 'see_day') {
    const list = day.kept.length ? day.kept : day.photos;
    useLx.getState().openViewer(list.map(p => p.id), 0);
    return;
  }
  const best = bestOfDay(day.kept) ?? bestOfDay(day.photos);
  if (!best) return;
  await useStore.getState().exportSelection('apps', [best.id]);
  void learnFromShare([best]);
}

function ScreenWait() {
  return <div className="lx-loading small"><Orb mood="think" size={48} /></div>;
}

function TabIcon({ name }: { name: string }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'today') return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (name === 'days') return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>;
  if (name === 'brain') return <svg {...common}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /><path d="M12 1v3M12 20v3" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
}

/**
 * lumin/LuminApp.tsx
 * Lumin AI: aplicația nouă, construită în jurul unei singure idei — un AI
 * care îți învață gustul și îți alege pozele în fiecare zi. Patru locuri:
 * Azi, Zile, AI-ul tău, Setări; sortarea e un pachet de carduri peste ele.
 *
 * Motorul e cel care exista (state/store.ts: import, analiză pe telefon,
 * învățare, decizii); interfața veche nu mai e montată deloc.
 */
export function LuminApp() {
  const boot = useStore(s => s.boot);
  const locale = useStore(s => s.locale);
  const notice = useStore(s => s.notice);
  const clearNotice = useStore(s => s.clearNotice);
  const setNotice = useStore(s => s.setNotice);
  const runImport = useStore(s => s.runImport);
  const progress = useStore(s => s.progress);
  const premiumOpen = useStore(s => s.premiumOpen);
  const tab = useLx(s => s.tab);
  const setTab = useLx(s => s.setTab);
  const sortOpen = useLx(s => s.sortIds !== null);
  const tourOpen = useLx(s => s.tourOpen);
  const fileRef = useRef<HTMLInputElement>(null);
  const [booted, setBooted] = useState(false);
  // Taburile deja deschise și locul din pagină al fiecăruia (fiecare tab își păstrează derularea).
  const [visited, setVisited] = useState<ReadonlySet<LxTab>>(() => new Set([tab]));
  const scrolls = useRef<Partial<Record<LxTab, number>>>({});
  const shownTab = useRef(tab);
  useLayoutEffect(() => {
    if (shownTab.current === tab) return;
    // În aplicație derulează `body`, nu fereastra (vezi GalleryWall.onAnyScroll).
    const scroller = document.body.scrollTop ? document.body : (document.scrollingElement ?? document.documentElement);
    scrolls.current[shownTab.current] = scroller.scrollTop;
    shownTab.current = tab;
    setVisited(v => (v.has(tab) ? v : new Set(v).add(tab)));
    const top = scrolls.current[tab] ?? 0;
    requestAnimationFrame(() => { for (const el of [document.scrollingElement, document.body]) el?.scrollTo({ top }); });
  }, [tab]);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  useAutoThemeWatch();
  useModernPhone(booted, runImport);

  useEffect(() => {
    applyPalette();
    void boot().finally(() => {
      setBooted(true);
      void offerRestoreOrBackup();
      // Arhiva automată (dacă e pornită): o dată pe săptămână, pozele vechi și slabe pleacă din drum.
      autoArchiveIfDue(visiblePhotos());
      // Galeria sortată din prea puține lecții (raportat: 295 la „Nu azi” după 4 alegeri):
      // refuzurile AI-ului revin la „de văzut” până la antrenament (trainingGate.ts).
      void holdRejectsUntilTrained(useStore.getState().photos.map(p => p.id)).catch(() => 0);
      // Bibliotecile de dinainte de „momente” (raportat: 8 păstrate din 9 aproape la fel).
      void useStore.getState().applyMoments().catch(() => {});
    });
  }, [boot]);

  useEffect(() => {
    void scheduleDailyDigest({
      title: t(locale, 'lx.twin.notify.title'),
      body: t(locale, 'lx.twin.notify.body'),
      channelName: t(locale, 'today.notify.channel'),
      shareLabel: t(locale, 'lx.notify.share'),
      dayLabel: t(locale, 'lx.notify.day')
    });
  }, [locale]);

  // Deschisă din notificarea de seară: adu pozele zilei și pornește sortarea.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void onTodayLaunch(action => {
      if (action === 'search') { useLx.getState().focusSearch(); return; }
      if (action === 'map') { useLx.getState().setTab('days'); useLx.getState().setGalleryView('map'); return; }
      useLx.getState().setTab('today');
      if (action === 'share_memory' || action === 'see_memory') { void openMemoryAction(action); return; }
      if (action !== 'today') { void openDayAction(action); return; }
      void useStore.getState().importToday().then(async added => {
        if (added) await decideRestIfAllowed();
        const result = summarizeToday(added ?? 0);
        if (result) useLx.getState().setAutoResult(result);
        const day = groupDays(visiblePhotos()).find(d => d.start === startOfDay());
        if (day?.waiting.length) useLx.getState().openSort(day.waiting.map(p => p.id), t(useStore.getState().locale, 'lx.sort.today'));
      });
    }).then(fn => { stop = fn; });
    return () => stop?.();
  }, []);

  // Widgetul de pe ecranul telefonului urmează ziua: poza cea mai bună și ce mai așteaptă.
  const photos = useStore(s => s.photos);
  useEffect(() => {
    if (!booted) return;
    const timer = window.setTimeout(() => {
      const day = groupDays(visiblePhotos()).find(d => d.start === startOfDay());
      const best = day && bestOfDay(day.kept);
      const subtitle = !day || day.photos.length === 0
        ? t(locale, 'lx.widget.empty')
        : day.waiting.length > 0
          ? t(locale, 'lx.widget.waiting', { count: day.waiting.length })
          : t(locale, 'lx.widget.kept', { count: day.kept.length });
      // Cererea de recenzie, o singură dată, după un câștig vizibil (1 GB eliberat sau 100 de poze hotărâte).
      const all = visiblePhotos();
      maybeAskForReviewAfterWin({ freedBytes: freedSummary().total, decided: all.filter(p => p.status === 'selected' || p.status === 'rejected').length });
      void updateHomeWidget({ title: t(locale, 'lx.widget.title'), subtitle, uri: best?.mediaUri, shareLabel: t(locale, 'lx.widget.share') });
      void scheduleMorningMemory({
        title1: t(locale, 'lx.memory.notify.title1'), titleN: t(locale, 'lx.memory.notify.titleN'),
        body: t(locale, 'lx.memory.notify.body'), channel: t(locale, 'lx.memory.notify.channel'),
        share: t(locale, 'lx.notify.share'), see: t(locale, 'lx.memory.notify.see')
      }, memoryPicks());
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [photos, booted, locale]);

  // Sortarea care se face singură: la pornire și de fiecare dată când revii în aplicație.
  // Abia după primii pași (raportat: analiza pornea cât omul încă alegea pe ecranul de
  // început și înainte de testul de gust); până atunci nu se citește nimic singur.
  const welcomeSeen = useStore(s => s.welcomeSeen);
  useEffect(() => {
    if (!booted || !welcomeSeen) return;
    const run = () => {
      // A amânat sau a ales singur pozele la început și n-are încă nimic: nu citim de capul nostru.
      if (readerStopped() && useStore.getState().photos.length === 0) return;
      autoRun();
    };
    const autoRun = () => void autoSortToday().then(async r => {
      if (r) useLx.getState().setAutoResult(r);
      // Albumele pe oameni din galeria telefonului, la zi (dacă omul le-a pornit).
      void syncPeopleAlbums().catch(() => 0);
      // Apoi restul galeriei, în fundal, de la cele mai noi spre cele vechi.
      void readWholeGallery();
      // Lumi Cloud (doar dacă omul l-a pornit): a doua părere pe pozele rămase nesigure.
      const c = await superviseUnsure();
      if (c.decided) useStore.getState().setNotice(t(useStore.getState().locale, 'lx.cloud.auto', { decided: c.decided }));
    });
    run();
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapacitorApp.addListener('resume', run);
    return () => { void sub.then(h => h.remove()); };
  }, [booted, welcomeSeen]);

  // Fețele: după pornire și după fiecare import, amprentele lipsă și numele recunoscute.
  const importDone = !progress || progress.phase === 'finalizat';
  // Cât se citește galeria, fețele așteaptă: rulau după fiecare pachet, în paralel
  // cu analiza următorului, și încetineau amândouă.
  const readingGallery = useLx(s => !!s.reader && s.reader.paused !== 'battery');
  useEffect(() => {
    if (!booted || !importDone || readingGallery || !canEmbedFaces()) return;
    let alive = true;
    void (async () => {
      const made = await embedMissingFaces((done, total) => { if (alive) useLx.getState().setFaceProgress({ done, total }); });
      useLx.getState().setFaceProgress(null);
      const named = await autoNameFaces().catch(() => 0);
      if (made || named) useLx.getState().bumpFaces();
      if (named) useStore.getState().setNotice(t(useStore.getState().locale, 'lx.people.autoNamed', { count: named }));
    })().catch(() => useLx.getState().setFaceProgress(null));
    return () => { alive = false; };
  }, [booted, importDone, readingGallery]);

  // După ce Azi e pe ecran, celelalte ecrane se pregătesc în liniște: prima atingere pe meniu nu mai așteaptă.
  useEffect(() => {
    if (!booted) return;
    const timer = window.setTimeout(() => {
      void import('./DaysScreen'); void import('./BrainScreen'); void import('./SettingsScreen'); void import('./SwipeSort');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [booted]);

  // Butonul „înapoi” al telefonului: închide ce e deschis, apoi revine la Azi.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapacitorApp.addListener('backButton', () => {
      const s = useStore.getState();
      const lx = useLx.getState();
      if (s.dialogRequest) { s.resolveDialog(s.dialogRequest.kind === 'confirm' ? false : null); return; }
      if (s.premiumOpen) { s.setPremiumOpen(false); return; }
      if (lx.viewer) { lx.closeViewer(); return; }
      if (lx.sortIds) { lx.closeSort(); return; }
      if (lx.openDay !== null) { lx.setOpenDay(null); return; }
      if (lx.tab !== 'today') { lx.setTab('today'); return; }
      void CapacitorApp.exitApp();
    });
    return () => { void handle.then(h => h.remove()); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const tone = noticeTone(notice);
    if (tone === 'error' || tone === 'progress') return;
    const timer = window.setTimeout(() => clearNotice(), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  const actions = useMemo(() => ({
    pick: () => {
      void (async () => {
        void analysisPool.init().catch(() => {});
        if (isNativeMediaLibraryAvailable()) {
          try {
            const picked = await pickNativePhotos();
            if (picked.length) void runImport(picked.map(p => p.file), undefined, picked.map(p => p.uri));
            return;
          } catch {
            // selectorul nativ a eșuat: încercăm calea obișnuită
          }
        }
        const picked = await pickImportFiles();
        if (picked) {
          if (picked.files.length) void runImport(picked.files, picked.handles);
          return;
        }
        fileRef.current?.click();
      })();
    }
  }), [runImport]);

  // Prima intrare în aplicație: turul scurt, după ce pașii de început s-au închis
  // și galeria are poze. Așteaptă cât e deschis alt dialog (antrenament, confirmări).
  const hasPhotos = photos.length > 0;
  useEffect(() => {
    if (!booted || !welcomeSeen || !hasPhotos || sortOpen || tourDone()) return;
    const id = window.setInterval(() => {
      if (document.querySelector('[aria-modal="true"]')) return;
      window.clearInterval(id);
      if (!tourDone()) useLx.getState().setTourOpen(true);
    }, 1500);
    return () => window.clearInterval(id);
  }, [booted, welcomeSeen, hasPhotos, sortOpen]);
  const reader = useLx(s => s.reader);
  const busy = !!progress && progress.phase !== 'finalizat';

  return (
    <LxActionsContext.Provider value={actions}>
      <div className="lx" data-tab={tab}>
        {!booted ? (
          <div className="lx-loading"><Orb mood="think" size={96} /></div>
        ) : (
          <main className="lx-main">
            {/* Ecranele vizitate rămân montate, ascunse: schimbarea din meniu nu le mai
                reconstruiește (raportat: „la schimbarea prin meniu merge sacadat”). */}
            {visited.has('today') && <div className="lx-tabpane" hidden={tab !== 'today'}><TodayScreen /></div>}
            {visited.has('days') && <div className="lx-tabpane" hidden={tab !== 'days'}><Suspense fallback={<ScreenWait />}><DaysScreen /></Suspense></div>}
            {visited.has('brain') && <div className="lx-tabpane" hidden={tab !== 'brain'}><Suspense fallback={<ScreenWait />}><BrainScreen /></Suspense></div>}
            {visited.has('settings') && <div className="lx-tabpane" hidden={tab !== 'settings'}><Suspense fallback={<ScreenWait />}><SettingsScreen /></Suspense></div>}
          </main>
        )}

        {/* O completare mică (pozele noi de azi) se face în liniște, fără bulină peste titlu. */}
        {reader && reader.paused !== 'import' ? (tab !== 'today' && reader.total > 30 && (
          <button className="lx-busy-pill" onClick={() => setTab('today')}>
            <Orb mood="think" size={20} />
            {tr('lx.reader.pill', { done: reader.done, total: reader.total })}
          </button>
        )) : busy && tab !== 'today' && progress && (
          <button className="lx-busy-pill" onClick={() => setTab('today')}>
            <Orb mood="think" size={20} />
            {tr('lx.today.progress', { done: progress.done, total: progress.total })}
          </button>
        )}

        <nav className="lx-dock" aria-label={tr('lx.nav.label')}>
          {TABS.slice(0, 2).map(x => (
            <button key={x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)} aria-current={tab === x.id ? 'page' : undefined}>
              <TabIcon name={x.icon} /><span>{tr(x.label)}</span>
            </button>
          ))}
          <button className="lx-dock-add" onClick={actions.pick} aria-label={tr('lx.addPhotos')}>
            <span>+</span>
          </button>
          {TABS.slice(2).map(x => (
            <button key={x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)} aria-current={tab === x.id ? 'page' : undefined}>
              <TabIcon name={x.icon} /><span>{tr(x.label)}</span>
            </button>
          ))}
        </nav>

        {sortOpen && <Suspense fallback={null}><SwipeSort /></Suspense>}
        {booted && tourOpen && !sortOpen && (
          <Suspense fallback={null}><AppTour onClose={() => useLx.getState().setTourOpen(false)} /></Suspense>
        )}
        <GlobalViewer />

        {notice && (
          <div className={`lx-toast ${noticeTone(notice)}`} role="status" onClick={clearNotice}>{notice}</div>
        )}

        <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
          onChange={e => {
            const list = e.target.files;
            if (list && list.length) void runImport(Array.from(list));
            else setNotice(tr('app.import.noneSelected'));
            e.target.value = '';
          }} />

        <FirstRun onPickManually={actions.pick} />
        <TasteQuiz />
        {premiumOpen && <Suspense fallback={null}><PremiumPanel /></Suspense>}
        <UndoBar />
        <TrashPreviewHost />
        <ConfirmDialog />
      </div>
    </LxActionsContext.Provider>
  );
}

/** Poza mare deschisă de oriunde (zi, serie, oameni, momente, Azi): doar privit, glisat liber. */
function GlobalViewer() {
  const viewer = useLx(s => s.viewer);
  const photos = useStore(s => s.photos);
  const list = useMemo(() => {
    if (!viewer) return [];
    const byId = new Map(photos.map(p => [p.id, p]));
    return viewer.ids.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);
  if (!viewer || !list.length) return null;
  return <Viewer list={list} index={Math.min(viewer.index, list.length - 1)}
    onIndex={i => useLx.setState({ viewer: { ids: viewer.ids, index: i } })} onClose={() => useLx.getState().closeViewer()} />;
}
