/**
 * core/export/directoryPicker.ts
 * Wrapper minimal peste File System Access API (showDirectoryPicker), comun
 * exportului de fotografii si celui de sidecar-uri XMP — evita duplicarea
 * acelorasi tipuri/verificare de suport in doua fisiere.
 */
import { Zip, ZipPassThrough } from 'fflate';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { blobToBase64 } from '../base64';
import { withTimeout } from '../workerPool';

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
 * Prag pentru showDirectoryPicker — acelasi ordin de marime si acelasi motiv
 * ca SAVE_PICKER_TIMEOUT_MS mai jos (45s, suficient pentru navigare reala de
 * foldere, dar tot recupereaza). Bug real raportat de utilizator, confirmat
 * DUPA ce toate celelalte cai native (Filesystem.writeFile/Share.share,
 * coacerea editarilor) au primit deja timeout: "Se exporta..." ramanea agatat
 * la infinit, IDENTIC, indiferent de poza — pentru ca exportOriginalFiles/
 * exportXMP incearca ÎNTÂI acest apel, ÎNAINTE sa ajunga vreodata la caile deja
 * reparate. showDirectoryPicker poate fi DETECTAT pe un WebView Android (functie
 * prezenta pe window) fara sa fie complet functional la runtime — comentariul
 * de mai jos (catch-ul din exportPhotos.ts) documenta deja cazul in care API-ul
 * arunca o eroare (NotAllowedError), dar nu si cazul in care promisiunea lui
 * nu se aseaza NICIODATA, nici cu succes nici cu eroare — fara acest timeout,
 * niciun catch din apelanti nu avea vreodata ocazia sa cada pe fallback-ul de
 * descarcari.
 */
const PICK_DIRECTORY_TIMEOUT_MS = 45000;

/**
 * Disponibil in Chromium desktop si Electron; NU si in Safari/WebKit sau
 * in WebView-urile mobile (Android Chrome/Brave inclus) — apelantul trebuie
 * sa aiba mereu un fallback de descarcari pentru cazul null. Functia intoarsa
 * e deja limitata in timp (vezi PICK_DIRECTORY_TIMEOUT_MS) — apelantii nu
 * trebuie sa mai adauge propriul lor timeout.
 */
export function getDirectoryPicker(): DirectoryPickerWindow['showDirectoryPicker'] | null {
  const w = window as unknown as Partial<DirectoryPickerWindow>;
  const raw = typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(w) : null;
  if (!raw) return null;
  return options => Promise.race([
    raw(options),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('showDirectoryPicker timeout')), PICK_DIRECTORY_TIMEOUT_MS))
  ]);
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

/**
 * Capacitor WebView-ul Android NU implementeaza File System Access API (showSaveFilePicker
 * mai jos ramane mereu null acolo) SI <a download> pe un blob: URL e ignorat silentios de un
 * WebView nativ (DownloadListener nu se declanseaza niciodata pentru scheme-ul blob:, doar
 * pentru retea reala) — bug real gasit de auditul QA, confirmat independent de doua audituri
 * separate: fara aceasta cale, orice export din aplicatia publicata pe Play Store (poze,
 * XMP, arhive, galerie client) nu producea NICIUN fisier pe telefon, desi interfata raporta
 * succes — cea mai grava problema gasita, pe o functie centrala a aplicatiei.
 *
 * Scriem in storage-ul PRIVAT al aplicatiei (Filesystem, Directory.Cache — nu cere nicio
 * permisiune pe Android modern) apoi deschidem foaia de partajare nativa (Share), ca
 * utilizatorul sa aleaga imediat, printr-un dialog al sistemului, unde ajunge de fapt
 * fisierul (Fisiere, Drive, Descarcari, aplicatia clientului etc).
 *
 * Bug real raportat de utilizator pe device (build Play Store): tap pe Exporta arata
 * toast-ul "Se exporta...", apoi NIMIC — nici eroare, nici foaia de partajare, la
 * infinit (confirmat identic pe exportul principal SI pe cel de folder, deci in
 * aceasta cale comuna, nu intr-un apelant anume). Fara niciun timeout, un apel catre
 * puntea nativa Capacitor (Filesystem.writeFile/Share.share) care nu se rezolva
 * NICIODATA (bridge blocat, activitate care nu porneste efectiv etc.) bloca export-ul
 * la infinit, silentios — promisiunea JS ramanea pur si simplu neasezata, fara sa
 * ajunga vreodata la catch-ul din apelant (state/store.ts). Timeout-uri separate pe
 * fiecare pas ca eroarea raportata sa spuna EXACT care call nativ s-a blocat.
 */
const NATIVE_WRITE_TIMEOUT_MS = 15000;
const NATIVE_SHARE_TIMEOUT_MS = 30000;

async function saveViaNativeShare(name: string, blob: Blob): Promise<{ cancelled: boolean }> {
  const data = await blobToBase64(blob);
  const written = await withTimeout(
    Filesystem.writeFile({ path: name, data, directory: Directory.Cache }),
    NATIVE_WRITE_TIMEOUT_MS,
    'Scrierea fisierului in spatiul temporar al aplicatiei a durat prea mult.'
  );
  try {
    await withTimeout(
      Share.share({ url: written.uri, title: name }),
      NATIVE_SHARE_TIMEOUT_MS,
      'Deschiderea meniului de partajare a durat prea mult.'
    );
  } catch (err) {
    // Utilizatorul a inchis foaia de partajare fara sa aleaga nimic — nu e o eroare reala
    // de export (fisierul tot exista, scris cu succes mai sus), doar o anulare a PASULUI
    // urmator (unde sa ajunga in continuare). Orice alta eroare (Share indisponibil,
    // timeout etc.) ramane raportata normal mai sus, catre apelant.
    if (!(err instanceof Error && /cancel/i.test(err.message))) throw err;
  }
  return { cancelled: false };
}

export async function downloadBlob(name: string, blob: Blob): Promise<{ cancelled: boolean }> {
  if (Capacitor.isNativePlatform()) return saveViaNativeShare(name, blob);
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
 *
 * `data` e un Blob (nu un Uint8Array deja citit) tocmai ca fisierele mari
 * (poze originale, cativa MB fiecare) sa nu fie decodate in memorie TOATE
 * deodata de apelant inainte sa apucam sa incepem arhivarea — vezi
 * streamZipEntries mai jos.
 */
export interface ZipEntryInput { path: string; data: Blob }

/**
 * Bug real gasit de auditul QA (scalabilitate, export cu multe poze mari):
 * varianta veche cerea apelantului sa citeasca Promise.all(files.map(f =>
 * f.arrayBuffer())) INAINTE de a apela downloadZip, apoi fflate.zip()
 * construia si el intregul arhiv comprimat dintr-o data — la un export de
 * cateva sute de poze originale (cativa MB fiecare), asta insemna sa tinem
 * simultan in memorie ATAT toate fisierele sursa CAT SI arhiva rezultata
 * (aproape 2x marimea totala a exportului), un risc real de OOM pe mobil.
 *
 * Aici citim si arhivam cate UN SINGUR fisier deodata (Zip/ZipPassThrough,
 * API-ul de streaming al fflate) — bufferul fisierului anterior devine
 * eligibil pentru colectarea gunoiului inainte sa citim urmatorul, in loc sa
 * ramana toate simultan in viata. Folosim ZipPassThrough (fara compresie)
 * intentionat: fisierele exportate sunt deja JPEG/RAW, deja comprimate —
 * a incerca sa le comprimam din nou (deflate) nu reduce marimea, doar arde
 * CPU si timp in plus tinand bufferele in viata mai mult.
 */
function streamZipEntries(entries: ZipEntryInput[], onChunk: (chunk: Uint8Array) => Promise<void> | void): Promise<void> {
  return new Promise((resolve, reject) => {
    // fflate cheama ondata SINCRON (fara sa astepte), dar onChunk (scrierea
    // pe disc, cand exista showSaveFilePicker) e async — inlantuim explicit
    // fiecare bucata dupa cea anterioara, altfel writable.write() ar primi
    // toate bucatile deodata, fara backpressure, exact problema de memorie
    // pe care acest streaming ar trebui sa o evite.
    let chain = Promise.resolve();
    const z = new Zip((err, chunk, final) => {
      if (err) { reject(err); return; }
      chain = chain.then(() => onChunk(chunk));
      if (final) chain.then(resolve, reject);
    });
    (async () => {
      for (const e of entries) {
        const buf = new Uint8Array(await e.data.arrayBuffer());
        const zf = new ZipPassThrough(e.path);
        z.add(zf);
        zf.push(buf, true);
      }
      z.end();
    })().catch(reject);
  });
}

export function downloadZip(zipFileName: string, entries: ZipEntryInput[]): Promise<{ cancelled: boolean }> {
  return (async () => {
    // Cale principala (Chromium desktop): scriem fiecare bucata a arhivei
    // DIRECT pe disc pe masura ce e produsa, fara sa construim niciodata
    // arhiva completa in memorie — cel mai bun caz posibil pentru exporturi
    // mari. Acelasi prag/logica de anulare reala ca in downloadBlob (vezi
    // INSTANT_ABORT_THRESHOLD_MS mai sus).
    const showSaveFilePicker = getSaveFilePicker();
    if (showSaveFilePicker) {
      const startedAt = Date.now();
      try {
        const handle = await Promise.race([
          showSaveFilePicker({ suggestedName: zipFileName }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('showSaveFilePicker timeout')), SAVE_PICKER_TIMEOUT_MS))
        ]);
        const writable = await handle.createWritable();
        await streamZipEntries(entries, chunk => writable.write(new Blob([chunk as BlobPart])));
        await writable.close();
        return { cancelled: false };
      } catch (err) {
        const isRealCancel = err instanceof DOMException && err.name === 'AbortError' && Date.now() - startedAt >= INSTANT_ABORT_THRESHOLD_MS;
        if (isRealCancel) return { cancelled: true };
        // API absent/restrictionat la runtime -> cadem pe fallback-ul de mai jos
      }
    }
    // Fallback (fara File System Access API): <a download> cere un Blob
    // complet, deci arhiva tot trebuie construita integral in memorie aici —
    // dar tot procesam fisierele sursa UNUL CATE UNUL (streamZipEntries),
    // nu toate deodata, injumatatind varful de memorie fata de varianta veche.
    const chunks: Uint8Array[] = [];
    await streamZipEntries(entries, chunk => { chunks.push(chunk); });
    const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
    return downloadBlob(zipFileName, blob);
  })();
}
