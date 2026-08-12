/**
 * core/exportPhotos.ts
 * Exporta fotografiile SELECTATE ca fisiere reale, in formatul original
 * (aceiasi bytes/extensie ca la import), nu doar o lista de nume.
 *
 * Cale principala: un selector de folder al platformei (vezi getDirectoryPicker)
 * — utilizatorul alege destinatia, fisierele sunt copiate direct acolo unul cate
 * unul (streaming, fara sa tina 1000+ poze originale in memorie simultan), in
 * subfoldere reale pe persoana/scena. File System Access API
 * (showDirectoryPicker) in Chromium desktop si Electron; Storage Access
 * Framework prin plugin-ul nativ FolderExport pe Android. NU exista in
 * Safari/WebKit sau in browserele mobile obisnuite, unde se trece pe fallback.
 *
 * Fallback universal: descarcari secventiale ale fiecarui fisier original,
 * cu numele lor originale — functioneaza peste tot, dar browserul poate
 * cere confirmare pentru descarcari multiple (limitare de securitate a
 * browserului, nu a aplicatiei).
 */
import { originalFiles } from './importPipeline';
import { db } from './db';
import { getDirectoryPicker, downloadBlob, downloadZip, dedupeFileName, isRealUserCancel, racePickerTimeout, DIRECTORY_PICKER_TIMEOUT_MS, type LocalDirHandle } from './export/directoryPicker';
import { reacquireFile } from './filePicker';
import { buildExportFileName, type RenameContext } from './renameTemplate';
import { applyAdjustmentsToBlob, isNeutral, type EditAdjustments } from './imageAdjust';
import { RAW_EXTENSIONS } from './rawDecoder';
import { translateSceneTag, pickFolderSceneTag } from './sceneTagLabels';
import { withTimeout } from './workerPool';

/** Vezi bakeEditsIfNeeded — plafon per poza pentru decodarea/re-encodarea unei singure imagini. */
const BAKE_TIMEOUT_MS = 30000;

export interface ExportResult {
  exported: number;
  missing: string[];       // fileName-uri fara File original disponibil (necesita reimport)
  method: 'folder' | 'downloads';
  cancelled: boolean;
  grouped: boolean;        // s-a putut organiza pe subfoldere (persoane/scena)?
}

export interface ExportPhotoInput {
  id: string;
  fileName: string;
  personNames: string[];
  faceCount: number;
  strangerCount: number;
  sceneType: string;
  /** Etichete de scena/obiect (COCO-80 sau ML Kit Image Labeling, engleza) — folosite DOAR ca fallback de folder cand nu exista nicio fata (vezi folderLabel). */
  sceneTags?: string[];
  /**
   * Campuri folosite DOAR de redenumirea dupa sablon (renameTemplate mai jos),
   * absente => token-ul corespunzator devine gol la expansiune. client/event/
   * location vin per-poza (din state/projectMetadata.ts, dupa p.project — vezi
   * acelasi tipar la exportXMP) ca sesiunile care amesteca mai multe proiecte
   * sa fie redenumite corect fiecare cu propriile metadate, nu cu ale primei poze.
   */
  capturedAt?: number;
  client?: string;
  event?: string;
  location?: string;
  /** Ajustari de baza (EditPanel) — daca sunt reale (nu neutre), coapte in fisierul exportat (vezi bakeEditsIfNeeded), nu doar salvate in IndexedDB. */
  edits?: EditAdjustments;
}

export interface ExportOptions {
  /** Sablon de redenumire (vezi core/renameTemplate.ts) — gol/absent pastreaza numele original, neschimbat. */
  renameTemplate?: string;
  /** Limba pentru numele de folder derivate din etichete de scena (vezi folderLabel) — implicit romana. */
  locale?: 'ro' | 'en';
  /** Numele de baza al arhivei .zip (fara data/extensie) — implicit 'lumin-culler-export'. Folosit de exportCollection (state/store.ts) ca arhiva sa reflecte numele folderului exportat, nu doar un nume generic. */
  zipBaseName?: string;
  /**
   * Numele UNUI SINGUR folder de destinatie pentru toate pozele, in locul
   * gruparii automate pe persoana/scena (folderLabel). Cerinta directa a
   * utilizatorului pentru exportul unui folder personalizat: acel folder e o
   * alegere explicita, facuta si denumita de om — un semnal mai puternic decat
   * orice grupare dedusa de aplicatie, deci trebuie sa fie EXACT folderul care
   * apare pe disc, nu inlocuit de "Ami"/"Necunoscuti"/"Peisaje". Absent =
   * gruparea automata de dinainte, neschimbata (exportul selectiei).
   */
  folderName?: string;
  /**
   * Unde ajung fisierele, cand utilizatorul a ales explicit (foaia "Trimite
   * pozele păstrate", mockup 20). Absent = 'auto', comportamentul de dinainte:
   * folder daca platforma are un selector, altfel descarcare/partajare.
   *
   * 'apps' sare PESTE selectorul de folder si merge direct pe calea de
   * descarcare — care pe Android nativ e foaia de partajare a sistemului
   * (vezi saveViaNativeShare in export/directoryPicker.ts), adica exact
   * drumul catre Google Photos, Drive, Fisiere sau orice altceva are omul
   * instalat. Asta face mockup-ul 20 real fara OAuth si fara chei de API:
   * destinatia o alege sistemul de operare, nu noi.
   */
  destination?: 'auto' | 'folder' | 'apps';
}

// ── Grupare pe foldere: persoane cunoscute (si combinatii), apoi scena ─────
// Ex: "Ami" / "Ami si eu" / "Ami, eu si sotia" / "Ami si altii" (cunoscuti +
// straini) / "Necunoscuti" (doar straini) / o categorie derivata din eticheta
// de scena/obiect (ex. "Parc", "Plaja", "Pisici" — vezi pickFolderSceneTag,
// disponibil acum ca detectia de obiecte/scena e legata in fluxul real de
// analiza, spre deosebire de cand a fost scrisa nota initiala de mai jos) /
// "Peisaje" / "Detalii" (fallback, fara fete si fara nicio eticheta concreta).
const ILLEGAL_PATH_CHARS = /[\\/:*?"<>|]/g;

function sanitizeSegment(s: string): string {
  const clean = s.replace(ILLEGAL_PATH_CHARS, '-').trim();
  return clean || 'necunoscut';
}

/**
 * Corecteaza scaparile de recunoastere DIN ACEEASI SERIE (burst): recunoasterea
 * faciala ruleaza separat pe fiecare cadru, iar intr-un burst (poze aproape
 * identice, la cateva sute de ms una de alta) e frecvent ca o fata sa fie
 * ratata intr-un cadru anume (cap intors, miscare, expresie) desi persoana
 * e clar prezenta si acolo — un om care se uita la poza o recunoaste instant.
 * Daca ORICE cadru din acelasi groupId a recunoscut o persoana cu incredere,
 * o consideram prezenta in TOATE cadrele grupului pentru scopul denumirii
 * folderului de export — bug real raportat: poze cu ambele persoane vizibile
 * ajungeau in folderul unei singure persoane, cand acel cadru anume ratase
 * fata celeilalte. NU modifica scorul AI/metricile afisate, doar gruparea
 * fizica a fisierelor exportate. Calculata din TOATA biblioteca (nu doar
 * pozele exportate), ca sa beneficieze de orice cadru din serie care a
 * recunoscut corect, chiar daca acela nu e printre pozele selectate acum.
 */
export function computeGroupPersonUnion(allPhotos: { groupId?: string; personNames: string[] }[]): Map<string, string[]> {
  const byGroup = new Map<string, Set<string>>();
  for (const p of allPhotos) {
    if (!p.groupId) continue;
    const set = byGroup.get(p.groupId) ?? new Set<string>();
    for (const n of p.personNames) set.add(n);
    byGroup.set(p.groupId, set);
  }
  const result = new Map<string, string[]>();
  for (const [groupId, names] of byGroup) result.set(groupId, Array.from(names));
  return result;
}

/**
 * Ordinea de prioritate ramane persoane > fete necunoscute > eticheta de
 * scena/obiect > peisaj > generic: un chip/fata (chiar nerecunoscuta) e
 * semnalul mai puternic pentru o aplicatie axata pe poze de oameni, deci
 * ramane inaintea categoriilor derivate din scena (pickFolderSceneTag NU e
 * verificat deloc daca exista vreo fata in poza).
 */
export function folderLabel(
  p: { personNames: string[]; faceCount: number; strangerCount: number; sceneType: string; sceneTags?: string[] },
  locale: 'ro' | 'en' = 'ro'
): string {
  if (p.personNames.length > 0) {
    const names = [...p.personNames].sort((a, b) => a.localeCompare(b, 'ro'));
    const base = names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} și ${names[1]}`
      : `${names.slice(0, -1).join(', ')} și ${names[names.length - 1]}`;
    return sanitizeSegment(p.strangerCount > 0 ? `${base} și alții` : base);
  }
  if (p.faceCount > 0) return 'Necunoscuți';
  const sceneTag = pickFolderSceneTag(p.sceneTags);
  if (sceneTag) {
    const label = translateSceneTag(sceneTag, locale);
    return sanitizeSegment(label.charAt(0).toUpperCase() + label.slice(1));
  }
  if (p.sceneType === 'landscape') return 'Peisaje';
  return 'Detalii';
}

/**
 * Coace ajustarile de baza (EditPanel) direct in bytes-ii exportati — bug real
 * gasit de auditul QA: PhotoRecord.edits era persistat corect, dar exportul
 * livra mereu originalul neschimbat (singura cale care aplica ajustari era
 * galeria de client, si doar pe miniatura, niciodata pe exportul real).
 * RAW e exclus deliberat: pipeline-ul de editare lucreaza mereu pe preview-ul
 * deja decodat (JPEG), nu pe bytes-ii bruti RAW — nu exista o cale corecta de
 * a reinjecta ajustari intr-un fisier RAW proprietar la export; originalul
 * RAW ramane livrat neschimbat, ca inainte. Re-encode-ul (applyAdjustmentsToBlob)
 * scoate mereu JPEG — daca extensia originala nu era deja .jpg/.jpeg, o
 * corectam, ca fisierul de pe disc sa nu minta despre continutul lui.
 */
async function bakeEditsIfNeeded(p: ExportPhotoInput, file: File, name: string): Promise<{ file: File; name: string }> {
  if (!p.edits || isNeutral(p.edits) || RAW_EXTENSIONS.test(p.fileName)) return { file, name };
  try {
    // Timeout: createImageBitmap/canvas.toBlob (applyAdjustmentsToBlob) pot ramane
    // agatate la NESFARSIT pe un WebView mobil sub presiune de memorie, iar acest
    // pas ruleaza INAINTE de orice picker/scriere, deci o blocare aici tine tot
    // exportul in loc, cu toast-ul "Se exporta..." pe ecran si fara nicio eroare —
    // exact simptomul raportat. Prag generos: o singura poza, oricat de mare, nu
    // are ce cauta peste 30s. Esecul cade oricum pe fallback-ul de mai jos
    // (exportam originalul needitat), nu opreste exportul.
    const adjustedBlob = await withTimeout(applyAdjustmentsToBlob(file, p.edits), BAKE_TIMEOUT_MS, `Coacerea editarilor pentru ${p.fileName} a durat prea mult.`);
    const finalName = /\.jpe?g$/i.test(name) ? name : name.replace(/\.[^./]+$/, '') + '.jpg';
    return { file: new File([adjustedBlob], finalName, { type: 'image/jpeg' }), name: finalName };
  } catch (err) {
    // O poza care nu poate fi decodata la coacere (format neuzual/corupt) nu trebuie sa
    // opreasca TOT exportul — bug real gasit de auditul QA: fara acest catch, o singura
    // eroare aici arunca din interiorul buclei per-poza din exportOriginalFiles si niciuna
    // dintre celelalte N poze selectate nu mai ajungea exportata. Livram originalul
    // needitat pentru aceasta poza, mai bine decat nimic.
    console.warn(`Coacerea editarilor a esuat pentru ${p.fileName}, export fara editari:`, err);
    return { file, name };
  }
}

async function copyToDirectory(files: { name: string; file: File; folder: string }[], dir: LocalDirHandle): Promise<void> {
  const subdirs = new Map<string, LocalDirHandle>();
  for (const { name, file, folder } of files) {
    let sub = subdirs.get(folder);
    if (!sub) {
      sub = await dir.getDirectoryHandle(folder, { create: true });
      subdirs.set(folder, sub);
    }
    const handle = await sub.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
  }
}

/**
 * Fallback fara File System Access API (ex. Chrome/Brave pe Android, care nu
 * implementeaza showDirectoryPicker): incearca subfolder prin "/" in numele
 * descarcarii — unele browsere Chromium creaza intr-adevar subfoldere in
 * Downloads/ din asta, altele il trateaza ca literal in numele fisierului.
 * In ambele cazuri utilizatorul vede gruparea (folder real SAU nume cu
 * prefix), nu e o pierdere daca browserul nu suporta subfoldere.
 */
export async function exportOriginalFiles(photos: ExportPhotoInput[], options: ExportOptions = {}): Promise<ExportResult> {
  const { renameTemplate, locale = 'ro', zipBaseName = 'lumin-culler-export', folderName, destination = 'auto' } = options;
  // Numele vine de la utilizator (l-a tastat la crearea folderului), deci trece
  // prin acelasi filtru ca etichetele derivate — un "/" sau ":" in el ar deveni
  // altfel un nivel de path neintentionat (sau un nume invalid pe disc).
  const fixedFolder = folderName ? sanitizeSegment(folderName) : null;
  let sequence = 0;
  const nameFor = (p: ExportPhotoInput): string => {
    sequence += 1;
    // Bug real gasit de auditul QA (defense-in-depth, nicio vulnerabilitate
    // activa azi — orice File real vine din picker-ul OS/IndexedDB, ambele
    // garanteaza deja lipsa separatorilor de path in nume): fara renameTemplate,
    // numele original ajungea NESANITIZAT direct ca path de intrare in arhiva
    // zip (fflate) sau ca nume de fisier pe disc — spre deosebire de folderLabel/
    // sanitizeSegment mai jos si de calea cu renameTemplate (renameTemplate.ts),
    // ambele deja curata \/:*?"<>|. Daca vreodata un nume ar ajunge aici din
    // afara acestor garantii (viitoare sursa de fisiere), un "../" literal in
    // el ar fi exact tiparul clasic "zip-slip". Acelasi filtru, aplicat si aici.
    if (!renameTemplate) return sanitizeSegment(p.fileName);
    const ctx: RenameContext = { client: p.client, event: p.event, location: p.location, capturedAt: p.capturedAt };
    return buildExportFileName(renameTemplate, ctx, sequence, p.fileName);
  };

  // Unicitate per subfolder de destinatie: doua poze cu acelasi nume de
  // fisier (ex. "IMG_0001.jpg" de pe doua carduri de memorie diferite) NU
  // trebuie sa se suprascrie silentios una pe alta odata ajunse in acelasi
  // folder de export — vezi dedupeFileName.
  const usedNamesByFolder = new Map<string, Set<string>>();
  const dedupeInFolder = (folder: string, name: string): string => {
    let used = usedNamesByFolder.get(folder);
    if (!used) { used = new Set<string>(); usedNamesByFolder.set(folder, used); }
    return dedupeFileName(used, name);
  };
  // Coacem intai editarile (poate schimba extensia, ex. .heic -> .jpg), APOI deduplicam
  // numele final — bug real gasit de auditul QA: dedup-ul rula inainte de bake, deci daca
  // baking-ul schimba extensia dupa deja-verificata unicitate, numele final putea coincide
  // silentios cu alt fisier deja exportat in acelasi folder (ex. "sunset.heic" editat ->
  // "sunset.jpg", coliziune cu un "sunset.jpg" needitat din acelasi export), suprascriind
  // o poza cu alta in folder/zip.
  const exportName = async (p: ExportPhotoInput, file: File, folder: string): Promise<{ file: File; name: string }> => {
    const baked = await bakeEditsIfNeeded(p, file, nameFor(p));
    return { file: baked.file, name: dedupeInFolder(folder, baked.name) };
  };

  const available: { name: string; file: File; folder: string }[] = [];
  const missing: string[] = [];
  for (const p of photos) {
    const folder = fixedFolder ?? folderLabel(p, locale);
    const inMemory = originalFiles.get(p.id);
    if (inMemory) {
      available.push({ ...await exportName(p, inMemory, folder), folder });
      continue;
    }
    // fallback 1: handle File System Access API persistat (poze selectate,
    // supravietuieste unui reload de tab fara sa dubleze bytes in IndexedDB —
    // vezi core/db.ts FileHandleRecord / core/filePicker.ts)
    const storedHandle = await db.fileHandles.get(p.id);
    if (storedHandle) {
      try {
        const file = await reacquireFile(storedHandle.handle);
        available.push({ ...await exportName(p, file, folder), folder });
        continue;
      } catch {
        // permisiune refuzata sau fisierul a fost mutat/sters de pe disc —
        // cade pe fallback-ul urmator (copia completa, daca exista)
      }
    }
    // fallback 2: fisierul original persistat in IndexedDB (poze selectate,
    // supravietuieste unui reload de tab — vezi core/db.ts OriginalRecord)
    const stored = await db.originals.get(p.id);
    if (stored) {
      const file = new File([stored.blob], stored.fileName, { type: stored.type });
      available.push({ ...await exportName(p, file, folder), folder });
    } else missing.push(p.fileName);
  }

  // 'apps' = utilizatorul a cerut explicit alta aplicatie/cloud, nu un folder.
  const pickDirectory = destination === 'apps' ? null : getDirectoryPicker();
  let method: ExportResult['method'] = pickDirectory ? 'folder' : 'downloads';

  if (!available.length) return { exported: 0, missing, method, cancelled: false, grouped: false };

  if (pickDirectory) {
    const startedAt = Date.now();
    try {
      // Plafon absolut (vezi DIRECTORY_PICKER_TIMEOUT_MS): un picker care nu
      // rezolva si nu respinge NICIODATA lasa altfel exportul agatat definitiv,
      // cu toast-ul "Se exporta..." pe ecran la infinit.
      const dir = await racePickerTimeout(pickDirectory({ mode: 'readwrite' }), 'directoryPicker', DIRECTORY_PICKER_TIMEOUT_MS);
      await copyToDirectory(available, dir);
      return { exported: available.length, missing, method, cancelled: false, grouped: true };
    } catch (err) {
      // Anulare REALA (omul a vazut dialogul si l-a inchis) — vezi isRealUserCancel.
      // Bug real raportat de utilizator: inainte, ORICE AbortError era luat drept
      // anulare, deci un WebView/browser mobil care EXPUNE showDirectoryPicker dar
      // il respinge instant (API detectat, nefunctional in acel context) oprea
      // exportul aici cu cancelled=true — fara fisier, fara eroare si fara sa mai
      // incerce macar fallback-ul de descarcari care functioneaza acolo.
      if (isRealUserCancel(err, startedAt)) {
        return { exported: 0, missing, method, cancelled: true, grouped: false };
      }
      // Bug real raportat de utilizator (confirmat pe device, build Play
      // Store): showDirectoryPicker poate fi DETECTAT (functie prezenta) dar
      // nefunctional la runtime — ex. NotAllowedError "User activation
      // required" cand gap-uri async intre click-ul utilizatorului si acest
      // apel (bake editari, cautari in IndexedDB pentru fiecare poza mai sus)
      // consuma gestul de activare tranzitorie a browserului. Fara acest
      // fallback, exportul esua COMPLET aici — acelasi tipar "API detectat
      // dar restrictionat -> cadem pe descarcari" deja aplicat in
      // downloadBlob/downloadZip (directoryPicker.ts), doar ca lipsea aici.
      method = 'downloads';
    }
  }

  // un singur fisier: descarcare directa (nume/extensie originale, fara zip inutil)
  if (available.length === 1) {
    const { name, file, folder } = available[0];
    const result = await downloadBlob(`${folder}/${name}`, file);
    return { exported: result.cancelled ? 0 : 1, missing, method, cancelled: result.cancelled, grouped: false };
  }
  // mai multe fisiere: O SINGURA descarcare .zip — descarcarile multiple secventiale
  // sunt blocate silentios de multe browsere mobile dupa prima (vezi downloadZip).
  // Trimitem fisierele (Blob-uri) direct, NECITITE — downloadZip le citeste unul
  // cate unul, in loc sa tinem toate pozele originale decodate in memorie
  // simultan (vezi comentariul din downloadZip/streamZipEntries).
  const entries = available.map(({ name, file, folder }) => ({ path: `${folder}/${name}`, data: file }));
  const zipName = `${zipBaseName}-${new Date().toISOString().slice(0, 10)}.zip`;
  const result = await downloadZip(zipName, entries);
  return { exported: result.cancelled ? 0 : available.length, missing, method, cancelled: result.cancelled, grouped: !result.cancelled };
}
