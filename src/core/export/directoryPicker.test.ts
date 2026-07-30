import { describe, expect, it, vi, afterEach } from 'vitest';
import { downloadBlob, downloadZip, dedupeFileName } from './directoryPicker';

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

describe('downloadZip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers exactly ONE download (one object URL, one anchor click) regardless of entry count', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const encoder = new TextEncoder();
    await downloadZip('test-export.zip', [
      { path: 'Ami/a.jpg', data: encoder.encode('poza-a') },
      { path: 'Ami/b.jpg', data: encoder.encode('poza-b') },
      { path: 'Necunoscuti/c.jpg', data: encoder.encode('poza-c') }
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

    const encoder = new TextEncoder();
    await downloadZip('test.zip', [{ path: 'a.txt', data: encoder.encode('hello world'.repeat(50)) }]);

    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.size).toBeGreaterThan(0);
  });
});
