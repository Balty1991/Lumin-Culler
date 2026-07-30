/**
 * core/export/directoryPicker.ts
 * Wrapper minimal peste File System Access API (showDirectoryPicker), comun
 * exportului de fotografii si celui de sidecar-uri XMP — evita duplicarea
 * acelorasi tipuri/verificare de suport in doua fisiere.
 */
import { zip, type Zippable } from 'fflate';

export interface LocalWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
export interface LocalFileHandle {
  createWritable(): Promise<LocalWritable>;
}
export interface LocalDirHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirHandle>;
}
interface DirectoryPickerWindow {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<LocalDirHandle>;
}
interface SaveFilePickerWindow {
  showSaveFilePicker(options?: { suggestedName?: string }): Promise<LocalFileHandle>;
}

/**
 * Disponibil in Chromium desktop si in unele Chrome/Android recente — NU in
 * Safari/WebKit sau Firefox. Preferat fata de <a download> cand exista: vezi
 * comentariul de la downloadBlob mai jos pentru bug-ul real pe care il evita.
 */
function getSaveFilePicker(): SaveFilePickerWindow['showSaveFilePicker'] | null {
  const w = window as unknown as Partial<SaveFilePickerWindow>;
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(w) : null;
}

/**
 * Disponibil in Chromium desktop si Electron; NU si in Safari/WebKit sau
 * in WebView-urile mobile (Android Chrome/Brave inclus) — apelantul trebuie
 * sa aiba mereu un fallback de descarcari pentru cazul null.
 */
export function getDirectoryPicker(): DirectoryPickerWindow['showDirectoryPicker'] | null {
  const w = window as unknown as Partial<DirectoryPickerWindow>;
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(w) : null;
}

/**
 * Bug real gasit de auditul QA: doua poze cu acelasi nume de fisier (frecvent
 * la import din mai multe carduri de memorie ale aceleiasi camere, ex.
 * "IMG_0001.jpg" de pe doua card-uri diferite) ajungeau, fara acest fix, sa
 * se suprascrie silentios una pe alta la export — atat pe calea folder
 * (getFileHandle cu acelasi nume) cat si in zip (aceeasi cheie de path in
 * obiectul dat lui fflate), fara nicio eroare sau avertisment, iar numarul
 * "N poze exportate" raportat ramanea cel initial desi mai putine fisiere
 * ajungeau efectiv pe disc/in arhiva. `used` trebuie sa fie un Set separat
 * per scop de unicitate (per subfolder pentru export foto, unul singur
 * pentru XMP care e mereu plat) — vezi apelurile din exportPhotos.ts si
 * xmpGenerator.ts.
 */
export function dedupeFileName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export async function writeTextFile(dir: LocalDirHandle, name: string, content: string, type: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([content], { type }));
  await writable.close();
}

/**
 * Bug real raportat de utilizator: pe Brave/Android (mai ales rulat ca PWA
 * instalat, fara chrome-ul obisnuit al browserului), <a download> + click()
 * sintetic pe un blob: URL era IGNORAT SILENTIOS de sistem — niciun fisier nu
 * ajungea in Descarcari, desi codul JS (fara niciun semnal real de esec de
 * la click()) tot raporta succes. Acelasi tipar era deja documentat mai jos
 * pentru descarcari MULTIPLE succesive; se confirma acum si pentru una SINGURA.
 *
 * Preferam acum File System Access API (showSaveFilePicker) cand exista:
 * utilizatorul alege EXPLICIT unde salveaza, printr-un dialog real al
 * sistemului — ocoleste complet problema, si in plus semnaleaza CORECT
 * anularea (spre deosebire de <a download>, care n-are cum sa raporteze
 * asta). Fallback la <a download> doar cand API-ul lipseste (Safari, Firefox,
 * browsere mai vechi) — acelasi comportament ca inainte pentru acele cazuri.
 *
 * Timeout absolut (ACELASI prag ca watchdog-ul de import, vezi
 * core/pickerWatchdog.ts ABSOLUTE_FALLBACK_MS) in jurul apelului
 * showSaveFilePicker: verificat direct (nu presupus) ca API-ul poate ramane
 * blocat la NESFARSIT, fara sa rezolve sau sa respinga vreodata, intr-un
 * context fara UI reala cu care sa interactioneze (confirmat intr-un Chromium
 * headless — un risc real si pe unele combinatii browser mobil/WebView unde
 * API-ul e detectat dar nu complet functional). Fara acest timeout, un caz
 * real ca acela ar inlocui bug-ul vechi (esec silentios, dar rapid) cu unul
 * mai rau (blocare permanenta, fara nicio notificare). 45s e suficient pentru
 * o interactiune reala (navigare foldere), dar tot recupereaza, in loc sa
 * ramana agatat definitiv.
 */
const SAVE_PICKER_TIMEOUT_MS = 45000;

/**
 * Prag sub care un AbortError de la showSaveFilePicker e tratat ca fals
 * (API detectat dar nefunctional in acest context/browser), NU ca o anulare
 * reala din partea utilizatorului. Un anulare reala presupune ca dialogul
 * nativ chiar s-a deschis si omul a apucat sa apese "Anuleaza" — imposibil
 * de facut in sub jumatate de secunda. Verificat direct: intr-un Chromium
 * fara UI capabila sa afiseze dialogul nativ, AbortError vine INSTANT (nu
 * dupa timeout-ul de mai jos), exact tiparul pe care il exclude acest prag.
 * Fara aceasta distinctie, un caz real cu API-ul "detectat dar nefunctional"
 * (deja anticipat in comentariul de mai sus) ar fi tratat gresit ca anulare
 * si exportul s-ar opri silentios, fara sa mai incerce fallback-ul <a download>.
 */
const INSTANT_ABORT_THRESHOLD_MS = 500;

export async function downloadBlob(name: string, blob: Blob): Promise<{ cancelled: boolean }> {
  const showSaveFilePicker = getSaveFilePicker();
  if (showSaveFilePicker) {
    const startedAt = Date.now();
    try {
      const handle = await Promise.race([
        showSaveFilePicker({ suggestedName: name }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('showSaveFilePicker timeout')), SAVE_PICKER_TIMEOUT_MS))
      ]);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { cancelled: false };
    } catch (err) {
      const isRealCancel = err instanceof DOMException && err.name === 'AbortError' && Date.now() - startedAt >= INSTANT_ABORT_THRESHOLD_MS;
      if (isRealCancel) return { cancelled: true };
      // orice alta eroare (API detectat dar restrictionat la runtime, ex. context nesigur,
      // sau un AbortError instantaneu care nu putea fi o anulare reala de la utilizator) ->
      // cadem pe <a download>, nu lasam exportul sa esueze silentios
    }
  }
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // NU revocam URL-ul: pe Android, click() pe <a download> preda descarcarea
    // catre managerul de descarcari al SO, care citeste continutul blob: URL-ului
    // ASINCRON, in fundal — pentru fisiere mai mari (poze originale de cativa MB),
    // acest transfer poate dura mai mult decat orice timeout scurt "rezonabil".
    // Daca revocam URL-ul inainte sa termine, primim "Eroare de retea" in
    // Descarcari, desi codul JS (fara niciun semnal real de finalizare de la
    // click()) tot raporteaza succes — bug real gasit anterior. Lasam URL-urile
    // sa fie curatate natural de browser la inchiderea/reincarcarea paginii.
    setTimeout(() => resolve({ cancelled: false }), 250);
  });
}

/**
 * Descarcarile succesive multiple (downloadBlob intr-o bucla) sunt
 * BLOCATE SILENTIOS de multe browsere mobile (Chrome/Brave pe Android confirmat) —
 * un singur gest de utilizator (click pe "Exporta") poate declansa direct doar
 * PRIMA descarcare automata; restul dispar fara nicio eroare vizibila. Bug
 * real, raportat de utilizator (un singur fisier ajuns efectiv in Descarcari,
 * desi aplicatia anunta "3 poze exportate"). Solutia standard: un SINGUR
 * fisier .zip, deci o SINGURA descarcare (acum si ea trecuta prin downloadBlob
 * de mai sus, cu acelasi beneficiu de showSaveFilePicker), indiferent cate
 * poze contine — folosit ori de cate ori exportul fallback (fara File System
 * Access API) are mai mult de un fisier de trimis.
 */
export function downloadZip(zipFileName: string, entries: { path: string; data: Uint8Array }[]): Promise<{ cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    const files: Zippable = {};
    for (const e of entries) files[e.path] = e.data;
    zip(files, (err, data) => {
      if (err) { reject(err); return; }
      const blob = new Blob([data], { type: 'application/zip' });
      downloadBlob(zipFileName, blob).then(resolve, reject);
    });
  });
}
