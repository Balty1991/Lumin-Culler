import { describe, expect, it, vi, afterEach } from 'vitest';

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => isNativePlatform() } };
});
const writeFile = vi.fn();
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: (...args: unknown[]) => writeFile(...args) }, Directory: { Cache: 'CACHE' } }));
const share = vi.fn();
vi.mock('@capacitor/share', () => ({ Share: { share: (...args: unknown[]) => share(...args) } }));

import { downloadBlob, downloadZip, dedupeFileName, getDirectoryPicker } from './directoryPicker';

describe('dedupeFileName', () => {
  it('leaves the first occurrence of a name unchanged', () => {
    const used = new Set<string>();
    expect(dedupeFileName(used, 'IMG_0001.jpg')).toBe('IMG_0001.jpg');
  });

  it('appends a numbered suffix before the extension on collision', () => {
    const used = new Set<string>();
    dedupeFileName(used, 'IMG_0001.jpg');
    expect(dedupeFileName(used, 'IMG_0001.jpg')).toBe('IMG_0001 (2).jpg');
  });

  it('keeps counting up across repeated collisions with the same base name', () => {
    const used = new Set<string>();
    dedupeFileName(used, 'a.jpg');
    dedupeFileName(used, 'a.jpg');
    dedupeFileName(used, 'a.jpg');
    expect(dedupeFileName(used, 'a.jpg')).toBe('a (4).jpg');
  });

  it('does not collide with a manually pre-existing numbered variant', () => {
    const used = new Set<string>(['a.jpg', 'a (2).jpg']);
    expect(dedupeFileName(used, 'a.jpg')).toBe('a (3).jpg');
  });

  it('handles extensionless names', () => {
    const used = new Set<string>();
    dedupeFileName(used, 'IMG_0001');
    expect(dedupeFileName(used, 'IMG_0001')).toBe('IMG_0001 (2)');
  });
});

/**
 * showSaveFilePicker nu exista in jsdom (window.showSaveFilePicker e undefined),
 * deci testele existente mai jos (fara stub) exerseaza deja fallback-ul <a
 * download> exact ca inainte. Testele din acest describe stub-uiesc explicit
 * API-ul ca sa acopere calea PRINCIPALA (File System Access), adaugata pentru
 * bug-ul real raportat: <a download> + click() sintetic ignorat silentios pe
 * Brave/Android (PWA instalat), fara nicio eroare vizibila.
 */
describe('downloadBlob — File System Access API (showSaveFilePicker)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  it('foloseste showSaveFilePicker in loc de <a download> cand e disponibil', async () => {
    const write = vi.fn<(data: Blob) => Promise<void>>(async () => {});
    const close = vi.fn<() => Promise<void>>(async () => {});
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const blob = new Blob(['continut'], { type: 'application/json' });
    const result = await downloadBlob('backup.json', blob);

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'backup.json' });
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled(); // NU trece si prin fallback-ul <a download>
    expect(result).toEqual({ cancelled: false });
  });

  it('raporteaza { cancelled: true } cand utilizatorul anuleaza dialogul de salvare (AbortError dupa o interactiune reala), fara sa mai incerce fallback-ul', async () => {
    // simuleaza timpul real necesar ca omul sa vada dialogul nativ si sa apese
    // "Anuleaza" — sub acest prag, un AbortError nu poate fi o anulare reala
    // (vezi testul urmator, care acopera exact acel caz)
    const showSaveFilePicker = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 600));
      throw new DOMException('Anulat', 'AbortError');
    });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await downloadBlob('backup.json', new Blob(['x']));

    expect(result).toEqual({ cancelled: true });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('cade pe fallback-ul <a download> daca showSaveFilePicker respinge cu AbortError INSTANT (API detectat dar nefunctional, nu o anulare reala)', async () => {
    // reprodus direct: intr-un context fara UI capabila sa afiseze dialogul
    // nativ, showSaveFilePicker respinge cu AbortError imediat — imposibil sa
    // fie o anulare reala de la utilizator (nu a existat timp sa vada dialogul)
    const showSaveFilePicker = vi.fn(async () => { throw new DOMException('Anulat', 'AbortError'); });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await downloadBlob('backup.json', new Blob(['x']));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ cancelled: false });
  });

  it('cade pe fallback-ul <a download> daca showSaveFilePicker esueaza cu o alta eroare decat anularea', async () => {
    const showSaveFilePicker = vi.fn(async () => { throw new Error('restrictionat in acest context'); });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await downloadBlob('backup.json', new Blob(['x']));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ cancelled: false });
  });

  it('cade pe fallback-ul <a download> daca showSaveFilePicker ramane blocat la nesfarsit (nu rezolva/respinge niciodata)', async () => {
    vi.useFakeTimers();
    try {
      // simuleaza exact ce s-a observat real intr-un context headless/fara UI: promisiunea
      // nu se rezolva/respinge NICIODATA de la sine — doar timeout-ul absolut ne scoate din ea
      const showSaveFilePicker = vi.fn(() => new Promise<never>(() => {}));
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const resultPromise = downloadBlob('backup.json', new Blob(['x']));
      // 45000ms (acelasi prag ca ABSOLUTE_FALLBACK_MS din pickerWatchdog.ts) pentru race-ul
      // de timeout, plus cele 250ms ale fallback-ului <a download> care urmeaza dupa el
      await vi.advanceTimersByTimeAsync(46000);
      const result = await resultPromise;

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ cancelled: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Bug real raportat de utilizator: "Se exporta..." ramanea agatat la infinit,
 * IDENTIC, chiar si dupa ce toate celelalte cai native (Filesystem.writeFile/
 * Share.share, coacerea editarilor) au primit deja timeout — pentru ca
 * exportOriginalFiles/exportXMP incearca ÎNTÂI showDirectoryPicker, inainte sa
 * ajunga vreodata la caile deja reparate. Acelasi tipar ca la showSaveFilePicker
 * mai sus (vezi testul "ramane blocat la nesfarsit" din describe-ul precedent).
 */
describe('getDirectoryPicker — showDirectoryPicker detectat dar blocat la nesfarsit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'showDirectoryPicker');
    vi.useRealTimers();
  });

  it('intoarce null cand showDirectoryPicker nu exista pe window', () => {
    expect(getDirectoryPicker()).toBeNull();
  });

  it('respinge in loc sa ramana blocata la nesfarsit cand showDirectoryPicker nu se rezolva/respinge niciodata', async () => {
    vi.useFakeTimers();
    const showDirectoryPicker = vi.fn(() => new Promise<never>(() => { /* niciodata rezolvata, simuleaza blocarea reala */ }));
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = showDirectoryPicker;

    const pick = getDirectoryPicker();
    expect(pick).not.toBeNull();
    const resultPromise = pick!({ mode: 'readwrite' });
    const assertion = expect(resultPromise).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(45000);
    await assertion;
  });
});

/**
 * Bug real raportat de utilizator pe device (build Play Store): tap pe Exporta
 * arata toast-ul "Se exporta...", apoi NIMIC — nici eroare, nici foaia de
 * partajare, la infinit. Testele astea acopera calea Android nativa
 * (saveViaNativeShare, ne-testata deloc inainte) — in special garantia noua ca
 * un apel catre puntea Capacitor (Filesystem.writeFile/Share.share) care nu se
 * rezolva NICIODATA nu mai blocheaza exportul la infinit, silentios.
 */
describe('downloadBlob — Android nativ (Capacitor Filesystem + Share)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    isNativePlatform.mockReturnValue(false);
    writeFile.mockReset();
    share.mockReset();
  });

  it('scrie in Directory.Cache si deschide foaia de partajare nativa cand ruleaza pe Android', async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: 'file:///cache/export.zip' });
    share.mockResolvedValue({ activityType: 'com.example.files' });

    const result = await downloadBlob('export.zip', new Blob(['x']));

    expect(result).toEqual({ cancelled: false });
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'export.zip', directory: 'CACHE' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///cache/export.zip', title: 'export.zip' }));
  });

  it('nu trateaza o anulare reala a foii de partajare (utilizatorul a inchis-o) ca eroare', async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: 'file:///cache/export.zip' });
    share.mockRejectedValue(new Error('Share canceled'));

    const result = await downloadBlob('export.zip', new Blob(['x']));

    expect(result).toEqual({ cancelled: false });
  });

  it('propaga o eroare reala (non-anulare) de la Share.share, in loc sa o inghita silentios', async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: 'file:///cache/export.zip' });
    share.mockRejectedValue(new Error('Can\'t share while sharing is in progress'));

    await expect(downloadBlob('export.zip', new Blob(['x']))).rejects.toThrow('sharing is in progress');
  });

  it('esueaza cu un mesaj clar (nu blocheaza la infinit) daca Filesystem.writeFile nu se rezolva niciodata', async () => {
    vi.useFakeTimers();
    try {
      isNativePlatform.mockReturnValue(true);
      writeFile.mockReturnValue(new Promise(() => {})); // niciodata rezolvat/respins — exact simptomul raportat
      share.mockResolvedValue({ activityType: '' });

      const resultPromise = downloadBlob('export.zip', new Blob(['x']));
      const assertion = expect(resultPromise).rejects.toThrow('Scrierea fisierului');
      await vi.advanceTimersByTimeAsync(15001);
      await assertion;
      expect(share).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('esueaza cu un mesaj clar (nu blocheaza la infinit) daca Share.share nu se rezolva niciodata', async () => {
    vi.useFakeTimers();
    try {
      isNativePlatform.mockReturnValue(true);
      writeFile.mockResolvedValue({ uri: 'file:///cache/export.zip' });
      share.mockReturnValue(new Promise(() => {})); // niciodata rezolvat/respins

      const resultPromise = downloadBlob('export.zip', new Blob(['x']));
      const assertion = expect(resultPromise).rejects.toThrow('Deschiderea meniului de partajare');
      await vi.advanceTimersByTimeAsync(30001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('downloadZip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers exactly ONE download (one object URL, one anchor click) regardless of entry count', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadZip('test-export.zip', [
      { path: 'Ami/a.jpg', data: new Blob(['poza-a']) },
      { path: 'Ami/b.jpg', data: new Blob(['poza-b']) },
      { path: 'Necunoscuti/c.jpg', data: new Blob(['poza-c']) }
    ]);

    // un singur URL.createObjectURL + un singur click — indiferent ca zipul contine 3 fisiere,
    // rezultatul e O SINGURA descarcare, nu 3 (bug real reparat aici: descarcarile secventiale
    // multiple sunt blocate silentios de multe browsere mobile dupa prima)
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/zip');
  });

  it('produces a zip blob with non-trivial size for multiple entries', async () => {
    let capturedBlob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:mock-url'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadZip('test.zip', [{ path: 'a.txt', data: new Blob(['hello world'.repeat(50)]) }]);

    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.size).toBeGreaterThan(0);
  });

  it('reads and archives entries one at a time, not all at once (bounded peak memory for large exports)', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    let concurrentReads = 0;
    let maxConcurrentReads = 0;
    const makeTrackedBlob = (content: string): Blob => {
      const blob = new Blob([content]);
      const original = blob.arrayBuffer.bind(blob);
      blob.arrayBuffer = async () => {
        concurrentReads += 1;
        maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
        await new Promise(r => setTimeout(r, 5));
        const result = await original();
        concurrentReads -= 1;
        return result;
      };
      return blob;
    };

    await downloadZip('test-sequential.zip', [
      { path: 'a.jpg', data: makeTrackedBlob('a') },
      { path: 'b.jpg', data: makeTrackedBlob('b') },
      { path: 'c.jpg', data: makeTrackedBlob('c') }
    ]);

    expect(maxConcurrentReads).toBe(1);
  });

  it('streams directly to the picked file (no full-archive Blob ever built) when showSaveFilePicker is available', async () => {
    const writes: Blob[] = [];
    const write = vi.fn(async (data: Blob) => { writes.push(data); });
    const close = vi.fn(async () => {});
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;

    const result = await downloadZip('test-stream.zip', [
      { path: 'a.jpg', data: new Blob(['poza-a']) },
      { path: 'b.jpg', data: new Blob(['poza-b']) }
    ]);

    expect(result).toEqual({ cancelled: false });
    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'test-stream.zip' });
    expect(writes.length).toBeGreaterThan(0); // scris in bucati, direct pe disc
    expect(close).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled(); // NU trece deloc prin fallback-ul <a download>

    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
});
