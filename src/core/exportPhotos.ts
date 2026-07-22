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

export interface ExportResult {
  exported: number;
  missing: string[];       // fileName-uri fara File original disponibil (necesita reimport)
  method: 'folder' | 'downloads';
  cancelled: boolean;
}

interface LocalWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface LocalFileHandle {
  createWritable(): Promise<LocalWritable>;
}
interface LocalDirHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
}
interface DirectoryPickerWindow {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<LocalDirHandle>;
}

function getDirectoryPicker(): DirectoryPickerWindow['showDirectoryPicker'] | null {
  const w = window as unknown as Partial<DirectoryPickerWindow>;
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(w) : null;
}

async function copyToDirectory(files: { name: string; file: File }[], dir: LocalDirHandle): Promise<void> {
  for (const { name, file } of files) {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
  }
}

function downloadOne(name: string, file: File): Promise<void> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 250);
  });
}

export async function exportOriginalFiles(
  photos: { id: string; fileName: string }[]
): Promise<ExportResult> {
  const available: { name: string; file: File }[] = [];
  const missing: string[] = [];
  for (const p of photos) {
    const inMemory = originalFiles.get(p.id);
    if (inMemory) {
      available.push({ name: p.fileName, file: inMemory });
      continue;
    }
    // fallback: fisierul original persistat in IndexedDB (poze selectate,
    // supravietuieste unui reload de tab — vezi core/db.ts OriginalRecord)
    const stored = await db.originals.get(p.id);
    if (stored) available.push({ name: p.fileName, file: new File([stored.blob], stored.fileName, { type: stored.type }) });
    else missing.push(p.fileName);
  }

  const pickDirectory = getDirectoryPicker();
  const method: ExportResult['method'] = pickDirectory ? 'folder' : 'downloads';

  if (!available.length) return { exported: 0, missing, method, cancelled: false };

  if (pickDirectory) {
    let dir: LocalDirHandle;
    try {
      dir = await pickDirectory({ mode: 'readwrite' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { exported: 0, missing, method, cancelled: true };
      }
      throw err;
    }
    await copyToDirectory(available, dir);
    return { exported: available.length, missing, method, cancelled: false };
  }

  for (const { name, file } of available) await downloadOne(name, file);
  return { exported: available.length, missing, method, cancelled: false };
}
