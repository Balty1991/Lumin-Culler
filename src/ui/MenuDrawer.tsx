import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import {
  UserCheckIcon, SparkleIcon, ListIcon, InfoIcon, XIcon, TagIcon, LayersIcon, KeyboardIcon,
  SunIcon, MoonIcon, ClockIcon, BatteryIcon, GridIcon, DownloadIcon, UploadIcon, BarChartIcon, GlobeIcon, PrinterIcon,
  ApertureIcon, PlayIcon, EditIcon, FolderIcon, HeartIcon, TrashIcon, PinIcon, AccessibilityIcon,
  ChevronUpIcon, SearchIcon, ShieldIcon, LockIcon, CopyIcon, StarIcon, FocusIcon, CheckIcon, UndoIcon } from './icons';
import type { AccentTheme } from '../state/accentTheme';
import { selectDeletableRejected } from '../state/batchOps';
import { selectPendingShieldReview, readShieldDismissedIds } from '../core/documentShield';
import { selectUnresolvedGroups } from '../state/duplicateGroups';
import { countDecisionInversions } from '../state/decisionInversions';
import { selectMonthlyRecap } from '../state/monthlyRecap';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { TrainedProfileStrip } from './TrainedProfileStrip';
import { EASE } from './motion';
import { GENRE_PRESETS, readGenreShortlist, writeGenreShortlist } from '../state/genre';
import { nextGridDensity } from '../state/gridDensity';
import { getInstallPromptEvent, subscribeInstallPromptEvent, consumeInstallPromptEvent, isStandalone } from '../core/installPromptEvent';
import { detectFacesNative, isNativeFaceDetectionAvailable } from '../core/nativeFaceDetection';
import { analyzeImageNative, isNativeImageAnalysisAvailable } from '../core/nativeImageAnalysis';
import { labelImageNative, isNativeImageLabelingAvailable } from '../core/nativeImageLabeling';
import { analyzeFaceMeshNative, isNativeFaceMeshAvailable } from '../core/nativeFaceMesh';
import { detectTextNative, isNativeTextRecognitionAvailable } from '../core/nativeTextRecognition';
import { detectPoseNative, isNativePoseDetectionAvailable } from '../core/nativePoseDetection';
import { embedImageNative, isNativeImageEmbedderAvailable } from '../core/nativeImageEmbedder';
import { t } from '../i18n';
import { countRescuable } from '../core/rescueQueue';
import { countNonPersonal } from '../core/smartInbox';
import { buildMomentStacks, countOpenMoments } from '../core/momentStacks';
import { useExactDupeCount } from './useExactDupeCount';

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
    simultan, nu doar cea activa in acest moment (vezi si ui/AppearancePanel.tsx). Vezi :root[data-accent] in styles.css
    pentru valorile reale aplicate. */
const ACCENT_OPTIONS: { id: AccentTheme; gradient: string }[] = [
  { id: 'classic', gradient: 'linear-gradient(135deg, #2dd4bf, #8b5cf6 55%, #6366f1)' },
  { id: 'teal', gradient: 'linear-gradient(135deg, #2dd4bf, #14b8a6)' },
  { id: 'sunset', gradient: 'linear-gradient(135deg, #ff8a5c, #ff5c8a)' },
  { id: 'holo', gradient: 'linear-gradient(90deg, #00fff2, #7a5cff)' }
];

/**
 * Sectiune pliabila a meniului (reorganizare — cerinta directa: "mai lizibila,
 * usor accesibila") — cele ~35 de optiuni erau o singura lista plata, cu doar
 * 5 etichete de sectiune fara nicio grupare vizuala reala. Sectiunile mai rar
 * folosite (Export & backup, Setari) pornesc STRANSE implicit, ca lista
 * vizibila la deschidere sa fie scurta (Organizare + Biblioteca), nu toate
 * cele 35 de randuri deodata. Animatia de (des)stringere e CSS pur
 * (grid-template-rows 0fr->1fr), nu framer-motion — nu are nevoie sa masoare
 * inaltimea continutului in JS, si degradeaza simplu (fara animatie, dar
 * functional) pe motoare mai vechi.
 */
function DrawerGroup(props: {
  label: string; collapsible?: boolean; defaultOpen?: boolean; children: ReactNode;
  expandLabel?: string; collapseLabel?: string;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  /**
   * Continutul unei sectiuni STRANSE nu se randeaza deloc pana la prima ei
   * deschidere.
   *
   * Bug real raportat de utilizator: "cand accesez meniu, apare sacadat".
   * Strangerea era doar vizuala (grid-template-rows: 0fr), deci la fiecare
   * deschidere a sertarului se construiau TOATE randurile din toate sectiunile
   * — inclusiv cele doua stranse implicit, pe care nu le vede nimeni — exact in
   * cadrul in care incepe si animatia de glisare. Munca aia de constructie tine
   * ocupat firul principal, iar animatia pierde primele cadre.
   *
   * Dupa prima deschidere ramane montat, ca strangerea/desfacerea urmatoare sa
   * ramana animatia CSS ieftina de dinainte, fara sa reconstruiasca nimic.
   */
  const [everOpened, setEverOpened] = useState(props.defaultOpen ?? true);
  if (!props.collapsible) {
    return (
      <div className="drawer-group">
        <div className="drawer-section-label">{props.label}</div>
        {props.children}
      </div>
    );
  }
  return (
    <div className="drawer-group">
      <button
        type="button"
        className="drawer-group-head"
        onClick={() => { setOpen(o => !o); setEverOpened(true); }}
        aria-expanded={open}
        aria-label={open ? props.collapseLabel : props.expandLabel}
      >
        <span className="drawer-section-label">{props.label}</span>
        <ChevronUpIcon className="drawer-group-chevron" data-open={open} aria-hidden="true" />
      </button>
      <div className="drawer-group-body" data-open={open}>
        <div className="drawer-group-body-inner">{everOpened ? props.children : null}</div>
      </div>
    </div>
  );
}

/** Meniu lateral: persoane, preferinte AI invatate, export lista, despre. */
export function MenuDrawer() {
  const open = useStore(s => s.menuOpen);
  const setOpen = useStore(s => s.setMenuOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const setBatchOpsOpen = useStore(s => s.setBatchOpsOpen);
  const photos = useStore(s => s.photos);
  const deletableRejectedCount = useMemo(() => selectDeletableRejected(photos).deletable.length, [photos]);
  const hasPhotos = photos.length > 0;
  const setShortcutsOpen = useStore(s => s.setShortcutsOpen);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const accentTheme = useStore(s => s.accentTheme);
  const setAppearanceOpen = useStore(s => s.setAppearanceOpen);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const economicMode = useStore(s => s.economicMode);
  const setEconomicMode = useStore(s => s.setEconomicMode);
  const accessibleMode = useStore(s => s.accessibleMode);
  const setAccessibleMode = useStore(s => s.setAccessibleMode);
  const smartNotificationsEnabled = useStore(s => s.smartNotificationsEnabled);
  const setSmartNotificationsEnabled = useStore(s => s.setSmartNotificationsEnabled);
  const zenMode = useStore(s => s.zenMode);
  const setZenPanelOpen = useStore(s => s.setZenPanelOpen);
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
  const setLocationsOpen = useStore(s => s.setLocationsOpen);
  const setTiktokSortOpen = useStore(s => s.setTiktokSortOpen);
  const setSearchPanelOpen = useStore(s => s.setSearchPanelOpen);
  const setDocumentShieldOpen = useStore(s => s.setDocumentShieldOpen);
  const setVaultOpen = useStore(s => s.setVaultOpen);
  const setDuplicatesPanelOpen = useStore(s => s.setDuplicatesPanelOpen);
  const setRescueQueueOpen = useStore(s => s.setRescueQueueOpen);
  const setSmartInboxOpen = useStore(s => s.setSmartInboxOpen);
  const setMomentsOpen = useStore(s => s.setMomentsOpen);
  const proMode = useStore(s => s.proMode);
  const setGuideOpen = useStore(s => s.setGuideOpen);
  const setProMode = useStore(s => s.setProMode);
  const setExactDupesOpen = useStore(s => s.setExactDupesOpen);
  // Cere o citire din baza de date (dHash nu sta in memorie), deci se face o
  // singura data cand se deschide meniul — nu la fiecare randare.
  const exactDupeCount = useExactDupeCount(open);
  // Contoarele se calculeaza din pozele deja in memorie, fara nicio citire din
  // baza de date: `countRescuable` foloseste doar campurile din PhotoView, iar
  // semnalele fine (highlights/umbre/orizont) se citesc abia la deschiderea
  // panoului. Meniul nu are voie sa coste cat un panou.
  const rescuableCount = useStore(s => countRescuable(s.photos.map(p => ({
    id: p.id, status: p.status, aiScore: p.aiScore, sharpness: p.sharpness,
    exposure: p.exposure, faceCount: p.faceCount, ruleOfThirds: p.ruleOfThirds
  }))));
  const nonPersonalCount = useStore(s => countNonPersonal(s.photos.map(p => ({
    // sceneTags lipsea de aici, deci categoria `object` (ambalaje, aparate,
    // hartii) nu putea fi returnata NICIODATA pe drumul asta — insigna numara
    // doar capturi de ecran si documente. Campul e deja in PhotoView (vezi
    // store.ts), deci nu costa nicio citire din baza de date in plus.
    id: p.id, fileName: p.fileName, faceCount: p.faceCount, textCoverage: p.textCoverage,
    sceneTags: p.sceneTags
  }))));
  // Acelasi principiu: doar ora capturii si statusul, ambele deja in memorie.
  const openMomentCount = useStore(s => countOpenMoments(buildMomentStacks(s.photos.map(p => ({
    id: p.id, capturedAt: p.capturedAt, aiScore: p.aiScore, status: p.status, groupId: p.groupId,
    faceCount: p.faceCount
  })))));
  const openDecisionInversions = useStore(s => s.openDecisionInversions);
  const inversionCount = useStore(s => countDecisionInversions(
    s.photos.map(p => ({ id: p.id, groupId: p.groupId, status: p.status, aiScore: p.aiScore }))
  ));
  const openUncertainReview = useStore(s => s.openUncertainReview);
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);
  const collections = useStore(s => s.collections);
  const shieldPendingCount = useMemo(() => {
    const vaultIds = new Set(collections.find(c => c.isPrivate)?.memberIds ?? []);
    return selectPendingShieldReview(photos, vaultIds, readShieldDismissedIds()).length;
  }, [photos, collections]);
  const duplicateGroupCount = useMemo(() => selectUnresolvedGroups(photos).length, [photos]);
  const persons = useStore(s => s.persons);
  const askConfirm = useStore(s => s.askConfirm);
  const clearAllIncludingPersons = useStore(s => s.clearAllIncludingPersons);
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
    // "Automat" tine cont acum si de setarea de sistem (prefers-color-scheme —
    // vezi resolveTheme din state/theme.ts), care se poate schimba in orice
    // clipa, nu doar la un prag orar: pe Android/iOS tema intunecata poate fi
    // programata sa se activeze la apus sau comutata manual din centrul de
    // notificari. Fara acest abonament, aplicatia ar ramane pe tema veche pana
    // la urmatoarea bifa de 15 minute — vizibil gresita, chiar langa restul
    // sistemului deja comutat.
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onSystemChange = () => setTheme('auto');
    media?.addEventListener('change', onSystemChange);
    return () => {
      clearInterval(id);
      media?.removeEventListener('change', onSystemChange);
    };
  }, [theme, setTheme]);
  // Acelasi eveniment beforeinstallprompt ca InstallPrompt.tsx (citit dintr-un modul
  // comun, nu recaptat aici) — ramane accesibil din Meniu chiar dupa ce bannerul a
  // fost inchis, ca "nu mai arata asta" sa nu insemne "nu mai pot instala niciodata".
  const installEvent = useSyncExternalStore(subscribeInstallPromptEvent, getInstallPromptEvent);

  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  // Lista scurta se tine in stare locala ca pastilele sa raspunda imediat la
  // atingere; readGenreShortlist() e sursa la deschiderea meniului.
  const [genrePicks, setGenrePicks] = useState<string[]>(() => readGenreShortlist());
  const genreShortlist = genrePicks;
  const groupByPeople = useStore(s => s.groupByPeople);
  const setGroupByPeople = useStore(s => s.setGroupByPeople);
  const go = (action: () => void) => { setOpen(false); action(); };

  /** Cele DOUA confirmari sunt pastrate intacte din panoul Persoane: e singura
      actiune din aplicatie de pe urma careia nu se mai poate reveni in niciun fel. */
  const confirmClearEverything = async () => {
    if (!(await askConfirm(tr('persons.confirmClearEverything1'), { danger: true }))) return;
    if (!(await askConfirm(tr('persons.confirmClearEverything2'), { danger: true }))) return;
    void clearAllIncludingPersons();
  };
  /**
   * Doar INSIGNA. Blocarea efectiva sta in store (gatePremium), pentru ca
   * aceleasi functii au si alte intrari — ecranul Acasa, foaia de export,
   * paleta de comenzi — iar o poarta pusa pe butoane lasa portite.
   *
   * Randul ramane vizibil si apasabil: duce la ecranul Premium, nu la un refuz.
   * Un utilizator care nu stie ce pierde n-are de ce sa plateasca.
   */
  // Din store, nu din entitlement.ts direct: acolo raspunsul e sincron, deci
  // React nu afla ca s-a schimbat. Bug real — cine tocmai cumparase
  // abonamentul ramanea cu lacatele pe randuri. Vezi AppState.premiumLocked.
  const premiumLocked = useStore(s => s.premiumLocked);
  const premium = useStore(s => s.premium);
  const lockBadge = premiumLocked ? <StarIcon className="drawer-item-lock" aria-hidden="true" /> : null;

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
      // SECVENTIAL, nu Promise.all — bug real gasit la testare pe device: toate
      // modelele grele (ML Kit + TFLite + MediaPipe) incarcate/rulate deodata
      // au impins telefonul in lipsa de memorie si l-au facut sa inchida
      // aplicatia (crash nativ, fara nicio eroare JS prinsa). Rulate pe rand,
      // varful de memorie ramane mult mai mic — mai lent per total, dar
      // arata si EXACT la ce pas se opreste, daca tot mai crapa ceva
      // (ultimul mesaj ramas pe ecran = ultimul modul pornit).
      void (async () => {
        const steps: Array<[string, () => Promise<unknown>]> = [
          ['fete (ML Kit)', () => detectFacesNative({ blob: file })],
          ['compozitie/claritate/culoare', () => analyzeImageNative({ blob: file })],
          ['etichete de scena (ML Kit)', () => labelImageNative({ blob: file })],
          ['fata detaliata (MediaPipe)', () => analyzeFaceMeshNative({ blob: file })],
          ['text (OCR)', () => detectTextNative({ blob: file })],
          ['postura corp', () => detectPoseNative({ blob: file })],
          ['embedding similaritate', () => embedImageNative({ blob: file })]
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
        setNotice(`Native OK (toate ${steps.length} module): ${JSON.stringify(results)}`);
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

        {/* Cat te cunoaste motorul, inaintea cardului Premium — ordinea din
            build-ul de referinta. Se arata singura doar peste 15 decizii. */}
        <TrainedProfileStrip onAction={() => setOpen(false)} />

        {/* TREI stari, nu doua. "Nimic nu e blocat" si "esti abonat" erau
            acelasi lucru pentru cardul asta (doar `!premiumLocked`), si pe web —
            unde nimic nu e blocat pentru ca NU EXISTA cale de plata — cardul
            anunta "Planul tau Premium este activ". Adica ii spunea omului ca are
            un abonament platit pe care nu-l are. Gasit in feedbackul de produs,
            si e o afirmatie falsa, nu doar o formulare nefericita. */}
        <button
          className={premiumLocked ? 'drawer-pro-card' : 'drawer-pro-card is-active'}
          onClick={() => go(() => setPremiumOpen(true))}
        >
          <span className="drawer-pro-icon"><StarIcon /></span>
          <span className="drawer-pro-copy">
            <em className="mono">{tr(premiumLocked ? 'menu.pro.label' : premium ? 'menu.pro.label.active' : 'menu.pro.label.preview')}</em>
            <b>{tr(premiumLocked ? 'menu.pro.locked' : premium ? 'menu.pro.active' : 'menu.pro.preview')}</b>
          </span>
          {premiumLocked
            ? <span className="drawer-pro-action mono">{tr('menu.pro.action')}</span>
            : <span className="drawer-pro-check" aria-hidden="true"><CheckIcon /></span>}
        </button>

        {!isStandalone() && (
          <>
            <button className="drawer-item" onClick={() => go(() => void installApp())}>
              <span className="drawer-item-icon"><ApertureIcon /></span>
              <span>{tr('menu.installApp')}</span>
            </button>
            <div className="drawer-sep" />
          </>
        )}

        {/* Reorganizare dupa feedback direct ("prea incarcat, si texte si
            vizual"): meniul avea ~35 de randuri identice, in 5 grupuri, si le
            arata pe TOATE inca de la prima deschidere, cu galeria goala — cand
            majoritatea nu puteau face nimic (statistici fara poze, export fara
            selectie, duplicate fara ce compara). Acum randurile care au nevoie
            de poze apar doar cand exista poze: pe un cont nou meniul e de 3-4
            ori mai scurt, iar ce ramane e chiar ce poti folosi. Nimic nu s-a
            pierdut — reapar toate dupa primul import. */}
        {hasPhotos && (
          <div className="drawer-quick-row">
            <button className="drawer-quick-btn" onClick={() => go(() => setTiktokSortOpen(true))} title={tr('menu.tiktokSort.title')}>
              <ChevronUpIcon aria-hidden="true" />
              <span>{tr('menu.quickSort')}</span>
            </button>
            <button className="drawer-quick-btn" onClick={() => go(() => setSearchPanelOpen(true))}>
              <SearchIcon aria-hidden="true" />
              <span>{tr('menu.quickSearch')}</span>
            </button>
          </div>
        )}

        <DrawerGroup label={tr('menu.section.workspace')} collapsible defaultOpen={false} expandLabel={tr('menu.expandSection', { section: tr('menu.section.workspace') })} collapseLabel={tr('menu.collapseSection', { section: tr('menu.section.workspace') })}>
          <button className="drawer-item" onClick={() => go(() => setPersonsOpen(true))}>
            <span className="drawer-item-icon"><UserCheckIcon /></span>
            <span>{tr('menu.knownPersons')}</span>
            {persons.length > 0 && <b className="drawer-count mono">{persons.length}</b>}
          </button>

          {isNativeMediaLibraryAvailable() && (
            <button className="drawer-item" onClick={() => go(() => setSupervisorPanelOpen(true))}>
              <span className="drawer-item-icon"><ClockIcon /></span>
              <span>{tr('menu.gallerySupervisor')}</span>
            </button>
          )}

          <button className="drawer-item" onClick={() => go(() => setVaultOpen(true))}>
            <span className="drawer-item-icon"><LockIcon /></span>
            <span>{tr('menu.vault')}</span>
            {lockBadge}
          </button>

          {hasPhotos && (
            <>
              <button className="drawer-item" onClick={() => go(() => setCollectionsOpen(true))}>
                <span className="drawer-item-icon"><FolderIcon /></span>
                <span>{tr('menu.collections')}</span>
              </button>

              {proMode && (
                <button className="drawer-item" onClick={() => go(() => setProjectsOpen(true))}>
                  <span className="drawer-item-icon"><ListIcon /></span>
                  <span>{tr('menu.projects')}</span>
                </button>
              )}

              {proMode && (
                <button className="drawer-item" onClick={() => go(() => setLocationsOpen(true))}>
                  <span className="drawer-item-icon"><PinIcon /></span>
                  <span>{tr('menu.locations')}</span>
                  {lockBadge}
                </button>
              )}

              {/* Nu mai e in spatele Modului profesional. Genul prefixeaza
                  contextKey (ContextEngine.deriveContextKey), deci antreneaza
                  modele separate per gen — adica exact lucrul de care are nevoie
                  un incepator la fel de mult ca un profesionist. Ascuns dupa un
                  comutator oprit implicit, in plus intr-o sectiune pliata, nu-l
                  gasea si nu-l seta nimeni: motorul primea `undefined` la
                  fiecare import si invata un singur model pentru tot. */}
              <label className="drawer-item drawer-item-select" title={tr('menu.genre.title')}>
                  <span className="drawer-item-icon"><TagIcon /></span>
                  <span>{tr('menu.genre')}</span>
                  <select
                    className="drawer-select mono"
                    value={genre}
                    onChange={e => setGenre(e.target.value)}
                  >
                    <option value="">{tr('menu.genre.none')}</option>
                    {/* Ce a ales omul pe Acasa vine primul, si separat: cine
                        fotografiaza familie si munca isi comuta genul des, si
                        n-are de ce sa caute de fiecare data prin paisprezece
                        optiuni. Vezi readGenreShortlist in state/genre.ts. */}
                    {genreShortlist.length > 0 && (
                      <optgroup label={tr('menu.genre.mine')}>
                        {genreShortlist.map(g => <option key={'mine-' + g} value={g}>{g}</option>)}
                      </optgroup>
                    )}
                    <optgroup label={tr('menu.genre.all')}>
                      {GENRE_PRESETS.map(g => <option key={g} value={g}>{g}</option>)}
                    </optgroup>
                  </select>
                </label>

              {/* "Genurile mele" — alegerea multipla, mutata aici de pe ecranul
                  de start. Cerinta utilizatorului, care avea dreptate de doua
                  ori: pe Acasa aparea ca o intrebare peste tot, inainte sa fi
                  triat ceva (deci se raspundea la ghici), si o data raspunsa nu
                  se mai putea reface. Aici e o setare: o deschizi cand vrei, o
                  schimbi cand vrei.

                  Ce fac cele alese: raman lista scurta din capul selectorului
                  de mai sus. NU se amesteca intre ele — genul prefixeaza
                  contextKey, deci activ ramane unul singur, iar restul sunt
                  doar la o atingere distanta. Exact grija pe care a avut-o
                  utilizatorul: "ca sa nu amestece genurile". */}
              <div className="drawer-item drawer-item-block">
                <span className="drawer-item-icon"><TagIcon /></span>
                <span>{tr('menu.genre.mine')}</span>
                <p className="drawer-item-note">{tr('menu.genre.mine.why')}</p>
                <div className="drawer-genre-opts" role="group" aria-label={tr('menu.genre.mine')}>
                  {GENRE_PRESETS.map(g => {
                    const picked = genrePicks.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        className={picked ? 'chip drawer-genre-chip active' : 'chip drawer-genre-chip'}
                        aria-pressed={picked}
                        onClick={() => {
                          const next = picked ? genrePicks.filter(x => x !== g) : [...genrePicks, g];
                          setGenrePicks(next);
                          writeGenreShortlist(next);
                          // Daca genul activ tocmai a iesit din lista, sau nu era
                          // niciunul, se alege primul ramas — altfel selectorul de
                          // deasupra ar arata un gen pe care omul l-a scos.
                          if (!next.includes(genre)) setGenre(next[0] ?? '');
                        }}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </DrawerGroup>

        {hasPhotos && (
          <DrawerGroup label={tr('menu.section.cleanup')} collapsible defaultOpen={false} expandLabel={tr('menu.expandSection', { section: tr('menu.section.cleanup') })} collapseLabel={tr('menu.collapseSection', { section: tr('menu.section.cleanup') })}>
            {/* Primul din grup, deliberat: e cel mai scurt lucru util pe care il
                poti face dupa un import — cateva secunde care verifica exact
                deciziile la limita si, in acelasi timp, invata motorul cel mai
                repede (vezi core/uncertainty.ts). */}
            <button className="drawer-item" onClick={() => go(() => { void openUncertainReview(); })}>
              <span className="drawer-item-icon"><FocusIcon /></span>
              <span>{tr('menu.uncertainReview')}</span>
            </button>

            {/* Imediat dupa verificarea deciziilor la limita, fiindca raspunde
                la o intrebare vecina: acolo "unde nu stiu sigur eu", aici "unde
                pare ca ai apasat gresit". Se arata doar cand chiar exista ceva
                de aratat — un rand care spune mereu zero e doar zgomot. */}
            {inversionCount > 0 && (
              <button className="drawer-item" onClick={() => go(() => { void openDecisionInversions(); })}>
                <span className="drawer-item-icon"><UndoIcon /></span>
                <span>{tr('menu.decisionInversions')}</span>
                <b className="drawer-count mono">{inversionCount}</b>
              </button>
            )}

            <button className="drawer-item" onClick={() => go(() => setRescueQueueOpen(true))}>
              <span className="drawer-item-icon"><SparkleIcon /></span>
              <span>{tr('menu.rescueQueue')}</span>
              {rescuableCount > 0 && <b className="drawer-count mono">{rescuableCount}</b>}
            </button>

            <button className="drawer-item" onClick={() => go(() => setExactDupesOpen(true))}>
              <span className="drawer-item-icon"><CopyIcon /></span>
              <span>{tr('menu.exactDupes')}</span>
              {exactDupeCount > 0 && <b className="drawer-count mono">{exactDupeCount}</b>}
            </button>

            <button className="drawer-item" onClick={() => go(() => setMomentsOpen(true))}>
              <span className="drawer-item-icon"><ClockIcon /></span>
              <span>{tr('menu.moments')}</span>
              {openMomentCount > 0 && <b className="drawer-count mono">{openMomentCount}</b>}
            </button>

            <button className="drawer-item" onClick={() => go(() => setSmartInboxOpen(true))}>
              <span className="drawer-item-icon"><CopyIcon /></span>
              <span>{tr('menu.smartInbox')}</span>
              {nonPersonalCount > 0 && <b className="drawer-count mono">{nonPersonalCount}</b>}
            </button>

            <button className="drawer-item" onClick={() => go(() => setDuplicatesPanelOpen(true))}>
              <span className="drawer-item-icon"><CopyIcon /></span>
              <span>{tr('menu.duplicates')}</span>
              {duplicateGroupCount > 0 && <b className="drawer-count mono">{duplicateGroupCount}</b>}
            </button>

            <button className="drawer-item" onClick={() => go(() => setDocumentShieldOpen(true))}>
              <span className="drawer-item-icon"><ShieldIcon /></span>
              <span>{tr('menu.documentShield')}</span>
              {shieldPendingCount > 0 && <b className="drawer-count mono">{shieldPendingCount}</b>}
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

            <button className="drawer-item" onClick={() => go(() => setBatchOpsOpen(true))}>
              <span className="drawer-item-icon"><LayersIcon /></span>
              <span>{tr('menu.batchOps')}</span>
            </button>
          </DrawerGroup>
        )}

        {hasPhotos && (
          <DrawerGroup label={tr('menu.section.library')} collapsible defaultOpen={false} expandLabel={tr('menu.expandSection', { section: tr('menu.section.library') })} collapseLabel={tr('menu.collapseSection', { section: tr('menu.section.library') })}>
            <button className="drawer-item" onClick={() => go(() => setStatsOpen(true))}>
              <span className="drawer-item-icon"><BarChartIcon /></span>
              <span>{tr('menu.stats')}</span>
            </button>

            <button className="drawer-item" onClick={() => go(() => setInsightsOpen(true))}>
              <span className="drawer-item-icon"><SparkleIcon /></span>
              <span>{tr('menu.aiPreferences')}</span>
            </button>

            <button
              className="drawer-item"
              onClick={() => go(() => { setPresentationPhotoIds(selectMonthlyRecap(photos).map(p => p.id)); setPresentationOpen(true); })}
              title={tr('menu.monthlyRecap.title')}
            >
              <span className="drawer-item-icon"><SparkleIcon /></span>
              <span>{tr('menu.monthlyRecap')}</span>
              {lockBadge}
            </button>

            <button className="drawer-item" onClick={() => go(() => setPresentationOpen(true))} title={tr('menu.presentation.title')}>
              <span className="drawer-item-icon"><PlayIcon /></span>
              <span>{tr('menu.presentation')}</span>
              {lockBadge}
            </button>

            {proMode && (
              <button className="drawer-item" onClick={() => go(() => setContactSheetOpen(true))}>
                <span className="drawer-item-icon"><PrinterIcon /></span>
                <span>{tr('menu.contactSheet')}</span>
                {lockBadge}
              </button>
            )}
          </DrawerGroup>
        )}

        <DrawerGroup
          label={tr('menu.section.exportBackup')}
          collapsible
          defaultOpen={false}
          expandLabel={tr('menu.expandSection', { section: tr('menu.section.exportBackup') })}
          collapseLabel={tr('menu.collapseSection', { section: tr('menu.section.exportBackup') })}
        >
          {/* Fara nicio poza, tot ce se poate exporta e gol — ramane doar
              restaurarea, singura care ARE sens pe o biblioteca goala (e chiar
              felul in care iti aduci datele inapoi). */}
          {hasPhotos && (
            <>
              {proMode && (
                <button className="drawer-item" onClick={() => go(() => void exportManifest())}>
                  <span className="drawer-item-icon"><ListIcon /></span>
                  <span>{tr('menu.exportManifest')}</span>
                </button>
              )}

              {proMode && (
                <button className="drawer-item" onClick={() => go(() => void exportSessionReport())} title={tr('menu.exportSessionReport.title')}>
                  <span className="drawer-item-icon"><BarChartIcon /></span>
                  <span>{tr('menu.exportSessionReport')}</span>
                </button>
              )}

              {proMode && (
                <button className="drawer-item" onClick={() => go(() => void exportXMP())}>
                  <span className="drawer-item-icon"><TagIcon /></span>
                  <span>{tr('menu.exportXmp')}</span>
                  {lockBadge}
                </button>
              )}

              <button
                className="drawer-item"
                onClick={() => setApplyEditsInGallery(!applyEditsInGallery)}
                aria-pressed={applyEditsInGallery}
                title={tr('menu.applyEditsInGallery.title')}
              >
                <span className="drawer-item-icon"><EditIcon /></span>
                <span>{applyEditsInGallery ? tr('menu.applyEditsInGallery.active') : tr('menu.applyEditsInGallery')}</span>
              </button>

              {proMode && (
                <button
                  className="drawer-item"
                  onClick={() => go(() => void exportClientGallery())}
                  title={tr('menu.exportClientGallery.title')}
                >
                  <span className="drawer-item-icon"><UserCheckIcon /></span>
                  <span>{tr('menu.exportClientGallery')}</span>
                </button>
              )}

              {proMode && (
                <button
                  className="drawer-item"
                  onClick={() => { setOpen(false); clientFeedbackInputRef.current?.click(); }}
                  title={tr('menu.importClientFeedback.title')}
                >
                  <span className="drawer-item-icon"><HeartIcon /></span>
                  <span>{tr('menu.importClientFeedback')}</span>
                </button>
              )}

              {proMode && (
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
              )}

              <div className="drawer-sep" />

              <button
                className="drawer-item"
                onClick={() => go(() => void exportBackup())}
                title={tr('menu.exportBackup.title')}
              >
                <span className="drawer-item-icon"><DownloadIcon /></span>
                <span>{tr('menu.exportBackup')}</span>
              </button>
            </>
          )}
          <button
            className="drawer-item"
            onClick={() => { setOpen(false); restoreInputRef.current?.click(); }}
            title={tr('menu.importBackup.title')}
          >
            <span className="drawer-item-icon"><UploadIcon /></span>
            <span>{tr('menu.importBackup')}</span>
          </button>
        </DrawerGroup>

        <DrawerGroup
          label={tr('menu.section.settings')}
          collapsible
          defaultOpen={false}
          expandLabel={tr('menu.expandSection', { section: tr('menu.section.settings') })}
          collapseLabel={tr('menu.collapseSection', { section: tr('menu.section.settings') })}
        >
          {/* Tema si accentul au acum un ecran propriu (ui/AppearancePanel.tsx,
              mockup 15+16): aici erau un buton care CICLA prin cele 3 teme — nu
              vedeai niciodata ce optiuni exista, doar pe cea curenta — si un rand
              de pastile de 22px, fara nume si fara efect vizibil pana inchideai
              meniul. Randul de aici ramane doar ca punct de intrare, si arata
              starea curenta (iconita temei + accentul activ). */}
          <button className="drawer-item" onClick={() => go(() => setAppearanceOpen(true))}>
            <span className="drawer-item-icon">{theme === 'light' ? <SunIcon /> : theme === 'auto' ? <ClockIcon /> : <MoonIcon />}</span>
            <span>{tr('menu.accent')}</span>
            <span
              className="drawer-accent-dot"
              style={{ background: ACCENT_OPTIONS.find(a => a.id === accentTheme)?.gradient }}
              aria-hidden="true"
            />
          </button>

          <button
            className="drawer-item"
            onClick={() => go(() => setLocale(locale === 'ro' ? 'en' : 'ro'))}
            title={tr('menu.language.title')}
          >
            <span className="drawer-item-icon"><GlobeIcon /></span>
            <span>{tr('menu.language')}</span>
          </button>

          {/* Comutatorul care decide daca meniul arata si uneltele de dupa triaj.
              Oprit implicit — vezi state/proMode.ts. Nu inchide sertarul (fara
              `go`): utilizatorul trebuie sa VADA meniul schimbandu-se sub
              deget, altfel n-are cum sa priceapa ce a facut butonul. */}
          <button
            className="drawer-item"
            onClick={() => setProMode(!proMode)}
            aria-pressed={proMode}
            title={tr('menu.proMode.title')}
          >
            <span className="drawer-item-icon"><FocusIcon /></span>
            <span>{tr('menu.proMode')}</span>
            <b className="drawer-count mono">{tr(proMode ? 'menu.proMode.on' : 'menu.proMode.off')}</b>
          </button>

          {/* Randul nu e un comutator, ci deschide un panou — deci `aria-pressed`
              (care promitea unui cititor de ecran ca apasarea porneste ceva)
              era o minciuna; `aria-haspopup` spune ce se intampla de fapt.
              Starea se vede acum pe rand, ca la Mod profesional: pana acum
              trebuia sa deschizi panoul ca sa afli daca e pornit. */}
          <button
            className="drawer-item"
            onClick={() => go(() => setZenPanelOpen(true))}
            aria-haspopup="dialog"
            title={tr('menu.zenMode.title')}
          >
            <span className="drawer-item-icon"><SparkleIcon /></span>
            <span>{tr('menu.zenMode')}</span>
            <b className="drawer-count mono">{tr(zenMode ? 'menu.proMode.on' : 'menu.proMode.off')}</b>
          </button>

          <button
            className="drawer-item"
            onClick={() => go(() => setAccessibleMode(!accessibleMode))}
            aria-pressed={accessibleMode}
            title={tr('menu.accessibleMode.title')}
          >
            <span className="drawer-item-icon"><AccessibilityIcon /></span>
            <span>{accessibleMode ? tr('menu.accessibleMode.active') : tr('menu.accessibleMode')}</span>
          </button>

          {/* Fara `go`, ca la Mod profesional: un comutator care inchide sertarul
              nu-si arata niciodata starea noua, si pare ca n-a facut nimic.
              Raspunsul concret vine din setSmartNotificationsEnabled (store),
              care spune si cand sistemul blocheaza notificarile — cazul in care
              comutatorul chiar nu putea face nimic, si nimeni nu spunea de ce. */}
          <button
            className="drawer-item"
            onClick={() => setSmartNotificationsEnabled(!smartNotificationsEnabled)}
            aria-pressed={smartNotificationsEnabled}
            title={tr('menu.smartNotifications.title')}
          >
            <span className="drawer-item-icon"><InfoIcon /></span>
            <span>{tr('menu.smartNotifications')}</span>
            <b className="drawer-count mono">{tr(smartNotificationsEnabled ? 'menu.proMode.on' : 'menu.proMode.off')}</b>
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

          {/* Gruparea din "Toate". Nu se ofera cand n-ai inrolat pe nimeni: acolo
              comutatorul n-ar schimba nimic, si un comutator care nu face nimic
              e mai rau decat unul lipsa. */}
          {persons.length > 0 && (
            <button
              className="drawer-item"
              onClick={() => setGroupByPeople(!groupByPeople)}
              aria-pressed={groupByPeople}
              title={tr('menu.groupByPeople.title')}
            >
              <span className="drawer-item-icon"><UserCheckIcon /></span>
              <span>{tr('menu.groupByPeople')}</span>
              <b className="drawer-count mono">{tr(groupByPeople ? 'menu.proMode.on' : 'menu.proMode.off')}</b>
            </button>
          )}

          {hasPhotos && (
            <button
              className="drawer-item"
              onClick={() => setGridDensity(nextGridDensity(gridDensity))}
              title={tr('menu.gridDensity.title')}
            >
              <span className="drawer-item-icon"><GridIcon /></span>
              <span>{tr('menu.gridDensity', { density: tr(`menu.gridDensity.${gridDensity}`) })}</span>
            </button>
          )}

          {/* Mutat aici din panoul Persoane, unde statea la un deget distanta de
              "Inroleaza" si de lista de oameni. Sterge TOT: pozele, profilurile,
              tot ce e local. In panoul Persoane numele lui era "Sterge tot" —
              langa o lista de persoane, asta se citea ca "sterge persoanele",
              ceea ce e cea mai mica parte din ce face. Aici are numele intreg,
              sta ultimul in Setari, si pastreaza cele DOUA confirmari. */}
          <button
            className="drawer-item drawer-item-danger"
            onClick={() => go(() => void confirmClearEverything())}
            title={tr('menu.clearEverything.title')}
          >
            <span className="drawer-item-icon"><TrashIcon /></span>
            <span>{tr('menu.clearEverything')}</span>
          </button>
        </DrawerGroup>

        <DrawerGroup label={tr('menu.section.help')} collapsible defaultOpen={false} expandLabel={tr('menu.expandSection', { section: tr('menu.section.help') })} collapseLabel={tr('menu.collapseSection', { section: tr('menu.section.help') })}>
          <button
            className="drawer-item"
            onClick={() => go(() => setGuideOpen(true))}
            title={tr('guide.title')}
          >
            <span className="drawer-item-icon"><InfoIcon /></span>
            <span>{tr('guide.title')}</span>
          </button>

          <button className="drawer-item" onClick={() => go(() => setShortcutsOpen(true))}>
            <span className="drawer-item-icon"><KeyboardIcon /></span>
            <span>{tr('menu.shortcuts')}</span>
          </button>

          <button className="drawer-item" onClick={() => go(() => setPremiumOpen(true))}>
            <span className="drawer-item-icon"><StarIcon /></span>
            <span>{tr('premium.title')}</span>
          </button>

          {SHOW_NATIVE_TEST_BUTTON && isNativeFaceDetectionAvailable() && isNativeImageAnalysisAvailable() &&
            isNativeImageLabelingAvailable() && isNativeFaceMeshAvailable() &&
            isNativeTextRecognitionAvailable() && isNativePoseDetectionAvailable() &&
            isNativeImageEmbedderAvailable() && (
            <button className="drawer-item" onClick={() => go(testNativeFaceDetection)}>
              <span className="drawer-item-icon"><SparkleIcon /></span>
              <span>[DEV] Test detectie nativa</span>
            </button>
          )}
        </DrawerGroup>

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
