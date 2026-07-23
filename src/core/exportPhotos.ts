/**
 * core/exportPhotos.ts
 * Exporta fotografiile SELECTATE ca fisiere reale, in formatul original
 * (aceiasi bytes/extensie ca la import), nu doar o lista de nume.
 *
 * Cale principala: File System Access API (showDirectoryPicker) — utilizatorul
 * alege un folder, fisierele sunt copiate direct pe disc unul cate unul
 * (streaming, fara sa tina 1000+ poze originale in memorie simultan).
 * Disponibila in Chromium desktop si Electron; NU si in Safari/WebKit sau
 * in WebView-urile mobile (Capacitor), unde se trece pe fallback.
 *
 * Fallback universal: descarcari secventiale ale fiecarui fisier original,
 * cu numele lor originale — functioneaza peste tot, dar browserul poate
 * cere confirmare pentru descarcari multiple (limitare de securitate a
 * browserului, nu a aplicatiei).
 */
import { originalFiles } from './importPipeline';
import { db } from './db';
import { getDirectoryPicker, type LocalDirHandle } from './export/directoryPicker';

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
}

// ── Grupare pe foldere: persoane cunoscute (si combinatii), apoi scena ─────
// Ex: "Ami" / "Ami si eu" / "Ami, eu si sotia" / "Ami si altii" (cunoscuti +
// straini) / "Necunoscuti" (doar straini) / "Peisaje" / "Detalii" (fara fete,
// cadru apropiat). NU include o categorie "Animale" — ar necesita un detector
// de obiecte separat (dezactivat momentan), nu doar recunoasterea de fete
// deja existenta; nu e simulat aici.
const ILLEGAL_PATH_CHARS = /[\\/:*?"<>|]/g;

function sanitizeSegment(s: string): string {
  const clean = s.replace(ILLEGAL_PATH_CHARS, '-').trim();
  return clean || 'necunoscut';
}

export function folderLabel(p: { personNames: string[]; faceCount: number; strangerCount: number; sceneType: string }): string {
  if (p.personNames.length > 0) {
    const names = [...p.personNames].sort((a, b) => a.localeCompare(b, 'ro'));
    const base = names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} și ${names[1]}`
      : `${names.slice(0, -1).join(', ')} și ${names[names.length - 1]}`;
    return sanitizeSegment(p.strangerCount > 0 ? `${base} și alții` : base);
  }
  if (p.faceCount > 0) return 'Necunoscuți';
  if (p.sceneType === 'landscape') return 'Peisaje';
  return 'Detalii';
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
/**
 * NU revocam URL-ul dupa un delay scurt: pe Android, click() pe <a download>
 * preda descarcarea catre managerul de descarcari al SO, care citeste
 * continutul blob: URL-ului ASINCRON, in fundal — pentru fisiere originale
 * mari (poze de cativa MB), acest transfer poate dura mai mult decat orice
 * timeout scurt "rezonabil". Daca revocam URL-ul inainte sa termine, primim
 * exact "Eroare de retea" in Descarcari, in timp ce codul JS (care nu are
 * niciun semnal de finalizare reala de la click()) tot raporteaza succes —
 * bug real gasit din screenshot-ul utilizatorului. Lasam URL-urile sa fie
 * curatate natural de browser la inchiderea/reincarcarea paginii.
 */
function downloadOne(name: string, file: File, folder: string): Promise<void> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folder}/${name}`;
    a.click();
    setTimeout(resolve, 250); // doar spatiere intre descarcari succesive, NU revocare
  });
}

export async function exportOriginalFiles(photos: ExportPhotoInput[]): Promise<ExportResult> {
  const available: { name: string; file: File; folder: string }[] = [];
  const missing: string[] = [];
  for (const p of photos) {
    const folder = folderLabel(p);
    const inMemory = originalFiles.get(p.id);
    if (inMemory) {
      available.push({ name: p.fileName, file: inMemory, folder });
      continue;
    }
    // fallback: fisierul original persistat in IndexedDB (poze selectate,
    // supravietuieste unui reload de tab — vezi core/db.ts OriginalRecord)
    const stored = await db.originals.get(p.id);
    if (stored) available.push({ name: p.fileName, file: new File([stored.blob], stored.fileName, { type: stored.type }), folder });
    else missing.push(p.fileName);
  }

  const pickDirectory = getDirectoryPicker();
  const method: ExportResult['method'] = pickDirectory ? 'folder' : 'downloads';

  if (!available.length) return { exported: 0, missing, method, cancelled: false, grouped: false };

  if (pickDirectory) {
    let dir: LocalDirHandle;
    try {
      dir = await pickDirectory({ mode: 'readwrite' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { exported: 0, missing, method, cancelled: true, grouped: false };
      }
      throw err;
    }
    await copyToDirectory(available, dir);
    return { exported: available.length, missing, method, cancelled: false, grouped: true };
  }

  for (const { name, file, folder } of available) await downloadOne(name, file, folder);
  return { exported: available.length, missing, method, cancelled: false, grouped: false };
}
