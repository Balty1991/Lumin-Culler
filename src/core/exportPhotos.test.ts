import { describe, expect, it, vi, beforeEach } from 'vitest';

type PickDirectoryFn = (options?: { mode?: 'read' | 'readwrite' }) => Promise<unknown>;
const getDirectoryPicker = vi.fn<() => PickDirectoryFn | null>(() => null);
const downloadZip = vi.fn<(name: string, entries: { path: string; data: Uint8Array }[]) => Promise<{ cancelled: boolean }>>(async () => ({ cancelled: false }));
const downloadBlob = vi.fn<(name: string, blob: Blob) => Promise<{ cancelled: boolean }>>(async () => ({ cancelled: false }));

vi.mock('./export/directoryPicker', async importOriginal => {
  const actual = await importOriginal<typeof import('./export/directoryPicker')>();
  return {
    ...actual,
    getDirectoryPicker: () => getDirectoryPicker(),
    downloadZip: (name: string, entries: { path: string; data: Uint8Array }[]) => downloadZip(name, entries),
    downloadBlob: (name: string, blob: Blob) => downloadBlob(name, blob)
  };
});

// applyAdjustmentsToBlob foloseste createImageBitmap/canvas, indisponibile in
// jsdom fara pachetul `canvas` — mock-uim doar functia asta (nu tot modulul),
// ca sa testam CABLAJUL (cand se coace, cand se sare peste), nu re-desenarea
// efectiva de pixeli (deja acoperita separat, unde e posibil, in alte teste).
const applyAdjustmentsToBlob = vi.fn<(blob: Blob, adjustments: unknown) => Promise<Blob>>(
  async () => new Blob(['bytes-editate'], { type: 'image/jpeg' })
);
vi.mock('./imageAdjust', async importOriginal => {
  const actual = await importOriginal<typeof import('./imageAdjust')>();
  return { ...actual, applyAdjustmentsToBlob: (blob: Blob, adjustments: unknown) => applyAdjustmentsToBlob(blob, adjustments) };
});

// exportOriginalFiles cade pe db.originals.get() DOAR daca fisierul nu e in
// originalFiles (Map in memorie) — populam Map-ul direct, deci Dexie/IndexedDB
// nu e niciodata atins in acest test.
import { originalFiles } from './importPipeline';
import { exportOriginalFiles, computeGroupPersonUnion } from './exportPhotos';
import { NEUTRAL_ADJUSTMENTS, type EditAdjustments } from './imageAdjust';
import { ExportCancelledError } from './export/nativeFolderExport';

const REAL_EDITS: EditAdjustments = { ...NEUTRAL_ADJUSTMENTS, exposure: 20 };

function fakeFile(name: string): File {
  return new File(['continut-fals'], name, { type: 'image/jpeg' });
}

describe('exportOriginalFiles (fallback fara File System Access API)', () => {
  beforeEach(() => {
    originalFiles.clear();
    getDirectoryPicker.mockReturnValue(null);
    downloadZip.mockClear();
    downloadZip.mockResolvedValue({ cancelled: false });
    downloadBlob.mockClear();
    downloadBlob.mockResolvedValue({ cancelled: false });
    applyAdjustmentsToBlob.mockClear();
    applyAdjustmentsToBlob.mockResolvedValue(new Blob(['bytes-editate'], { type: 'image/jpeg' }));
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('exporta un singur fisier printr-o descarcare directa (downloadBlob), NU printr-un zip', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(1);
    expect(result.grouped).toBe(false);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob.mock.calls[0][0]).toBe('Peisaje/a.jpg');
    expect(downloadZip).not.toHaveBeenCalled();
  });

  it('raporteaza 0 exportate daca utilizatorul anuleaza dialogul de salvare al fisierului unic', async () => {
    downloadBlob.mockResolvedValueOnce({ cancelled: true });
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result).toMatchObject({ exported: 0, cancelled: true, grouped: false });
  });

  it('raporteaza 0 exportate daca utilizatorul anuleaza dialogul de salvare al arhivei .zip', async () => {
    downloadZip.mockResolvedValueOnce({ cancelled: true });
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' },
      { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result).toMatchObject({ exported: 0, cancelled: true, grouped: false });
  });

  it('exporta mai multe fisiere printr-o SINGURA arhiva .zip, nu prin descarcari secventiale', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    originalFiles.set('p3', fakeFile('c.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p2', fileName: 'b.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p3', fileName: 'c.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(3);
    expect(result.grouped).toBe(true);
    // exact O SINGURA arhiva, cu toate cele 3 fisiere in ea — nu 3 descarcari separate
    // (bug real reparat: descarcarile secventiale sunt blocate silentios pe multe browsere mobile)
    expect(downloadZip).toHaveBeenCalledTimes(1);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries).toHaveLength(3);
  });

  // Cerinta directa a utilizatorului: exportul unui folder personalizat
  // (state/store.ts, exportCollection) foloseste numele arhivei ca sa arate
  // clar CE folder a fost exportat, nu doar un nume generic identic pentru orice export.
  it('foloseste zipBaseName pentru numele arhivei cand e specificat (implicit "lumin-culler-export")', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    await exportOriginalFiles(
      [
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' },
        { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ],
      { zipBaseName: 'lumin-culler-Vacanta' }
    );
    const [zipName] = downloadZip.mock.calls[0];
    expect(zipName.startsWith('lumin-culler-Vacanta-')).toBe(true);
  });

  it('grupeaza corect caile din zip pe folderul de persoana/scena', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.some(e => e.path === 'Ami/a.jpg')).toBe(true);
    expect(entries.some(e => e.path === 'Peisaje/b.jpg')).toBe(true);
  });

  it('fara renameTemplate, pastreaza numele original de fisier (comportament neschimbat)', async () => {
    originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(1);
    // fisier unic => descarcare directa (downloadBlob), nu zip
    expect(downloadBlob.mock.calls[0][0]).toBe('Peisaje/IMG_0001.jpg');
  });

  // Cerinta directa a utilizatorului, dupa ce a vazut prima varianta pe device:
  // un folder personalizat pe care l-a creat SI l-a numit el e o alegere
  // explicita, mai puternica decat orice categorie dedusa de aplicatie —
  // exportul lui trebuie sa produca EXACT acel folder pe disc, nu "Ami"/
  // "Necunoscuti"/"Peisaje" derivate din persoana/scena.
  describe('folderName (export de folder personalizat)', () => {
    it('pune toate pozele in folderul denumit de utilizator, nu in cele derivate din persoana/scena', async () => {
      originalFiles.set('p1', fakeFile('a.jpg'));
      originalFiles.set('p2', fakeFile('b.jpg'));
      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
        { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ], { folderName: 'Vacanta 2026' });

      expect(result.exported).toBe(2);
      const entries = downloadZip.mock.calls[0][1];
      expect(entries.map(e => e.path).sort()).toEqual(['Vacanta 2026/a.jpg', 'Vacanta 2026/b.jpg']);
    });

    it('se aplica si pe calea unui singur fisier (cazul raportat: folder cu o poza)', async () => {
      originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'IMG_0001.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' }
      ], { folderName: 'Ami' });

      expect(result.exported).toBe(1);
      expect(downloadBlob.mock.calls[0][0]).toBe('Ami/IMG_0001.jpg');
    });

    it('curata separatorii de path din numele dat de utilizator, ca sa nu creeze niveluri neintentionate', async () => {
      originalFiles.set('p1', fakeFile('a.jpg'));
      await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ], { folderName: 'Nunta 12/07: Ana' });

      expect(downloadBlob.mock.calls[0][0]).toBe('Nunta 12-07- Ana/a.jpg');
    });

    it('fara folderName, gruparea pe persoana/scena ramane neschimbata (exportul selectiei)', async () => {
      originalFiles.set('p1', fakeFile('a.jpg'));
      await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' }
      ]);

      expect(downloadBlob.mock.calls[0][0]).toBe('Ami/a.jpg');
    });

    it('deduplicarea numelor ramane per folder de destinatie, nu se pierde cand toate pozele intra in acelasi folder', async () => {
      originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
      originalFiles.set('p2', fakeFile('IMG_0001.jpg'));
      await exportOriginalFiles([
        { id: 'p1', fileName: 'IMG_0001.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
        { id: 'p2', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ], { folderName: 'Ami' });

      const entries = downloadZip.mock.calls[0][1];
      expect(entries.map(e => e.path).sort()).toEqual(['Ami/IMG_0001 (2).jpg', 'Ami/IMG_0001.jpg']);
    });
  });

  // Bug real gasit de auditul QA (defense-in-depth — niciun File real nu
  // poate avea azi un asemenea nume, dar fileName e doar un string, fara
  // nicio validare la runtime): un "../" literal in numele original nu mai
  // trebuie sa poata scapa din folderul de destinatie ca path de intrare in
  // arhiva zip (tiparul clasic "zip-slip").
  it('sanitizeaza separatorii de path dintr-un nume de fisier nesigur (fara renameTemplate)', async () => {
    originalFiles.set('p1', fakeFile('evil.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: '../../etc/evil.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(1);
    const [path] = downloadBlob.mock.calls[0];
    expect(path.startsWith('Peisaje/')).toBe(true);
    // numele (portiunea dupa folder/) nu mai poate contine niciun separator
    // de path — indiferent cate "/" erau in numele original, ele devin "-"
    const name = path.slice('Peisaje/'.length);
    expect(name).not.toMatch(/[/\\]/);
  });

  // Bug real gasit de auditul QA: doua poze cu acelasi nume de fisier
  // (frecvent la import din carduri de memorie diferite ale aceleiasi
  // camere) se suprascriau silentios una pe alta in zip (aceeasi cheie de
  // path), iar `exported` raporta numarul initial desi arhiva continea
  // mai putine fisiere.
  it('dezambiguizeaza doua poze cu acelasi nume de fisier in acelasi folder de export', async () => {
    originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
    originalFiles.set('p2', fakeFile('IMG_0001.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' },
      { id: 'p2', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(2);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.map(e => e.path).sort()).toEqual(['Peisaje/IMG_0001 (2).jpg', 'Peisaje/IMG_0001.jpg']);
  });

  it('nu dezambiguizeaza doua poze cu acelasi nume daca ajung in foldere diferite (nicio coliziune reala)', async () => {
    originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
    originalFiles.set('p2', fakeFile('IMG_0001.jpg'));
    await exportOriginalFiles([
      { id: 'p1', fileName: 'IMG_0001.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p2', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.map(e => e.path).sort()).toEqual(['Ami/IMG_0001.jpg', 'Peisaje/IMG_0001.jpg']);
  });

  it('cu renameTemplate, redenumeste fiecare fisier din zip dupa sablon si numeroteaza secvential', async () => {
    originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
    originalFiles.set('p2', fakeFile('IMG_0002.jpg'));
    await exportOriginalFiles(
      [
        { id: 'p1', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', client: 'Ana', event: 'Nunta' },
        { id: 'p2', fileName: 'IMG_0002.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', client: 'Ana', event: 'Nunta' }
      ],
      { renameTemplate: '{client}_{eveniment}_{secventa}' }
    );
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.map(e => e.path).sort()).toEqual(['Peisaje/Ana_Nunta_001.jpg', 'Peisaje/Ana_Nunta_002.jpg']);
  });

  // Bug real gasit de auditul QA: PhotoRecord.edits (ajustari din "Editare de
  // baza") era persistat corect, dar exportul real de fisiere livra mereu
  // originalul neschimbat — singura cale care aplica ajustari era galeria de
  // client (thumbnail, opt-in), niciodata "Exporta poze".
  it('coace ajustarile reale in fisierul exportat', async () => {
    originalFiles.set('p1', fakeFile('IMG_0001.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'IMG_0001.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', edits: REAL_EDITS }
    ]);
    expect(result.exported).toBe(1);
    expect(applyAdjustmentsToBlob).toHaveBeenCalledTimes(1);
    const [blobArg] = applyAdjustmentsToBlob.mock.calls[0];
    expect(blobArg).toBe(originalFiles.get('p1'));
  });

  it('nu coace nimic cand adjustments sunt neutre (absent sau toate 0)', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' },
      { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', edits: NEUTRAL_ADJUSTMENTS }
    ]);
    expect(applyAdjustmentsToBlob).not.toHaveBeenCalled();
  });

  it('nu coace ajustari intr-un fisier RAW (nicio cale de reinjectat intr-un format proprietar)', async () => {
    originalFiles.set('p1', new File(['bytes-raw'], 'DSC_0001.ARW', { type: 'application/octet-stream' }));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'DSC_0001.ARW', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', edits: REAL_EDITS }
    ]);
    expect(applyAdjustmentsToBlob).not.toHaveBeenCalled();
    expect(result.exported).toBe(1);
    // fisierul RAW original, neschimbat, sub numele lui original
    expect(downloadBlob.mock.calls[0][0]).toBe('Peisaje/DSC_0001.ARW');
  });

  it('corecteaza extensia la .jpg cand originalul nu era deja JPEG (re-encode-ul e mereu JPEG)', async () => {
    originalFiles.set('p1', new File(['bytes-png'], 'a.png', { type: 'image/png' }));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.png', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', edits: REAL_EDITS }
    ]);
    expect(result.exported).toBe(1);
    expect(downloadBlob.mock.calls[0][0]).toBe('Peisaje/a.jpg');
  });

  // Cerinta directa a utilizatorului: foldere de export dupa categoria de
  // scena/obiect (nu doar persoane), acum ca detectia de obiecte e legata in
  // fluxul real de analiza (vezi core/sceneTagLabels.ts, pickFolderSceneTag).
  it('foloseste prima eticheta de scena concreta ca folder cand nu exista nicio fata', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', sceneTags: ['park', 'dog'] }
    ]);
    expect(result.exported).toBe(1);
    expect(downloadBlob.mock.calls[0][0]).toBe('Parc/a.jpg');
  });

  it('sare peste etichetele abstracte/generice (fara valoare ca nume de folder) si foloseste prima eticheta concreta', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', sceneTags: ['Fun', 'Vacation', 'Beach'] }
    ]);
    expect(result.exported).toBe(1);
    expect(downloadBlob.mock.calls[0][0]).toBe('Plaja/a.jpg');
  });

  it('ramane pe Peisaje/Detalii cand toate etichetele sunt abstracte sau lipsesc (comportament neschimbat)', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', sceneTags: ['Fun', 'Selfie'] },
      { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'other', sceneTags: [] }
    ]);
    expect(result.exported).toBe(2);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.map(e => e.path).sort()).toEqual(['Detalii/b.jpg', 'Peisaje/a.jpg']);
  });

  it('fata (chiar nerecunoscuta) ramane mai prioritara decat eticheta de scena pentru numele folderului', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 1, strangerCount: 1, sceneType: 'portrait', sceneTags: ['park'] }
    ]);
    expect(result.exported).toBe(1);
    expect(downloadBlob.mock.calls[0][0]).toBe('Necunoscuți/a.jpg');
  });

  it('exporta folderul de scena in engleza cand locale e "en"', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles(
      [{ id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', sceneTags: ['park'] }],
      { locale: 'en' }
    );
    expect(result.exported).toBe(1);
    expect(downloadBlob.mock.calls[0][0]).toBe('Park/a.jpg');
  });

  // Bug real raportat de utilizator (confirmat pe device, build Play Store):
  // showDirectoryPicker poate fi DETECTAT (functie prezenta pe window) dar
  // arunca la runtime (ex. NotAllowedError "User activation required" dupa
  // ce gap-uri async ii consuma gestul utilizatorului) — exportul nu mai
  // trebuie sa esueze complet in acest caz, ci sa cada pe fallback-ul de
  // descarcari, la fel ca atunci cand API-ul lipseste de tot.
  describe('showDirectoryPicker detectat dar nefunctional la runtime', () => {
    it('cade pe descarcare directa (downloadBlob) cand pickDirectory arunca NotAllowedError, nu AbortError', async () => {
      const pickDirectory = vi.fn<PickDirectoryFn>(async () => {
        throw new DOMException('User activation required.', 'NotAllowedError');
      });
      getDirectoryPicker.mockReturnValue(pickDirectory);
      originalFiles.set('p1', fakeFile('a.jpg'));

      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ]);

      expect(pickDirectory).toHaveBeenCalledTimes(1);
      expect(result.exported).toBe(1);
      expect(result.method).toBe('downloads');
      expect(result.cancelled).toBe(false);
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    it('cade pe zip cand exista mai multe poze si pickDirectory arunca o eroare care nu e o anulare reala', async () => {
      const pickDirectory = vi.fn<PickDirectoryFn>(async () => {
        throw new Error('unexpected runtime failure');
      });
      getDirectoryPicker.mockReturnValue(pickDirectory);
      originalFiles.set('p1', fakeFile('a.jpg'));
      originalFiles.set('p2', fakeFile('b.jpg'));

      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' },
        { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ]);

      expect(result.exported).toBe(2);
      expect(result.method).toBe('downloads');
      expect(downloadZip).toHaveBeenCalledTimes(1);
    });

    it('ramane raportat ca anulare reala (cancelled: true) cand pickDirectory arunca AbortError DUPA o interactiune reala — NU cade pe fallback', async () => {
      // 600ms > INSTANT_ABORT_THRESHOLD_MS: timpul real in care omul vede dialogul
      // nativ si apasa "Anuleaza" (vezi testul urmator pentru abandonul instant)
      const pickDirectory = vi.fn<PickDirectoryFn>(async () => {
        await new Promise(r => setTimeout(r, 600));
        throw new DOMException('The user aborted a request.', 'AbortError');
      });
      getDirectoryPicker.mockReturnValue(pickDirectory);
      originalFiles.set('p1', fakeFile('a.jpg'));

      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ]);

      expect(result.exported).toBe(0);
      expect(result.cancelled).toBe(true);
      expect(result.method).toBe('folder');
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(downloadZip).not.toHaveBeenCalled();
    });

    // Bug real raportat de utilizator (pe device): tap pe Exporta -> toast-ul
    // "Se exporta..." ramanea pe ecran la infinit, fara fisier si fara eroare.
    // Cauza: un AbortError INSTANT de la un showDirectoryPicker expus dar
    // nefunctional era luat drept anulare a utilizatorului, deci exportul se
    // oprea cu cancelled=true si apelantul (state/store.ts) iesea fara sa mai
    // atinga toast-ul de progres. Un abandon instant nu poate fi o anulare
    // reala (nu a existat timp sa vada dialogul) -> fallback pe descarcari.
    it('nu ramane agatat daca aplicarea editarilor (createImageBitmap/toBlob) nu se termina niciodata — exporta originalul needitat', async () => {
      vi.useFakeTimers();
      try {
        applyAdjustmentsToBlob.mockReturnValue(new Promise<Blob>(() => {})); // niciodata rezolvat
        originalFiles.set('p1', fakeFile('a.jpg'));

        const resultPromise = exportOriginalFiles([
          { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape', edits: REAL_EDITS }
        ]);
        await vi.advanceTimersByTimeAsync(31000); // > BAKE_TIMEOUT_MS
        const result = await resultPromise;

        expect(result.exported).toBe(1);
        expect(result.cancelled).toBe(false);
        expect(downloadBlob.mock.calls[0][0]).toBe('Peisaje/a.jpg');
      } finally {
        vi.useRealTimers();
      }
    });

    it('cade pe descarcari cand pickDirectory respinge cu AbortError INSTANT (API expus dar nefunctional, nu o anulare reala)', async () => {
      const pickDirectory = vi.fn<PickDirectoryFn>(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      });
      getDirectoryPicker.mockReturnValue(pickDirectory);
      originalFiles.set('p1', fakeFile('a.jpg'));

      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ]);

      expect(result.cancelled).toBe(false);
      expect(result.exported).toBe(1);
      expect(result.method).toBe('downloads');
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    // Selectorul NATIV de folder (SAF, Android) raporteaza anularea neechivoc,
    // ca rezultat al unei activitati reale a sistemului — spre deosebire de web,
    // nu are nevoie de pragul de timp ca sa fie crezut. O anulare instanta de
    // acolo NU trebuie sa cada pe fallback si sa deschida o foaie de partajare
    // peste dialogul pe care tocmai l-a inchis utilizatorul.
    it('trateaza ExportCancelledError (selectorul nativ SAF) ca anulare reala, chiar instant', async () => {
      const pickDirectory = vi.fn<PickDirectoryFn>(async () => { throw new ExportCancelledError(); });
      getDirectoryPicker.mockReturnValue(pickDirectory);
      originalFiles.set('p1', fakeFile('a.jpg'));

      const result = await exportOriginalFiles([
        { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
      ]);

      expect(result.cancelled).toBe(true);
      expect(result.exported).toBe(0);
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(downloadZip).not.toHaveBeenCalled();
    });

    it('nu ramane agatat la infinit daca pickDirectory nu rezolva/respinge niciodata — cade pe descarcari dupa timeout', async () => {
      vi.useFakeTimers();
      try {
        const pickDirectory = vi.fn<PickDirectoryFn>(() => new Promise<never>(() => {}));
        getDirectoryPicker.mockReturnValue(pickDirectory);
        originalFiles.set('p1', fakeFile('a.jpg'));

        const resultPromise = exportOriginalFiles([
          { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
        ]);
        await vi.advanceTimersByTimeAsync(301000); // > DIRECTORY_PICKER_TIMEOUT_MS
        const result = await resultPromise;

        expect(result.cancelled).toBe(false);
        expect(result.exported).toBe(1);
        expect(result.method).toBe('downloads');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('computeGroupPersonUnion', () => {
  it('unites person names recognized anywhere in the same burst/series (groupId)', () => {
    // bug real: cadrul p1 a ratat-o pe Angi (unghi/miscare), dar p2 din ACEEASI
    // serie a recunoscut-o clar pe amandoua — unirea trebuie sa reflecte asta
    const union = computeGroupPersonUnion([
      { groupId: 'g1', personNames: ['Ami'] },
      { groupId: 'g1', personNames: ['Ami', 'Angi'] },
      { groupId: 'g1', personNames: ['Angi'] }
    ]);
    expect(union.get('g1')?.sort()).toEqual(['Ami', 'Angi']);
  });

  it('keeps separate groups independent', () => {
    const union = computeGroupPersonUnion([
      { groupId: 'g1', personNames: ['Ami'] },
      { groupId: 'g2', personNames: ['Angi'] }
    ]);
    expect(union.get('g1')).toEqual(['Ami']);
    expect(union.get('g2')).toEqual(['Angi']);
  });

  it('ignores photos without a groupId (not part of any series)', () => {
    const union = computeGroupPersonUnion([{ personNames: ['Ami'] }]);
    expect(union.size).toBe(0);
  });
});
