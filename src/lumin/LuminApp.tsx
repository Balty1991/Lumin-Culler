import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../state/store';
import { onTodayLaunch, scheduleDailyDigest, startOfDay, updateHomeWidget } from '../core/todayDigest';
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
import { Viewer } from './GalleryWall';
import { superviseUnsure } from './cloud';
import { autoSortToday, decideRestIfAllowed, summarizeToday } from './autoSort';
import { readWholeGallery } from './galleryReader';
import { autoNameFaces, canEmbedFaces, embedMissingFaces } from './faceIdentity';
import { TodayScreen } from './TodayScreen';
import { DaysScreen } from './DaysScreen';
import { BrainScreen } from './BrainScreen';
import { SettingsScreen } from './SettingsScreen';
import { SwipeSort } from './SwipeSort';
import { Orb } from './Orb';
import './lumin.css';

const PremiumPanel = lazy(() => import('../ui/PremiumPanel').then(m => ({ default: m.PremiumPanel })));

const NOTICE_MS = 4500;
const ACCEPT = 'image/*,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.raw,.rwl,.iiq,.x3f';

const TABS: { id: LxTab; icon: string; label: string }[] = [
  { id: 'today', icon: 'today', label: 'lx.nav.today' },
  { id: 'days', icon: 'days', label: 'lx.nav.days' },
  { id: 'brain', icon: 'brain', label: 'lx.nav.brain' },
  { id: 'settings', icon: 'settings', label: 'lx.nav.settings' }
];

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
  const day = groupDays(useStore.getState().photos).find(d => d.start === startOfDay());
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [booted, setBooted] = useState(false);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  useAutoThemeWatch();

  useEffect(() => {
    void boot().finally(() => {
      setBooted(true);
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
      useLx.getState().setTab('today');
      if (action !== 'today') { void openDayAction(action); return; }
      void useStore.getState().importToday().then(async added => {
        if (added) await decideRestIfAllowed();
        const result = summarizeToday(added ?? 0);
        if (result) useLx.getState().setAutoResult(result);
        const day = groupDays(useStore.getState().photos).find(d => d.start === startOfDay());
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
      const day = groupDays(useStore.getState().photos).find(d => d.start === startOfDay());
      const best = day && bestOfDay(day.kept);
      const subtitle = !day || day.photos.length === 0
        ? t(locale, 'lx.widget.empty')
        : day.waiting.length > 0
          ? t(locale, 'lx.widget.waiting', { count: day.waiting.length })
          : t(locale, 'lx.widget.kept', { count: day.kept.length });
      void updateHomeWidget({ title: t(locale, 'lx.widget.title'), subtitle, uri: best?.mediaUri, shareLabel: t(locale, 'lx.widget.share') });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [photos, booted, locale]);

  // Sortarea care se face singură: la pornire și de fiecare dată când revii în aplicație.
  useEffect(() => {
    if (!booted) return;
    const run = () => void autoSortToday().then(async r => {
      if (r) useLx.getState().setAutoResult(r);
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
  }, [booted]);

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

  const reader = useLx(s => s.reader);
  const busy = !!progress && progress.phase !== 'finalizat';

  return (
    <LxActionsContext.Provider value={actions}>
      <div className="lx" data-tab={tab}>
        {!booted ? (
          <div className="lx-loading"><Orb mood="think" size={96} /></div>
        ) : (
          <main className="lx-main" key={tab}>
            {tab === 'today' && <TodayScreen />}
            {tab === 'days' && <DaysScreen />}
            {tab === 'brain' && <BrainScreen />}
            {tab === 'settings' && <SettingsScreen />}
          </main>
        )}

        {reader && reader.paused !== 'import' ? (tab !== 'today' && (
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

        {sortOpen && <SwipeSort />}
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
