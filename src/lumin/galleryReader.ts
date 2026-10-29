import { getPhotosAccess, isNativeMediaLibraryAvailable, listPhotosInRange, readPhotoFiles } from '../core/nativeMediaLibrary';
import { useStore } from '../state/store';
import { useLx } from './lxStore';
import { autoNameFaces, canEmbedFaces, embedMissingFaces } from './faceIdentity';

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
const CHUNK = ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4) >= 6 ? 48 : 24;
/** Primul pachet e mic: primele poze apar pe Azi în câteva secunde, nu după un minut. */
const FIRST_CHUNK = 8;
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface BatteryLike { level: number; charging: boolean }
async function lowBattery(): Promise<boolean> {
  if (ignoreBattery) return false;
  try {
    const b = await (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery?.();
    return !!b && !b.charging && b.level < 0.2;
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
  if (byUser) { try { localStorage.removeItem(STOPPED_KEY); } catch { /* fără stocare */ } }
  else if (readerStopped()) return;
  running = true;
  stopRequested = false;
  const lx = useLx.getState();
  try {
    // Cu acces parțial nu avem ce citi singuri; fără acces încă, citirea listei cere permisiunea.
    if ((await getPhotosAccess()) === 'limited') return;
    const list = await listPhotosInRange(0, Date.now() + 1);
    if (!list.granted) return;
    const known = new Set(useStore.getState().photos.map(p => p.mediaUri).filter(Boolean));
    const missing = list.photos.filter(p => !known.has(p.uri)).sort((a, b) => b.capturedAt - a.capturedAt);
    if (!missing.length) return;

    const beforeIds = new Set(useStore.getState().photos.map(p => p.id));
    let done = 0;
    lx.setReader({ done, total: missing.length });
    for (let i = 0; i < missing.length; i += i === 0 ? FIRST_CHUNK : CHUNK) {
      const size = i === 0 ? FIRST_CHUNK : CHUNK;
      // Așteaptă: alt import, aplicația în spate, bateria slabă.
      if (stopRequested) break;
      // Nu mai așteaptă cât aplicația e în spate: serviciul din fundal (cu notificarea
      // lui) ține analiza pornită, cât îi permite telefonul — vezi Setări → Lucru în fundal.
      while (!stopRequested && (importBusy() || await lowBattery())) {
        // Alt import (ales de om) are întâietate; cititorul spune că așteaptă, nu pare blocat.
        const paused = importBusy() ? 'import' as const : await lowBattery() ? 'battery' as const : undefined;
        useLx.getState().setReader({ done, total: missing.length, ...(paused ? { paused } : {}) });
        await sleep(4000);
      }
      if (stopRequested) break;
      useLx.getState().setReader({ done, total: missing.length });
      const files = await readPhotoFiles(missing.slice(i, i + size));
      if (files.length) {
        const notice = useStore.getState().notice;
        // Bara urcă poză cu poză, nu din 24 în 24: altfel pare blocată.
        const base = i;
        const unsub = useStore.subscribe(s => {
          const p = s.progress;
          if (p && p.total > 0 && p.phase !== 'finalizat') useLx.getState().setReader({ done: Math.min(missing.length, base + Math.round((p.done / p.total) * files.length)), total: missing.length });
        });
        // Momentele (cele mai bune 1–3 din fiecare) trec prin toată biblioteca:
        // nu după fiecare pachet, ci la ~200 de poze și la final.
        const momentsNow = Math.floor((i + size) / 200) > Math.floor(i / 200) || i + size >= missing.length;
        try {
          await useStore.getState().runImport(files.map(f => f.file), undefined, files.map(f => f.uri), { deferMoments: !momentsNow });
        } finally { unsub(); }
        // Fără mesajul „am importat 24 de poze” după fiecare pachet: rezumatul vine la final.
        useStore.setState({ notice });
        // Oamenii se umplu pe parcurs, nu abia la final (raportat: „nu a citit toată
        // galeria să o repartizeze la persoane”): fețele din pachetele citite primesc
        // amprenta și numele la fiecare ~200 de poze — după import, nu în paralel cu el.
        if (momentsNow && canEmbedFaces() && !stopRequested) await placeFaces();
      }
      done = Math.min(missing.length, i + size);
      useLx.getState().setReader({ done, total: missing.length });
      await sleep(1200); // telefonul respiră între pachete: aplicația rămâne fluidă
    }

    if (stopRequested) { void useStore.getState().applyMoments().catch(() => {}); return; } // oprit de om: fără rezumat
    const fresh = useStore.getState().photos.filter(p => !beforeIds.has(p.id));
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
    running = false;
    useLx.getState().setReader(null);
  }
}
