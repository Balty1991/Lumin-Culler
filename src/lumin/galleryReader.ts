import { jankSpan } from '../core/jankLog';
import { crashSkippedUris } from '../core/crashGuard';
import { quizReady } from './quizReady';
import { getPhotosAccess, isNativeMediaLibraryAvailable, listPhotosInRange, readPhotoFiles } from '../core/nativeMediaLibrary';
import { useStore } from '../state/store';
import { useLx } from './lxStore';
import { t } from '../i18n';
import { analysisPool } from '../core/workerPool';
import { userActive } from '../core/userIdle';
import { autoNameFaces, canEmbedFaces, embedMissingFaces } from './faceIdentity';
import { holdRejectsUntilTrained, holdUntilLearned, trainedEnough } from './trainingGate';
import { readTasteQuizDone } from '../state/tasteQuiz';
import { holdBackgroundAnalysis, releaseBackgroundAnalysis, updateHeldBackground } from '../core/backgroundAnalysis';

/**
 * lumin/galleryReader.ts
 * Lumi citește TOATĂ galeria, singură, în fundal: de la cele mai noi poze spre
 * cele vechi, câte un pachet mic, cu pauze. Omul vede imediat zilele recente
 * (primele pachete) și poate folosi aplicația cât timp restul se citește.
 *
 * De ce nu dintr-odată: 1.300 de poze țineau ~10 minute de ecran blocat și
 * toate fișierele în memorie. Așa: lista întâi (ieftină), apoi doar ce lipsește,
 * 24 de poze odată. Pauză cu bateria sub 20% (fără încărcător) și cât aplicația
 * e în spate; data viitoare continuă de unde a rămas — ce e citit nu se recitește.
 */
/**
 * Pozele dintr-un pachet. Fiecare import are și o parte fixă (seriile, momentele,
 * reclasificarea pe toată biblioteca), deci pachetele mai mari merg mai repede pe
 * total; dar fișierele pachetului stau în memorie, deci doar pe telefoanele cu 6 GB+.
 */
const MEMORY_GB = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
/** Pachete mai mari = mai puține treceri fixe pe toată biblioteca, deci mai repede pe total. */
const CHUNK = MEMORY_GB >= 6 ? 64 : MEMORY_GB >= 4 ? 40 : 24;
/** Primul pachet e mic: primele poze apar pe Azi în câteva secunde, nu după un minut. */
const FIRST_CHUNK = 8;
/**
 * Câte poze are pachetul care începe la `i`. Al doilea pachet e cel mult 32, ca
 * primele ~40 de poze să fie gata repede: acolo citirea face pauza de antrenament.
 */
export function chunkSizeAt(i: number, chunk = CHUNK): number {
  return i === 0 ? FIRST_CHUNK : i === FIRST_CHUNK ? Math.min(chunk, 32) : chunk;
}

/**
 * Pauza de antrenament (cerut: „după ce încarcă 30–40 de poze să facă o pauză și
 * să te pună să îl antrenezi”). O singură dată; omul poate continua și fără.
 */
const TRAIN_PAUSE_AT = 30;
const TRAIN_OFFERED_KEY = 'cherrypic.reader.trainOffered';
let skipTraining = false;
export function continueWithoutTraining(): void { skipTraining = true; }
function trainingOffered(): boolean {
  try { return localStorage.getItem(TRAIN_OFFERED_KEY) === '1'; } catch { return true; }
}
/**
 * „Prima privire”: la prima pornire se citesc doar cele mai noi ~150 de poze, la viteză
 * maximă, ca omul să vadă în 2–3 minute ce face aplicația (alese, serii, neclare, editorul,
 * antrenamentul). Restul galeriei pornește abia când apasă „Analizează toată galeria”.
 * Cerut: „un utilizator nou nu știe ce se întâmplă, poate crede că nu merge”.
 */
export const SAMPLE_SIZE = 150;
const SAMPLE_DONE_KEY = 'cp.sample.done';
const FULL_KEY = 'cp.sample.full';
const SAMPLE_RESULT_KEY = 'cp.sample.result';
/** Rezultatul primei priviri, și după repornirea aplicației (până pornește citirea întreagă). */
export function storedSampleResult(): { ids: string[]; left: number } | null {
  if (!sampleDone() || fullReadAccepted()) return null;
  try { return JSON.parse(localStorage.getItem(SAMPLE_RESULT_KEY) ?? 'null') as { ids: string[]; left: number } | null; } catch { return null; }
}
function flag(k: string): boolean { try { return localStorage.getItem(k) === '1'; } catch { return true; } }
function setFlag(k: string): void { try { localStorage.setItem(k, '1'); } catch { /* fără stocare */ } }
export function sampleDone(): boolean { return flag(SAMPLE_DONE_KEY); }
export function fullReadAccepted(): boolean { return flag(FULL_KEY); }
/** Mărimea primei priviri: doar pentru o bibliotecă nouă și o galerie destul de mare. */
export function sampleLimit(known: number, missing: number): number | null {
  if (known >= 50 || missing <= SAMPLE_SIZE + 50) return null;
  return SAMPLE_SIZE;
}
/** „Analizează toată galeria”, după prima privire. */
export function startFullRead(): Promise<void> {
  setFlag(FULL_KEY);
  return readWholeGallery(true);
}
const ANNOUNCED_KEY = 'lumin-gallery-read-announced';
let running = false;
/** „Continuă acum”: omul a ales să nu aștepte încărcătorul (până la următoarea pornire). */
let ignoreBattery = false;
export function continueOnLowBattery(): void { ignoreBattery = true; }

/**
 * „Oprește”: omul nu vrea acum citirea galeriei. Se oprește pachetul în curs
 * (ce s-a analizat deja rămâne) și NU mai pornește singură la deschidere, până
 * apasă „Continuă citirea” (sau „Sortează tot”). Ținut minte între porniri.
 */
const STOPPED_KEY = 'lumin-gallery-read-stopped';
let stopRequested = false;
export function readerStopped(): boolean {
  try { return localStorage.getItem(STOPPED_KEY) === '1'; } catch { return false; }
}
export function stopGalleryReader(): void {
  stopRequested = true;
  try { localStorage.setItem(STOPPED_KEY, '1'); } catch { /* fără stocare */ }
  if (running) useStore.getState().cancelImport();
}
/**
 * A pornit omul măcar o dată citirea galeriei (butonul de la început, „Sortează tot”,
 * „Continuă citirea”)? Până atunci nimic nu citește singur — raportat de două ori:
 * „am dat mai târziu, dar tot încarcă singur niște poze”. Cine are deja poze în
 * aplicație (de dinainte de regula asta) e socotit pornit.
 */
const STARTED_KEY = 'lumin-gallery-read-started';
export function readerStarted(): boolean {
  try { return localStorage.getItem(STARTED_KEY) === '1'; } catch { return true; }
}
/** La pornire: biblioteca de dinainte de regula asta (poze deja citite, citirea neoprită) contează ca pornită. */
export function markReaderStartedIfLegacy(): void {
  try {
    if (localStorage.getItem(STARTED_KEY) || readerStopped()) return;
    if (useStore.getState().photos.length > 0) localStorage.setItem(STARTED_KEY, '1');
  } catch { /* fără stocare */ }
}
/** Pornește din nou, la cererea omului. */
export function resumeGalleryReader(): Promise<void> {
  try { localStorage.removeItem(STOPPED_KEY); } catch { /* fără stocare */ }
  return readWholeGallery(true);
}

async function placeFaces(): Promise<void> {
  try {
    const made = await embedMissingFaces((d, total) => useLx.getState().setFaceProgress({ done: d, total }));
    useLx.getState().setFaceProgress(null);
    const named = await autoNameFaces().catch(() => 0);
    if (made || named) useLx.getState().bumpFaces();
  } catch {
    useLx.getState().setFaceProgress(null);
  }
}

const SKIPPED_KEY = 'lumin-gallery-read-skipped';
function readSkipped(): Set<string> {
  // Și pozele care au închis aplicația de două ori (core/crashGuard.ts).
  const crashed = crashSkippedUris();
  try { return new Set([...JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? '[]') as string[], ...crashed]); } catch { return crashed; }
}
function writeSkipped(uris: string[]): void {
  try { localStorage.setItem(SKIPPED_KEY, JSON.stringify([...new Set(uris)].slice(-5000))); } catch { /* fără stocare */ }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface BatteryLike { level: number; charging: boolean }
async function lowBattery(): Promise<boolean> {
  if (ignoreBattery) return false;
  try {
    const b = await (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery?.();
    return !!b && !b.charging && b.level < 0.2;
  } catch { return false; }
}

/**
 * Ritmul citirii. La încărcat, cu ecranul nefolosit (aplicația în spate sau nicio
 * atingere de 20 s), analiza merge la viteză maximă; altfel lasă loc ecranului.
 * Așa galeria mare se termină peste noapte, iar ziua telefonul rămâne fluid.
 */
/**
 * Telefon modest sau galerie foarte mare: întâi ultimul an, restul doar la încărcat
 * (auditul pe persoane: pe 2–3 GB RAM, 15.000 de poze însemnau ~10 ore de procesor
 * în mijlocul zilei). Pozele noi și ultimul an se citesc ca înainte.
 */
export function oldPhoneMode(memoryGb: number, missing: number): boolean {
  return memoryGb <= 2 || missing >= 10_000;
}

export function readerPace(s: { charging: boolean; visible: boolean; active: boolean }): 'full' | 'gentle' {
  // Nefolosit 20 s (sau ecranul stins): viteză maximă, și fără încărcător. Înainte cerea
  // încărcătorul, iar cu aplicația pe ecran citea ~13 poze pe minut (raportat: „foarte lentă,
  // aici utilizatorii erau pa”). O atingere o oprește oricum pe loc (AnalysisPool).
  return !s.visible || !s.active ? 'full' : 'gentle';
}
async function isCharging(): Promise<boolean> {
  try {
    const b = await (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery?.();
    return !!b && b.charging;
  } catch { return false; }
}

function importBusy(): boolean {
  const s = useStore.getState();
  return s.supervisorImporting || (!!s.progress && s.progress.phase !== 'finalizat');
}

export function readerRunning(): boolean {
  return running;
}

/** Pornește (sau continuă) citirea galeriei. Tăcută când n-are ce face. */
export async function readWholeGallery(byUser = false): Promise<void> {
  if (running || !isNativeMediaLibraryAvailable()) return;
  // Cerut de om: se reîncearcă și pozele sărite data trecută.
  if (byUser) { try { localStorage.removeItem(STOPPED_KEY); localStorage.removeItem(SKIPPED_KEY); localStorage.setItem(STARTED_KEY, '1'); } catch { /* fără stocare */ } }
  else if (readerStopped() || !readerStarted()) return;
  // După prima privire, restul galeriei pornește doar la cererea omului.
  if (!byUser && sampleDone() && !fullReadAccepted()) return;
  // Întâi motoarele AI, apoi galeria (cerut: „încărcarea galeriei să nu pornească până
  // nu descarci toate modelele”). Și pornirea cerută de om așteaptă: când motoarele sunt
  // pe telefon, ENGINES_READY_EVENT repornește citirea (vezi LuminApp).
  const { enginesReadyForGallery } = await import('./engines');
  if (!(await enginesReadyForGallery())) {
    const { enginesPromptPending } = await import('./dataMode');
    if (!enginesPromptPending()) void import('./clipBackfill').then(m => m.startClipBackfill());
    return;
  }
  if (running) return;
  running = true;
  stopRequested = false;
  let holding = false;
  // Cât citește în fundal, analiza lasă loc ecranului (vezi AnalysisPool.setGentle).
  analysisPool.setGentle(true);
  analysisPool.setBackground(true);
  const lx = useLx.getState();
  try {
    // Cu acces parțial nu avem ce citi singuri; fără acces încă, citirea listei cere permisiunea.
    if ((await getPhotosAccess()) === 'limited') return;
    const list = await listPhotosInRange(0, Date.now() + 1);
    if (!list.granted) return;
    const known = new Set(useStore.getState().photos.map(p => p.mediaUri).filter(Boolean));
    const skipped = readSkipped();
    const allMissing = list.photos.filter(p => !known.has(p.uri) && !skipped.has(p.uri)).sort((a, b) => b.capturedAt - a.capturedAt);
    if (!allMissing.length) return;
    // Prima privire: doar cele mai noi poze, o singură dată. O bibliotecă veche (deja citită)
    // sau o galerie mică trece direct la citirea întreagă.
    const limit = sampleDone() ? null : sampleLimit(known.size, allMissing.length);
    if (limit === null && !sampleDone()) { setFlag(SAMPLE_DONE_KEY); setFlag(FULL_KEY); }
    const sampling = limit !== null;
    const missing = sampling ? allMissing.slice(0, limit) : allMissing;
    useLx.getState().setSampling(sampling);

    const beforeIds = new Set(useStore.getState().photos.map(p => p.id));
    const locale = useStore.getState().locale;
    // Progresul se arată din toată galeria, nu din runda de acum: după o repornire, contorul o lua
    // de la „1%” deși pozele citite rămăseseră (raportat). La prima privire, din cele 150.
    const base = sampling ? 0 : Math.max(0, list.photos.length - allMissing.length);
    const all = base + missing.length;
    const bgText = (d: number) => t(locale, 'lx.reader.title', { done: base + d, total: all });
    // Câteva poze (ex. una salvată din editor) se citesc fără notificare: raportat
    // „a apărut 0 din o poză citite, deși nu era nimic”.
    if (missing.length >= 5) { await holdBackgroundAnalysis(all, bgText(0)); holding = true; }
    let done = 0;
    let lastNotified = 0;
    let recentAnnounced = false;
    // Fără informații despre baterie n-avem cum aștepta încărcatul: citește ca până acum.
    const hasBattery = typeof (navigator as unknown as { getBattery?: unknown }).getBattery === 'function';
    const slowPhone = hasBattery && !ignoreBattery && oldPhoneMode(MEMORY_GB, missing.length);
    const yearAgo = Date.now() - 365 * 86_400_000;
    let yearAnnounced = false;
    lx.setReader({ done: base + done, total: all });
    for (let i = 0; i < missing.length; i += chunkSizeAt(i)) {
      const size = chunkSizeAt(i);
      // Așteaptă: alt import, aplicația în spate, bateria slabă.
      if (stopRequested) break;
      // Nu mai așteaptă cât aplicația e în spate: serviciul din fundal (cu notificarea
      // lui) ține analiza pornită, cât îi permite telefonul — vezi Setări → Lucru în fundal.
      // Editorul deschis: pachetul următor așteaptă, ca tragerea de reglaje să rămână fluidă.
      // Editorul deschis ține citirea doar cât aplicația e pe ecran: plecat din aplicație cu o poză
      // deschisă, citirea stătea pe loc la nesfârșit (raportat: „în fundal tot nu a mers”).
      while (!stopRequested && analysisPool.uiHeld() && document.visibilityState === 'visible') await sleep(700);
      // Cu aplicația pe ecran, un pachet întreg (citirea fișierelor, salvarea, seriile) pornește
      // abia după 8 s fără atingeri, nu doar analiza din el (video 12 nov.: derularea greoaie și
      // poza care abia se deschidea, cât citea galeria). Cu ecranul stins merge ca până acum.
      while (!stopRequested && !sampling && !useLx.getState().workMode && document.visibilityState === 'visible' && (userActive(8_000) || analysisPool.uiHeld())) await sleep(600);
      while (!stopRequested && (importBusy() || await lowBattery())) {
        // Alt import (ales de om) are întâietate; cititorul spune că așteaptă, nu pare blocat.
        const paused = importBusy() ? 'import' as const : await lowBattery() ? 'battery' as const : undefined;
        useLx.getState().setReader({ done: base + done, total: all, ...(paused ? { paused } : {}) });
        await sleep(4000);
      }
      if (stopRequested) break;
      if (slowPhone && missing[i].capturedAt < yearAgo) {
        if (!yearAnnounced) {
          yearAnnounced = true;
          useStore.getState().setNotice(t(useStore.getState().locale, 'lx.reader.yearDone', { left: missing.length - i }));
        }
        while (!stopRequested && !(await isCharging())) {
          useLx.getState().setReader({ done: base + done, total: all, paused: 'charging' });
          await sleep(15_000);
        }
        if (stopRequested) break;
      }
      // Prima privire și ecranul „Lucrez la galeria ta”: viteză maximă, omul se uită la progres.
      const focus = sampling || useLx.getState().workMode;
      const fast = focus || readerPace({ charging: await isCharging(), visible: document.visibilityState === 'visible', active: userActive(20_000) }) === 'full';
      analysisPool.setGentle(!fast);
      analysisPool.setBackground(!focus);
      analysisPool.setFocus(focus);
      useLx.getState().setReader({ done: base + done, total: all, fast });
      const files = await jankSpan('citire-fisiere', () => readPhotoFiles(missing.slice(i, i + size)));
      if (files.length) {
        const notice = useStore.getState().notice;
        // Bara urcă poză cu poză, nu din 24 în 24: altfel pare blocată.
        const chunkStart = i;
        const unsub = useStore.subscribe(s => {
          const p = s.progress;
          if (p && p.total > 0 && p.phase !== 'finalizat') {
            const d = Math.min(missing.length, chunkStart + Math.round((p.done / p.total) * files.length));
            useLx.getState().setReader({ done: base + d, total: all });
            // Notificarea urmează cifra din aplicație (raportat: 985 în aplicație, 936 în notificare),
            // cel mult o dată la 2 s, ca să nu încarce telefonul.
            if (holding && Date.now() - lastNotified >= 2000) { lastNotified = Date.now(); void updateHeldBackground(base + d, all, bgText(d)); }
          }
        });
        // Momentele (cele mai bune 1–3 din fiecare) trec prin toată biblioteca:
        // nu după fiecare pachet, ci la ~200 de poze și la final.
        const momentsNow = Math.floor((i + size) / 200) > Math.floor(i / 200) || i + size >= missing.length;
        try {
          await jankSpan(momentsNow ? 'analiza+momente' : 'analiza', () => useStore.getState().runImport(files.map(f => f.file), undefined, files.map(f => f.uri), { deferMoments: !momentsNow }));
        } finally { unsub(); }
        // Fără mesajul „am importat 24 de poze” după fiecare pachet: rezumatul vine la final.
        useStore.setState({ notice });
        // Antrenat prea puțin: ce ar arunca AI-ul rămâne „de văzut” (vezi trainingGate.ts).
        const uris = new Set(files.map(f => f.uri));
        await jankSpan('retinere-refuzuri', () => holdRejectsUntilTrained(useStore.getState().photos.filter(p => p.mediaUri && uris.has(p.mediaUri)).map(p => p.id)).catch(() => 0));
        // Mâncarea, locurile și obiectele: „de văzut” până știe că omul le păstrează.
        await holdUntilLearned(useStore.getState().photos.filter(p => p.mediaUri && uris.has(p.mediaUri)).map(p => p.id)).catch(() => 0);
        // Oamenii se umplu pe parcurs, nu abia la final (raportat: „nu a citit toată
        // galeria să o repartizeze la persoane”): fețele din pachetele citite primesc
        // amprenta și numele la fiecare ~200 de poze — după import, nu în paralel cu el.
        if (momentsNow && canEmbedFaces() && !stopRequested) await jankSpan('fete', () => placeFaces());
      }
      done = Math.min(missing.length, i + size);
      // Ultimele 3 luni sunt gata (primele citite): omul află că le poate folosi deja.
      const recentEdge = Date.now() - 90 * 86_400_000;
      if (!recentAnnounced && i + size < missing.length && missing[i + size].capturedAt < recentEdge && missing[0].capturedAt >= recentEdge) {
        recentAnnounced = true;
        useStore.getState().setNotice(t(useStore.getState().locale, 'lx.reader.recentDone', { left: missing.length - done }));
      }
      useLx.getState().setReader({ done: base + done, total: all });
      if (holding) void updateHeldBackground(base + done, all, bgText(done));
      // Primele ~40 de poze sunt gata: pauză, ca omul să-l antreneze pe ele înainte de
      // restul galeriei. Continuă singur după test (sau când omul alege să continue fără).
      // Doar când antrenamentul chiar are din ce face perechi: dacă primele poze sunt capturi
      // sau documente, citirea merge mai departe și pauza vine la un pachet următor.
      if (!sampling && !trainingOffered() && done >= TRAIN_PAUSE_AT && done < missing.length && !readTasteQuizDone() && !(await trainedEnough()) && quizReady(useStore.getState().photos)) {
        try { localStorage.setItem(TRAIN_OFFERED_KEY, '1'); } catch { /* fără stocare */ }
        skipTraining = false;
        analysisPool.setGentle(false);
        while (!stopRequested && !skipTraining && !readTasteQuizDone() && !(await trainedEnough())) {
          useLx.getState().setReader({ done: base + done, total: all, paused: 'training' });
          await sleep(1200);
        }
        analysisPool.setGentle(true);
        useLx.getState().setReader({ done: base + done, total: all });
      }
      // Cu ecranul la vedere, telefonul respiră între pachete (aplicația rămâne fluidă);
      // în spate nu are pentru cine.
      // În fundal, fără niciun temporizator: Chromium le rărește la unul pe minut în paginile
      // ascunse, iar fiecare pachet aștepta un minut întreg (raportat: „ieșeam din aplicație
      // și nu rula”).
      if (document.visibilityState === 'visible') await sleep(800);
    }

    if (stopRequested) { void useStore.getState().applyMoments().catch(() => {}); return; } // oprit de om: fără rezumat
    // Pozele citite care tot n-au intrat (aceeași poză deja în Cherrypic sub alt fișier,
    // un fișier stricat): ținute minte, altfel se recitesc la fiecare revenire în aplicație
    // (raportat: „Cherrypic citește galeria 8/20” apărea de mai multe ori).
    const nowKnown = new Set(useStore.getState().photos.map(p => p.mediaUri).filter(Boolean));
    writeSkipped([...skipped, ...missing.map(p => p.uri).filter(u => !nowKnown.has(u))]);
    const fresh = useStore.getState().photos.filter(p => !beforeIds.has(p.id));
    if (sampling) {
      setFlag(SAMPLE_DONE_KEY);
      // Antrenamentul se oferă pe cardul rezultatului, nu ca pauză în mijlocul citirii.
      try { localStorage.setItem(TRAIN_OFFERED_KEY, '1'); } catch { /* fără stocare */ }
      if (fresh.length) {
        await useStore.getState().applyMoments().catch(() => {});
        const result = { ids: fresh.map(p => p.id), left: allMissing.length - missing.length };
        try { localStorage.setItem(SAMPLE_RESULT_KEY, JSON.stringify(result)); } catch { /* fără stocare */ }
        useLx.getState().setSampleResult(result);
      }
      return;
    }
    // Gata cu toată galeria, cu aplicația în spate: o notificare îl aduce pe om înapoi exact
    // când merită (cerut). Doar pentru citirile mari; prima privire are ecranul ei.
    if (fresh.length >= 20 && document.visibilityState !== 'visible') {
      const st = useStore.getState();
      const kept = fresh.filter(p => p.status === 'selected').length;
      void import('../core/nativeNotifications').then(m => m.showNotification({
        title: t(st.locale, 'lx.reader.notifyTitle'),
        body: t(st.locale, 'lx.reader.notifyBody', { total: fresh.length, kept }),
        channelName: t(st.locale, 'lx.reader.notifyChannel')
      })).catch(() => false);
    }
    let announced = false;
    try { announced = localStorage.getItem(ANNOUNCED_KEY) === '1'; localStorage.setItem(ANNOUNCED_KEY, '1'); } catch { /* fără stocare */ }
    // Prima citire completă primește un rezumat; completările de mai târziu, nu.
    if (!announced && fresh.length) {
      useLx.getState().setReaderResult({
        total: list.photos.length,
        kept: useStore.getState().photos.filter(p => p.status === 'selected').length,
        waiting: useStore.getState().photos.filter(p => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate')).length
      });
    }
  } catch {
    // o citire eșuată nu oprește aplicația; data viitoare reia de unde a rămas
  } finally {
    if (holding) void releaseBackgroundAnalysis();
    analysisPool.setGentle(false);
    analysisPool.setBackground(false);
    analysisPool.setFocus(false);
    useLx.getState().setSampling(false);
    running = false;
    useLx.getState().setReader(null);
  }
}


/**
 * Câte poze sunt de citit și cât ar dura, ca omul să știe la ce să se aștepte
 * înainte să pornească (cerut: „să-l întrebe dacă vrea s-o pornească și să-l
 * anunțe de timpul estimat”). Viteza: din ultimul import măsurat, altfel o
 * medie prudentă pentru un telefon obișnuit.
 */
export const PHOTOS_PER_MINUTE = 40;
export async function galleryReadEstimate(): Promise<{ count: number; minutes: number } | null> {
  if (!isNativeMediaLibraryAvailable()) return null;
  try {
    const list = await listPhotosInRange(0, Date.now() + 1);
    if (!list.granted) return null;
    const known = new Set(useStore.getState().photos.map(p => p.mediaUri).filter(Boolean));
    const count = list.photos.filter(p => !known.has(p.uri)).length;
    const st = useStore.getState().lastImportStats;
    const measured = st && st.count >= 8 && st.durationMs > 0 ? (st.count / st.durationMs) * 60_000 : 0;
    const rate = measured > 5 ? Math.min(120, measured) : PHOTOS_PER_MINUTE;
    return { count, minutes: Math.max(1, Math.round(count / rate)) };
  } catch { return null; }
}
