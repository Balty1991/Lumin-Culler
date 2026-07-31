/**
 * core/filePicker.ts
 * Wrapper minimal peste File System Access API (showOpenFilePicker), folosit
 * la IMPORT — analog cu export/directoryPicker.ts (acelasi API, alta parte a
 * fluxului). Pastram FileSystemFileHandle-urile alaturi de File-urile alese,
 * ca "originalul" unei poze sa poata fi RECITIT de pe disc mai tarziu
 * (export, redeschidere dupa reload de tab) fara sa-i copiem bytes intr-o
 * a doua locatie in IndexedDB — vezi syncOriginal in state/store.ts, care
 * altfel risca QuotaExceededError pe biblioteci mari (plan 2.3.4).
 *
 * Disponibil in Chromium desktop (si Electron); NU si in Safari/WebKit sau
 * in WebView-urile mobile — apelantul trebuie sa aiba mereu fallback la
 * <input type="file"> pentru cazul null/nesuportat.
 */
export interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
  queryPermission?(options: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(options: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface OpenFilePickerWindow {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandleLike[]>;
}

/** Extensiile de format RAW deja acceptate la import (vezi rawDecoder.ts RAW_EXTENSIONS), fara MIME cunoscut de browser. */
const ACCEPT_TYPES: OpenFilePickerOptions['types'] = [
  {
    description: 'Fotografii (JPEG/PNG/WebP/AVIF/RAW)',
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/avif': ['.avif'],
      'application/octet-stream': [
        '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng', '.raf', '.orf',
        '.rw2', '.pef', '.ptx', '.srw', '.3fr', '.erf', '.kdc', '.dcr', '.mrw', '.raw', '.rwl', '.iiq', '.x3f'
      ]
    }
  }
];

export function getFilePicker(): OpenFilePickerWindow['showOpenFilePicker'] | null {
  const w = window as unknown as Partial<OpenFilePickerWindow>;
  return typeof w.showOpenFilePicker === 'function' ? w.showOpenFilePicker.bind(w) : null;
}

/**
 * Deschide selectorul nativ de fisiere si intoarce (File, handle) pentru
 * fiecare alegere — `null` daca API-ul nu e suportat (apelantul cade pe
 * <input type="file">), lista goala daca utilizatorul a inchis selectorul
 * fara sa aleaga nimic (AbortError, NU o eroare reala).
 */
export async function pickImportFiles(): Promise<{ files: File[]; handles: FileSystemFileHandleLike[] } | null> {
  const picker = getFilePicker();
  if (!picker) return null;
  let handles: FileSystemFileHandleLike[];
  try {
    handles = await picker({ multiple: true, types: ACCEPT_TYPES });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { files: [], handles: [] };
    // Functia exista dar apelul a esuat (ex. SecurityError intr-un iframe/webview
    // cu Permissions-Policy restrictiva) — tratam ca "nesuportat la runtime", NU ca
    // eroare fatala: apelantul trebuie sa cada pe <input type="file"> exact ca atunci
    // cand showOpenFilePicker ar fi lipsit complet, nu sa ramana cu un click mort.
    console.warn('showOpenFilePicker indisponibil la apel, revenim la <input type="file">:', err);
    return null;
  }
  // Un handle poate deveni necitibil intre selectie si citire (fisier sters/mutat,
  // evacuat dintr-un provider cloud, permisiune revocata) — bug real gasit de auditul QA:
  // fara acest allSettled, un singur handle picat facea Promise.all sa respinga TOT
  // apelul, nefiind prins de niciun apelant (App.tsx/Workspace.tsx doar `await` fara
  // try/catch), deci utilizatorul alegea poze si nu se intampla absolut nimic, fara
  // nicio explicatie. Acum pastram fisierele care chiar s-au putut citi.
  const settled = await Promise.allSettled(handles.map(h => h.getFile()));
  const files: File[] = [];
  const okHandles: FileSystemFileHandleLike[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') { files.push(r.value); okHandles.push(handles[i]); }
    else console.warn('Fisier ilizibil in selectie, ignorat:', r.reason);
  });
  return { files, handles: okHandles };
}

/**
 * Recitire de pe disc printr-un handle retinut (ex. dupa un reload de tab).
 * Cere din nou permisiunea daca browserul a revocat-o — trebuie apelat dintr-un
 * gest al utilizatorului (ex. click pe "Exporta"), altfel requestPermission esueaza.
 */
export async function reacquireFile(handle: FileSystemFileHandleLike): Promise<File> {
  if (handle.queryPermission) {
    const state = await handle.queryPermission({ mode: 'read' });
    if (state !== 'granted') {
      const granted = handle.requestPermission ? await handle.requestPermission({ mode: 'read' }) : state;
      if (granted !== 'granted') {
        throw new DOMException('Permisiune refuzata pentru fisierul original.', 'NotAllowedError');
      }
    }
  }
  return handle.getFile();
}
