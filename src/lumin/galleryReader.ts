import { getPhotosAccess, isNativeMediaLibraryAvailable, listPhotosInRange, readPhotoFiles } from '../core/nativeMediaLibrary';
import { useStore } from '../state/store';
import { useLx } from './lxStore';

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
const CHUNK = 24;
const ANNOUNCED_KEY = 'lumin-gallery-read-announced';
let running = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface BatteryLike { level: number; charging: boolean }
async function lowBattery(): Promise<boolean> {
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
export async function readWholeGallery(): Promise<void> {
  if (running || !isNativeMediaLibraryAvailable()) return;
  running = true;
  const lx = useLx.getState();
  try {
    if ((await getPhotosAccess()) !== 'full') return;
    const list = await listPhotosInRange(0, Date.now() + 1);
    if (!list.granted) return;
    const known = new Set(useStore.getState().photos.map(p => p.mediaUri).filter(Boolean));
    const missing = list.photos.filter(p => !known.has(p.uri)).sort((a, b) => b.capturedAt - a.capturedAt);
    if (!missing.length) return;

    const beforeIds = new Set(useStore.getState().photos.map(p => p.id));
    let done = 0;
    lx.setReader({ done, total: missing.length });
    for (let i = 0; i < missing.length; i += CHUNK) {
      // Așteaptă: alt import, aplicația în spate, bateria slabă.
      while (importBusy() || document.hidden || await lowBattery()) {
        useLx.getState().setReader({ done, total: missing.length, ...(await lowBattery() ? { paused: 'battery' as const } : {}) });
        await sleep(4000);
      }
      useLx.getState().setReader({ done, total: missing.length });
      const files = await readPhotoFiles(missing.slice(i, i + CHUNK));
      if (files.length) {
        const notice = useStore.getState().notice;
        await useStore.getState().runImport(files.map(f => f.file), undefined, files.map(f => f.uri));
        // Fără mesajul „am importat 24 de poze” după fiecare pachet: rezumatul vine la final.
        useStore.setState({ notice });
      }
      done = Math.min(missing.length, i + CHUNK);
      useLx.getState().setReader({ done, total: missing.length });
      await sleep(1200); // telefonul respiră între pachete: aplicația rămâne fluidă
    }

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
