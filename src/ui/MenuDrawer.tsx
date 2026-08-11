import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import {
  UserCheckIcon, SparkleIcon, ListIcon, InfoIcon, XIcon, TagIcon, LayersIcon, KeyboardIcon,
  SunIcon, MoonIcon, ClockIcon, BatteryIcon, GridIcon, DownloadIcon, UploadIcon, BarChartIcon, GlobeIcon, PrinterIcon,
  ApertureIcon, PlayIcon, EditIcon, FolderIcon, HeartIcon, TrashIcon, PinIcon, PaletteIcon
} from './icons';
import type { AccentTheme } from '../state/accentTheme';
import { selectDeletableRejected } from '../state/batchOps';
import { selectMonthlyRecap } from '../state/monthlyRecap';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { EASE } from './motion';
import { GENRE_PRESETS } from '../state/genre';
import { nextGridDensity } from '../state/gridDensity';
import { getInstallPromptEvent, subscribeInstallPromptEvent, consumeInstallPromptEvent, isStandalone } from '../core/installPromptEvent';
import { detectFacesNative, isNativeFaceDetectionAvailable } from '../core/nativeFaceDetection';
import { analyzeImageNative, isNativeImageAnalysisAvailable } from '../core/nativeImageAnalysis';
import { labelImageNative, isNativeImageLabelingAvailable } from '../core/nativeImageLabeling';
import { analyzeFaceMeshNative, isNativeFaceMeshAvailable } from '../core/nativeFaceMesh';
import { classifyImageNative, isNativeImageClassifierAvailable } from '../core/nativeImageClassifier';
import { detectTextNative, isNativeTextRecognitionAvailable } from '../core/nativeTextRecognition';
import { detectPoseNative, isNativePoseDetectionAvailable } from '../core/nativePoseDetection';
import { segmentSubjectNative, isNativeSegmentationAvailable } from '../core/nativeSegmentation';
import { embedImageNative, isNativeImageEmbedderAvailable } from '../core/nativeImageEmbedder';
import { t } from '../i18n';

/**
 * Controleaza DOAR vizibilitatea butonului de test nativ — NU e acelasi lucru
 * cu import.meta.env.DEV (bug real gasit la testare pe device: legarea de DEV
 * insemna ca intreg build-ul de test rula in modul development al React,
 * unde StrictMode dubleaza deliberat efectele — asta dubla pornirea analizei
 * la import si bloca vizibil telefonul). VITE_NATIVE_TEST_BUTTON e setat doar
 * de android-debug-build.yml (dev_mode=true), pe un build altfel NORMAL de
 * productie (minificat, React fara StrictMode dublu) — un singur lucru se
 * schimba: acest buton.
 */
const SHOW_NATIVE_TEST_BUTTON = import.meta.env.DEV || import.meta.env.VITE_NATIVE_TEST_BUTTON === 'true';

/** Previzualizari statice (nu variabile CSS) — trebuie sa arate TOATE cele 3 optiuni
    simultan, nu doar cea activa in acest moment. Vezi :root[data-accent] in styles.css
    pentru valorile reale aplicate. */
const ACCENT_OPTIONS: { id: AccentTheme; gradient: string }[] = [
  { id: 'classic', gradient: 'linear-gradient(135deg, #2dd4bf, #8b5cf6 55%, #6366f1)' },
  { id: 'sunset', gradient: 'linear-gradient(135deg, #ff8a5c, #ff5c8a)' },
  { id: 'holo', gradient: 'linear-gradient(90deg, #00fff2, #7a5cff)' }
];

/** Meniu lateral: persoane, preferinte AI invatate, export lista, despre. */
export function MenuDrawer() {
  const open = useStore(s => s.menuOpen);
  const setOpen = useStore(s => s.setMenuOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const setBatchOpsOpen = useStore(s => s.setBatchOpsOpen);
  const photos = useStore(s => s.photos);
  const deletableRejectedCount = useMemo(() => selectDeletableRejected(photos).deletable.length, [photos]);
  const setShortcutsOpen = useStore(s => s.setShortcutsOpen);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const accentTheme = useStore(s => s.accentTheme);
  const setAccentTheme = useStore(s => s.setAccentTheme);
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const economicMode = useStore(s => s.economicMode);
  const setEconomicMode = useStore(s => s.setEconomicMode);
  const genre = useStore(s => s.genre);
  const setGenre = useStore(s => s.setGenre);
  const gridDensity = useStore(s => s.gridDensity);
  const setGridDensity = useStore(s => s.setGridDensity);
  const exportManifest = useStore(s => s.exportManifest);
  const exportSessionReport = useStore(s => s.exportSessionReport);
  const exportXMP = useStore(s => s.exportXMP);
  const exportClientGallery = useStore(s => s.exportClientGallery);
  const watermarkText = useStore(s => s.watermarkText);
  const setWatermarkText = useStore(s => s.setWatermarkText);
  const applyEditsInGallery = useStore(s => s.applyEditsInGallery);
  const setApplyEditsInGallery = useStore(s => s.setApplyEditsInGallery);
  const exportBackup = useStore(s => s.exportBackup);
  const importBackupFile = useStore(s => s.importBackupFile);
  const importClientFeedback = useStore(s => s.importClientFeedback);
  const setNotice = useStore(s => s.setNotice);
  const setStatsOpen = useStore(s => s.setStatsOpen);
  const setContactSheetOpen = useStore(s => s.setContactSheetOpen);
  const setPresentationOpen = useStore(s => s.setPresentationOpen);
  const setPresentationPhotoIds = useStore(s => s.setPresentationPhotoIds);
  const setProjectsOpen = useStore(s => s.setProjectsOpen);
  const setCollectionsOpen = useStore(s => s.setCollectionsOpen);
  const setTripsOpen = useStore(s => s.setTripsOpen);
  const persons = useStore(s => s.persons);
  const askConfirm = useStore(s => s.askConfirm);
  const reduceMotion = useReducedMotion();
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const clientFeedbackInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  useModalFocusTrap(containerRef, open);

  // Bug real gasit de auditul QA: MenuDrawer era singurul panou din aplicatie
  // fara Escape-to-close — un utilizator de tastatura n-avea nicio cale sa-l
  // inchida decat sa dea Tab pana la butonul X. Vezi acelasi tipar in
  // EditPanel.tsx.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // "Automat, dupa ora" (plan modernizare) — reaplica periodic tema cat timp
  // preferinta e 'auto', ca o sesiune care ramane deschisa peste pragul
  // 7:00/20:00 sa comute fara sa fie nevoie de o repornire a aplicatiei.
  // MenuDrawer ramane montat permanent in App.tsx (doar continutul e ascuns
  // cand !open), deci acest efect ruleaza indiferent daca meniul e deschis.
  useEffect(() => {
    if (theme !== 'auto') return;
    const id = setInterval(() => setTheme('auto'), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [theme, setTheme]);
  // Acelasi eveniment beforeinstallprompt ca InstallPrompt.tsx (citit dintr-un modul
  // comun, nu recaptat aici) — ramane accesibil din Meniu chiar dupa ce bannerul a
  // fost inchis, ca "nu mai arata asta" sa nu insemne "nu mai pot instala niciodata".
  const installEvent = useSyncExternalStore(subscribeInstallPromptEvent, getInstallPromptEvent);

  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const go = (action: () => void) => { setOpen(false); action(); };

  // TEMPORAR (Faza 1-6, analiza AI nativa) — doar ca sa poata fi testat direct pe
  // device, fara Chrome DevTools/USB. De eliminat cand pipeline-ul nativ chiar
  // inlocuieste analiza reala (vezi core/native*.ts — cate un modul per plugin).
  // Gated pe SHOW_NATIVE_TEST_BUTTON (mai jos), NU pe import.meta.env.DEV —
  // bug real gasit la testare pe device: legarea de DEV insemna ca intreg
  // build-ul de test rula in modul development al React (StrictMode ruleaza
  // deliberat de doua ori efectele, ca sa prinda bug-uri), ceea ce dubla
  // pornirea analizei la import si bloca vizibil telefonul — un efect secundar
  // nedorit, fara nicio legatura reala cu pastrarea butonului de test.
  const testNativeFaceDetection = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      // SECVENTIAL, nu Promise.all — bug real gasit la testare pe device: 9
      // modele grele (ML Kit + TFLite + MediaPipe) incarcate/rulate deodata
      // au impins telefonul in lipsa de memorie si l-au facut sa inchida
      // aplicatia (crash nativ, fara nicio eroare JS prinsa). Rulate pe rand,
      // varful de memorie ramane mult mai mic — mai lent per total, dar
      // arata si EXACT la ce pas se opreste, daca tot mai crapa ceva
      // (ultimul mesaj ramas pe ecran = ultimul modul pornit).
      void (async () => {
        const steps: Array<[string, () => Promise<unknown>]> = [
          ['fete (ML Kit)', () => detectFacesNative(file)],
          ['compozitie/claritate/culoare', () => analyzeImageNative(file)],
          ['etichete de scena (ML Kit)', () => labelImageNative(file)],
          ['fata detaliata (MediaPipe)', () => analyzeFaceMeshNative(file)],
          ['etichete bogate (ImageNet)', () => classifyImageNative(file)],
          ['text (OCR)', () => detectTextNative(file)],
          ['postura corp', () => detectPoseNative(file)],
          ['separare persoana/fundal', () => segmentSubjectNative(file)],
          ['embedding similaritate', () => embedImageNative(file)]
        ];
        const results: Record<string, unknown> = {};
        for (const [name, run] of steps) {
          setNotice(`Se testeaza: ${name}...`);
          try {
            results[name] = await run();
          } catch (err) {
            setNotice(`Native FAIL la "${name}": ${err instanceof Error ? err.message : String(err)}`);
            return;
          }
        }
        setNotice(`Native OK (toate 9 module): ${JSON.stringify(results)}`);
      })();
    };
    input.click();
  };
  // Intrarea din Meniu ramane mereu vizibila (utilizatorul a cerut explicit sa nu
  // depinda de momentul in care browserul decide sa ofere beforeinstallprompt) — daca
  // evenimentul chiar exista, il folosim; altfel aratam instructiuni de instalare
  // manuala (singura optiune reala: nu exista API JS care sa deschida direct
  // dialogul nativ de instalare fara evenimentul respectiv).
  const installApp = async () => {
    if (installEvent) {
      await installEvent.prompt();
      await installEvent.userChoice;
      consumeInstallPromptEvent();
    } else {
      void askConfirm(tr('menu.installApp.manual'), { confirmLabel: tr('menu.installApp.gotIt') });
    }
  };

  return (
    <>
    {/* In afara AnimatePresence: trebuie sa ramana in DOM chiar si dupa ce
       meniul s-a inchis (si a fost demontat de animatia de exit), altfel
       evenimentul `change` al selectorului nativ de fisiere — care se
       intoarce mult dupa cele ~260ms de tranzitie — ajunge pe un element deja
       scos din arbore si React nu-l mai vede (importul parea ca "nu face nimic"). */}
    <input
      ref={restoreInputRef}
      type="file"
      accept="application/json,.json"
      style={{ display: 'none' }}
      onChange={e => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        // feedback IMEDIAT, inainte de orice parsare/scriere async — pe unele
        // telefoane, revenirea din selectorul nativ de fisiere la tab-ul
        // Chrome poate introduce o intarziere vizibila pana randeaza update-ul
        // final; fara asta, utilizatorul nu are NICIUN semnal ca apasarea a
        // avut vreun efect cat timp asteapta rezultatul
        setNotice(tr('menu.importBackup.processing'));
        void importBackupFile(file);
      }}
    />
    <input
      ref={clientFeedbackInputRef}
      type="file"
      accept="application/json,.json"
      style={{ display: 'none' }}
      onChange={e => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setNotice(tr('menu.importBackup.processing'));
        void importClientFeedback(file);
      }}
    />
    <AnimatePresence>
      {open && (
    <motion.div
      className="drawer-scrim" onClick={() => setOpen(false)}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
    >
      <motion.nav
        className="drawer" onClick={e => e.stopPropagation()}
        ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.title')} tabIndex={-1}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: reduceMotion ? 0 : 0.26, ease: EASE }}
      >
        <header className="drawer-head">
          <span>{tr('menu.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('menu.close')}>
            <XIcon />
          </button>
        </header>

        {!isStandalone() && (
          <>
            <button className="drawer-item" onClick={() => go(() => void installApp())}>
              <span className="drawer-item-icon"><ApertureIcon /></span>
              <span>{tr('menu.installApp')}</span>
            </button>
            <div className="drawer-sep" />
          </>
        )}

        <div className="drawer-section-label">{tr('menu.section.workspace')}</div>
        <button className="drawer-item" onClick={() => go(() => setPersonsOpen(true))}>
          <span className="drawer-item-icon"><UserCheckIcon /></span>
          <span>{tr('menu.knownPersons')}</span>
          {persons.length > 0 && <b className="drawer-count mono">{persons.length}</b>}
        </button>

        <button className="drawer-item" onClick={() => go(() => setInsightsOpen(true))}>
          <span className="drawer-item-icon"><SparkleIcon /></span>
          <span>{tr('menu.aiPreferences')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setBatchOpsOpen(true))}>
          <span className="drawer-item-icon"><LayersIcon /></span>
          <span>{tr('menu.batchOps')}</span>
        </button>

        {isNativeMediaLibraryAvailable() && (
          <button className="drawer-item" onClick={() => go(() => setBatchOpsOpen(true))}>
            <span className="drawer-item-icon"><TrashIcon /></span>
            <span>
              {deletableRejectedCount > 0
                ? tr('menu.deleteRejected.withCount', { count: deletableRejectedCount })
                : tr('menu.deleteRejected')}
            </span>
          </button>
        )}

        <button className="drawer-item" onClick={() => go(() => setStatsOpen(true))}>
          <span className="drawer-item-icon"><BarChartIcon /></span>
          <span>{tr('menu.stats')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setContactSheetOpen(true))}>
          <span className="drawer-item-icon"><PrinterIcon /></span>
          <span>{tr('menu.contactSheet')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setPresentationOpen(true))} title={tr('menu.presentation.title')}>
          <span className="drawer-item-icon"><PlayIcon /></span>
          <span>{tr('menu.presentation')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => { setPresentationPhotoIds(selectMonthlyRecap(photos).map(p => p.id)); setPresentationOpen(true); })}
          title={tr('menu.monthlyRecap.title')}
        >
          <span className="drawer-item-icon"><SparkleIcon /></span>
          <span>{tr('menu.monthlyRecap')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setProjectsOpen(true))}>
          <span className="drawer-item-icon"><ListIcon /></span>
          <span>{tr('menu.projects')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setCollectionsOpen(true))}>
          <span className="drawer-item-icon"><FolderIcon /></span>
          <span>{tr('menu.collections')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setTripsOpen(true))}>
          <span className="drawer-item-icon"><PinIcon /></span>
          <span>{tr('menu.trips')}</span>
        </button>

        <label className="drawer-item drawer-item-select" title={tr('menu.genre.title')}>
          <span className="drawer-item-icon"><TagIcon /></span>
          <span>{tr('menu.genre')}</span>
          <select
            className="drawer-select mono"
            value={genre}
            onChange={e => setGenre(e.target.value)}
          >
            <option value="">{tr('menu.genre.none')}</option>
            {GENRE_PRESETS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <div className="drawer-section-label">{tr('menu.section.export')}</div>
        <button className="drawer-item" onClick={() => go(() => void exportManifest())}>
          <span className="drawer-item-icon"><ListIcon /></span>
          <span>{tr('menu.exportManifest')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportSessionReport())} title={tr('menu.exportSessionReport.title')}>
          <span className="drawer-item-icon"><BarChartIcon /></span>
          <span>{tr('menu.exportSessionReport')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportXMP())}>
          <span className="drawer-item-icon"><TagIcon /></span>
          <span>{tr('menu.exportXmp')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => setApplyEditsInGallery(!applyEditsInGallery)}
          aria-pressed={applyEditsInGallery}
          title={tr('menu.applyEditsInGallery.title')}
        >
          <span className="drawer-item-icon"><EditIcon /></span>
          <span>{applyEditsInGallery ? tr('menu.applyEditsInGallery.active') : tr('menu.applyEditsInGallery')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => void exportClientGallery())}
          title={tr('menu.exportClientGallery.title')}
        >
          <span className="drawer-item-icon"><UserCheckIcon /></span>
          <span>{tr('menu.exportClientGallery')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => { setOpen(false); clientFeedbackInputRef.current?.click(); }}
          title={tr('menu.importClientFeedback.title')}
        >
          <span className="drawer-item-icon"><HeartIcon /></span>
          <span>{tr('menu.importClientFeedback')}</span>
        </button>

        <label className="drawer-item drawer-item-select" title={tr('menu.watermark.title')}>
          <span className="drawer-item-icon"><TagIcon /></span>
          <span>{tr('menu.watermark')}</span>
          <input
            type="text"
            className="drawer-text-input mono"
            placeholder={tr('menu.watermark.placeholder')}
            value={watermarkText}
            onChange={e => setWatermarkText(e.target.value)}
            maxLength={40}
          />
        </label>

        <div className="drawer-section-label">{tr('menu.section.backup')}</div>
        <button
          className="drawer-item"
          onClick={() => go(() => void exportBackup())}
          title={tr('menu.exportBackup.title')}
        >
          <span className="drawer-item-icon"><DownloadIcon /></span>
          <span>{tr('menu.exportBackup')}</span>
        </button>
        <button
          className="drawer-item"
          onClick={() => { setOpen(false); restoreInputRef.current?.click(); }}
          title={tr('menu.importBackup.title')}
        >
          <span className="drawer-item-icon"><UploadIcon /></span>
          <span>{tr('menu.importBackup')}</span>
        </button>

        <div className="drawer-section-label">{tr('menu.section.settings')}</div>
        {/* Ciclu pe 3 stari (intunecat -> luminos -> automat -> intunecat), nu doar comutator
            intre 2 — "automat" e o preferinta stocata separat, nu doar un rezultat vizual
            derivat, deci trebuie sa fie o optiune explicit selectabila, nu ceva ce apare
            "din senin" doar din combinarea celorlalte doua. */}
        <button
          className="drawer-item"
          onClick={() => go(() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark'))}
        >
          <span className="drawer-item-icon">{theme === 'light' ? <SunIcon /> : theme === 'auto' ? <ClockIcon /> : <MoonIcon />}</span>
          <span>{theme === 'light' ? tr('menu.theme.light') : theme === 'auto' ? tr('menu.theme.auto') : tr('menu.theme.dark')}</span>
        </button>

        {/* Utilizatorul alege el accentul, in loc sa aleg eu unul singur pentru toata
            lumea — vezi istoricul "Studio Noir" (respins pe telefon real dupa ce fusese
            aprobat doar pe mockup) din comentariul --accent-gradient (styles.css). */}
        <div className="drawer-item drawer-item-accent">
          <span className="drawer-item-icon"><PaletteIcon /></span>
          <span>{tr('menu.accent')}</span>
          <span className="accent-swatches">
            {ACCENT_OPTIONS.map(({ id, gradient }) => (
              <button
                key={id}
                className={accentTheme === id ? 'accent-swatch active' : 'accent-swatch'}
                style={{ background: gradient }}
                onClick={() => setAccentTheme(id)}
                aria-label={tr(`menu.accent.${id}`)}
                aria-pressed={accentTheme === id}
              />
            ))}
          </span>
        </div>

        <button
          className="drawer-item"
          onClick={() => go(() => setLocale(locale === 'ro' ? 'en' : 'ro'))}
          title={tr('menu.language.title')}
        >
          <span className="drawer-item-icon"><GlobeIcon /></span>
          <span>{tr('menu.language')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => setEconomicMode(!economicMode))}
          aria-pressed={economicMode}
          title={tr('menu.economicMode.title')}
        >
          <span className="drawer-item-icon"><BatteryIcon /></span>
          <span>{economicMode ? tr('menu.economicMode.active') : tr('menu.economicMode')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => setGridDensity(nextGridDensity(gridDensity))}
          title={tr('menu.gridDensity.title')}
        >
          <span className="drawer-item-icon"><GridIcon /></span>
          <span>{tr('menu.gridDensity', { density: tr(`menu.gridDensity.${gridDensity}`) })}</span>
        </button>

        <div className="drawer-section-label">{tr('menu.section.help')}</div>
        <button className="drawer-item" onClick={() => go(() => setShortcutsOpen(true))}>
          <span className="drawer-item-icon"><KeyboardIcon /></span>
          <span>{tr('menu.shortcuts')}</span>
        </button>

        {SHOW_NATIVE_TEST_BUTTON && isNativeFaceDetectionAvailable() && isNativeImageAnalysisAvailable() &&
          isNativeImageLabelingAvailable() && isNativeFaceMeshAvailable() && isNativeImageClassifierAvailable() &&
          isNativeTextRecognitionAvailable() && isNativePoseDetectionAvailable() && isNativeSegmentationAvailable() &&
          isNativeImageEmbedderAvailable() && (
          <button className="drawer-item" onClick={() => go(testNativeFaceDetection)}>
            <span className="drawer-item-icon"><SparkleIcon /></span>
            <span>[DEV] Test detectie nativa</span>
          </button>
        )}

        <div className="drawer-sep" />

        <div className="drawer-about">
          <InfoIcon />
          <p>{tr('menu.about')}</p>
        </div>
      </motion.nav>
    </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
