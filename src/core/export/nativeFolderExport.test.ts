import { describe, expect, it, vi, beforeEach } from 'vitest';

const pickDirectory = vi.fn<() => Promise<{ cancelled: boolean; treeUri?: string; rootDocUri?: string }>>();
const ensureDirectory = vi.fn<(o: { treeUri: string; parentDocUri: string; name: string }) => Promise<{ docUri: string }>>();
const writeFile = vi.fn<(o: { parentDocUri: string; name: string; data: string; mime: string }) => Promise<{ uri: string }>>();
const isNativePlatform = vi.fn(() => true);
const isPluginAvailable = vi.fn((_name: string) => true);

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    pickDirectory: () => pickDirectory(),
    ensureDirectory: (o: { treeUri: string; parentDocUri: string; name: string }) => ensureDirectory(o),
    writeFile: (o: { parentDocUri: string; name: string; data: string; mime: string }) => writeFile(o)
  }),
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    isPluginAvailable: (name: string) => isPluginAvailable(name)
  }
}));

import { pickNativeDirectory, isNativeFolderExportAvailable, ExportCancelledError } from './nativeFolderExport';

/**
 * Cerinta directa a utilizatorului ("la export folder, salveaza doar poza, nu si
 * folderul creat"): pe Android, foaia de partajare preda UN SINGUR fisier, deci
 * prefixul de folder era aruncat. Testele de aici verifica adaptorul care imbraca
 * plugin-ul SAF in aceeasi forma (LocalDirHandle) pe care o intoarce deja
 * showDirectoryPicker pe desktop — asa, exportul scrie subfoldere REALE pe telefon
 * prin exact aceeasi bucla (copyToDirectory), fara nicio ramura "daca e Android".
 */
describe('nativeFolderExport (adaptor SAF -> LocalDirHandle)', () => {
  beforeEach(() => {
    pickDirectory.mockReset();
    ensureDirectory.mockReset();
    writeFile.mockReset();
    isNativePlatform.mockReturnValue(true);
    isPluginAvailable.mockReturnValue(true);
    pickDirectory.mockResolvedValue({ cancelled: false, treeUri: 'content://tree/primary', rootDocUri: 'content://tree/primary/doc/root' });
    ensureDirectory.mockResolvedValue({ docUri: 'content://tree/primary/doc/Ami' });
    writeFile.mockResolvedValue({ uri: 'content://tree/primary/doc/Ami/IMG_0001.jpg' });
  });

  it('nu se declara disponibil pe web (fara Capacitor nativ)', () => {
    isNativePlatform.mockReturnValue(false);
    expect(isNativeFolderExportAvailable()).toBe(false);
  });

  it('nu se declara disponibil intr-un build nativ fara plugin-ul inregistrat (APK vechi)', () => {
    isPluginAvailable.mockReturnValue(false);
    expect(isNativeFolderExportAvailable()).toBe(false);
  });

  it('creeaza subfolderul si scrie fisierul in el — folderul de grupare ajunge REAL pe disc', async () => {
    const dir = await pickNativeDirectory();

    const sub = await dir.getDirectoryHandle('Ami', { create: true });
    const handle = await sub.getFileHandle('IMG_0001.jpg', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new File(['continut'], 'IMG_0001.jpg', { type: 'image/jpeg' }));
    await writable.close();

    expect(ensureDirectory).toHaveBeenCalledWith({
      treeUri: 'content://tree/primary',
      parentDocUri: 'content://tree/primary/doc/root',
      name: 'Ami'
    });
    // fisierul e scris in DOCUMENTUL subfolderului, nu in radacina destinatiei
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0]).toMatchObject({
      parentDocUri: 'content://tree/primary/doc/Ami',
      name: 'IMG_0001.jpg',
      mime: 'image/jpeg'
    });
  });

  it('nu scrie nimic pana la close() — SAF creeaza documentul dintr-un singur apel', async () => {
    const dir = await pickNativeDirectory();
    const handle = await dir.getFileHandle('a.jpg', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob(['x']));

    expect(writeFile).not.toHaveBeenCalled();

    await writable.close();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('deduce tipul MIME din extensie, ca providerul SAF sa nu adauge o extensie in plus', async () => {
    const dir = await pickNativeDirectory();
    for (const [name, mime] of [['a.jpg', 'image/jpeg'], ['b.png', 'image/png'], ['c.xmp', 'application/xml'], ['d.cr2', 'application/octet-stream']]) {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      // Blob fara type explicit: mime-ul trebuie sa vina din numele fisierului
      await writable.write(new Blob(['x']));
      await writable.close();
      const lastCall = writeFile.mock.calls[writeFile.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ name, mime });
    }
  });

  it('arunca ExportCancelledError cand utilizatorul inchide selectorul de folder', async () => {
    pickDirectory.mockResolvedValue({ cancelled: true });
    await expect(pickNativeDirectory()).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it('trateaza un rezultat incomplet de la plugin ca anulare, nu ca destinatie valida', async () => {
    pickDirectory.mockResolvedValue({ cancelled: false });
    await expect(pickNativeDirectory()).rejects.toBeInstanceOf(ExportCancelledError);
  });
});
