/**
 * core/export/directoryPicker.ts
 * Wrapper minimal peste File System Access API (showDirectoryPicker), comun
 * exportului de fotografii si celui de sidecar-uri XMP — evita duplicarea
 * acelorasi tipuri/verificare de suport in doua fisiere.
 */

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

/**
 * Disponibil in Chromium desktop si Electron; NU si in Safari/WebKit sau
 * in WebView-urile mobile (Android Chrome/Brave inclus) — apelantul trebuie
 * sa aiba mereu un fallback de descarcari pentru cazul null.
 */
export function getDirectoryPicker(): DirectoryPickerWindow['showDirectoryPicker'] | null {
  const w = window as unknown as Partial<DirectoryPickerWindow>;
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(w) : null;
}

export async function writeTextFile(dir: LocalDirHandle, name: string, content: string, type: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([content], { type }));
  await writable.close();
}

/**
 * NU revocam URL-ul dupa un delay scurt: pe Android, managerul de descarcari
 * al SO citeste continutul blob: URL-ului ASINCRON, in fundal — daca revocam
 * inainte sa termine, transferul pica cu "Eroare de retea" desi codul JS
 * (fara niciun semnal real de finalizare de la click()) tot raporteaza
 * succes. Lasam URL-urile sa fie curatate natural la inchiderea paginii.
 */
export function downloadBlob(name: string, blob: Blob): Promise<void> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(resolve, 250); // doar spatiere intre descarcari succesive, NU revocare
  });
}
