import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../state/store';
import { onTodayLaunch, scheduleDailyDigest, startOfDay } from '../core/todayDigest';
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
      title: t(locale, 'today.notify.title'),
      body: t(locale, 'today.notify.body'),
      channelName: t(locale, 'today.notify.channel')
    });
  }, [locale]);

  // Deschisă din notificarea de seară: adu pozele zilei și pornește sortarea.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void onTodayLaunch(() => {
      useLx.getState().setTab('today');
      void useStore.getState().importToday().then(() => {
        const day = groupDays(useStore.getState().photos).find(d => d.start === startOfDay());
        if (day?.waiting.length) useLx.getState().openSort(day.waiting.map(p => p.id), t(useStore.getState().locale, 'lx.sort.today'));
      });
    }).then(fn => { stop = fn; });
    return () => stop?.();
  }, []);

  // Butonul „înapoi” al telefonului: închide ce e deschis, apoi revine la Azi.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapacitorApp.addListener('backButton', () => {
      const s = useStore.getState();
      const lx = useLx.getState();
      if (s.dialogRequest) { s.resolveDialog(s.dialogRequest.kind === 'confirm' ? false : null); return; }
      if (s.premiumOpen) { s.setPremiumOpen(false); return; }
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

        {busy && tab !== 'today' && progress && (
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
