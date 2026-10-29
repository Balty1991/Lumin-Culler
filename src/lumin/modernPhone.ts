import { useEffect } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import { checkForUpdate, clearSharedFiles, completeUpdate, onShared, setSystemAppLocale, startUpdate, systemAppLocale, takeSharedFiles } from '../core/device';
import { useLx } from './lxStore';
import { onBackgroundCancel, setBackgroundStopLabel, stopBackgroundAnalysis } from '../core/backgroundAnalysis';
import { stopGalleryReader } from './galleryReader';

/**
 * lumin/modernPhone.ts
 * Legăturile cu telefonul care pornesc odată cu aplicația:
 *  - „Trimite către Cherrypic”: pozele primite din altă aplicație intră în import;
 *  - limba aleasă în Setări Android → Aplicații → Cherrypic (Android 13+) și,
 *    invers, limba schimbată în aplicație ajunge și acolo;
 *  - actualizarea din aplicație: o dată pe zi, dacă Play are o versiune nouă,
 *    omul e întrebat dacă o descarcă în fundal; la final, o repornire.
 */
const UPDATE_ASKED_KEY = 'lumin-update-asked-at';
const DAY = 86_400_000;

type RunImport = (files: File[]) => Promise<void>;

async function importShared(runImport: RunImport): Promise<void> {
  const files = await takeSharedFiles();
  if (!files.length) return;
  const locale = useStore.getState().locale;
  useStore.getState().setNotice(t(locale, 'lx.share.received', { count: files.length }));
  useLx.getState().setTab('days');
  useLx.getState().setGalleryView('wall');
  await runImport(files);
  clearSharedFiles();
}

async function offerUpdate(): Promise<void> {
  try {
    const last = Number(localStorage.getItem(UPDATE_ASKED_KEY) || 0);
    if (Date.now() - last < DAY) return;
  } catch { /* fără stocare: întrebăm */ }
  const state = await checkForUpdate();
  if (state === 'none') return;
  try { localStorage.setItem(UPDATE_ASKED_KEY, String(Date.now())); } catch { /* fără stocare */ }
  const { askConfirm, locale } = useStore.getState();
  const restart = async () => {
    if (await askConfirm(t(locale, 'lx.update.ready'), { confirmLabel: t(locale, 'lx.update.restart') })) completeUpdate();
  };
  if (state === 'downloaded') { await restart(); return; }
  if (!(await askConfirm(t(locale, 'lx.update.available'), { confirmLabel: t(locale, 'lx.update.download') }))) return;
  await startUpdate(() => { void restart(); });
}

export function useModernPhone(booted: boolean, runImport: RunImport): void {
  const locale = useStore(s => s.locale);
  useEffect(() => { setBackgroundStopLabel(t(locale, 'lx.bg.stop')); }, [locale]);
  useEffect(() => {
    if (!booted) return;
    let stop: (() => void) | undefined;
    void importShared(runImport);
    void onShared(() => { void importShared(runImport); }).then(fn => { stop = fn; });

    // Limba din setările Android câștigă la pornire, dacă omul a ales-o acolo.
    void systemAppLocale().then(lang => {
      const { locale, setLocale } = useStore.getState();
      if ((lang === 'ro' || lang === 'en') && lang !== locale) setLocale(lang);
    });
    let lastLocale = useStore.getState().locale;
    const unsub = useStore.subscribe(s => {
      if (s.locale === lastLocale) return;
      lastLocale = s.locale;
      setSystemAppLocale(s.locale);
    });

    // „Oprește” din notificarea de progres: oprește importul și cititorul galeriei.
    let stopCancel: (() => void) | undefined;
    void onBackgroundCancel(() => {
      stopGalleryReader();
      useStore.getState().cancelImport();
      void stopBackgroundAnalysis();
    }).then(fn => { stopCancel = fn; });

    const timer = window.setTimeout(() => { void offerUpdate(); }, 8000);
    return () => { stop?.(); stopCancel?.(); unsub(); window.clearTimeout(timer); };
  }, [booted, runImport]);
}
