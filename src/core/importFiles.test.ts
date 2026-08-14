/**
 * core/importFiles.test.ts
 * Bucla de import in sine (importFiles/processOne) — pana la acest audit avea
 * ZERO acoperire: importPipeline.test.ts testeaza doar functiile pure din jur
 * (decidePhotoStatus/toHashInput), iar prioritizeFacesFirst.test.ts doar
 * pre-scanarea. Aici mock-uim tot ce atinge platforma (canvas, Dexie, worker
 * pool, ContextEngine, gruparea dHash) si verificam contabilitatea buclei:
 * ce se intampla cand o poza esueaza, ce raman in urma ei, si ce se raporteaza.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── platforma (jsdom nu are nimic din astea) ────────────────────────────────
const failingDecodeNames = new Set<string>();
vi.stubGlobal('createImageBitmap', vi.fn(async (src: unknown) => {
  const name = src instanceof File ? src.name : '';
  if (failingDecodeNames.has(name)) throw new Error('decode esuata (test)');
  return { width: 100, height: 80, close: () => {} } as unknown as ImageBitmap;
}));

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag !== 'canvas') return originalCreateElement(tag);
  const canvas = originalCreateElement('canvas') as HTMLCanvasElement;
  Object.defineProperty(canvas, 'getContext', {
    value: () => ({
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(9 * 8 * 4) })
    })
  });
  Object.defineProperty(canvas, 'toBlob', {
    value: (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' }))
  });
  Object.defineProperty(canvas, 'toDataURL', { value: () => 'data:image/jpeg;base64,AA' });
  return canvas;
});

// ── Dexie ───────────────────────────────────────────────────────────────────
const putCalls: string[] = [];
vi.mock('./db', () => {
  const table = (name: string) => ({
    put: vi.fn(async () => { putCalls.push(name); }),
    get: vi.fn(async () => undefined),
    delete: vi.fn(async () => {}),
    bulkGet: vi.fn(async (ids: string[]) => ids.map(() => undefined)),
    bulkPut: vi.fn(async () => {}),
    toArray: vi.fn(async () => []),
    where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    orderBy: () => ({ keys: async () => [] })
  });
  return {
    db: {
      photos: table('photos'), thumbnails: table('thumbnails'), previews: table('previews'),
      analyses: table('analyses'), fileHandles: table('fileHandles'),
      originals: table('originals'), persons: table('persons'),
      transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn()
    }
  };
});

// ── analiza AI ──────────────────────────────────────────────────────────────
const failingAnalysisNames = new Set<string>();
let analyzedCount = 0;
vi.mock('./workerPool', async () => {
  const actual = await vi.importActual<typeof import('./workerPool')>('./workerPool');
  return {
    ...actual,
    analysisPool: {
      size: 1,
      init: vi.fn(async () => {}),
      setKnownPersons: vi.fn(async () => {}),
      analyze: vi.fn(async (photoId: string) => {
        analyzedCount++;
        if (failingAnalysisNames.has(photoId)) throw new Error('analiza esuata (test)');
        return {
          photoId, faces: [], faceCount: 1, knownFaceCount: 0, strangerCount: 1,
          bestSmile: 0.5, allEyesOpen: true, sharpness: 80, exposure: 50,
          sceneType: 'portrait', aiScore: 0, analyzedAt: Date.now(), sceneTags: ['dog']
        };
      })
    }
  };
});

vi.mock('./learning/ContextEngine', () => ({
  contextEngine: {
    init: vi.fn(async () => {}),
    predict: vi.fn(async () => ({ score: 80, probability: 0.8, contextKey: 'k', confidence: 'cold', topFactors: [] })),
    learnedWeight: vi.fn(async () => 0)
  }
}));

vi.mock('./hashComparePool', () => ({
  groupPhotosByHash: vi.fn(async () => ({ groups: [], totalGroups: 0 }))
}));

vi.mock('./nativeFaceDetection', () => ({
  isNativeFaceDetectionAvailable: () => false,
  detectFacesNative: vi.fn()
}));

import { importFiles, originalFiles, originalHandles, createCancelToken, type ImportProgress } from './importPipeline';
import type { FileSystemFileHandleLike } from './filePicker';

function jpeg(name: string): File {
  return new File(['bytes'], name, { type: 'image/jpeg' });
}

/** Analiza mock-uita e cheita pe photoId (UUID generat in processOne) — o legam de nume prin ordinea de apel. */
function failAnalysisForNthAnalyzed(): void { /* vezi testele care folosesc failingDecodeNames in schimb */ }

describe('importFiles — contabilitate si curatenie', () => {
  beforeEach(() => {
    failingDecodeNames.clear();
    failingAnalysisNames.clear();
    putCalls.length = 0;
    analyzedCount = 0;
    originalFiles.clear();
    originalHandles.clear();
    failAnalysisForNthAnalyzed();
  });

  it('importa pozele valide si le raporteaza prin onPhoto', async () => {
    const progress: ImportProgress[] = [];
    const photos: string[] = [];
    await importFiles([jpeg('a.jpg'), jpeg('b.jpg')], p => progress.push(p), item => photos.push(item.photo.fileName));

    expect(photos.sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(progress[progress.length - 1].phase).toBe('finalizat');
    expect(progress[progress.length - 1].warning).toBeUndefined();
    expect(originalFiles.size).toBe(2);
  });

  /**
   * Bug real gasit de auditul QA (scurgere de memorie) — vezi comentariul de
   * la finalul lui processOne in importPipeline.ts. Inainte, `originalFiles`
   * era populat INAINTE de decodare/analiza/scriere, deci fiecare poza esuata
   * lasa in urma un File cu un UUID pe care nicio inregistrare din DB nu-l
   * referentiaza — adica pe care nici clearSession, nici syncOriginal, nici
   * stergerea pozelor respinse nu-l mai puteau curata vreodata.
   */
  it('NU lasa in urma File-uri "fantoma" pentru pozele care esueaza la decodare', async () => {
    failingDecodeNames.add('corupta.jpg');
    const photos: string[] = [];
    const progress: ImportProgress[] = [];
    await importFiles([jpeg('corupta.jpg'), jpeg('buna.jpg')], p => progress.push(p), i => photos.push(i.photo.fileName));

    expect(photos).toEqual(['buna.jpg']);
    expect(originalFiles.size).toBe(1);
    expect([...originalFiles.values()].map(f => f.name)).toEqual(['buna.jpg']);
  });

  it('NU lasa in urma handle-uri "fantoma" pentru pozele care esueaza', async () => {
    failingDecodeNames.add('corupta.jpg');
    const handle = {} as FileSystemFileHandleLike;
    await importFiles(
      [jpeg('corupta.jpg'), jpeg('buna.jpg')], () => {}, () => {},
      undefined, undefined, undefined, [handle, handle]
    );

    expect(originalHandles.size).toBe(1);
  });

  it('raporteaza cate poze au esuat, cu motivul real, fara sa opreasca restul lotului', async () => {
    failingDecodeNames.add('c1.jpg');
    failingDecodeNames.add('c2.jpg');
    const progress: ImportProgress[] = [];
    await importFiles([jpeg('c1.jpg'), jpeg('c2.jpg'), jpeg('ok.jpg')], p => progress.push(p), () => {});

    const final = progress[progress.length - 1];
    expect(final.phase).toBe('finalizat');
    expect(final.warning).toContain('2 din 3');
    expect(final.warning).toContain('decode esuata (test)');
  });

  it('semnaleaza explicit cand niciun fisier ales nu are format suportat', async () => {
    const progress: ImportProgress[] = [];
    const groups = await importFiles([new File(['x'], 'clip.mp4', { type: 'video/mp4' })], p => progress.push(p), () => {});

    expect(groups.size).toBe(0);
    expect(progress[progress.length - 1].warning).toContain('format suportat');
    expect(originalFiles.size).toBe(0);
  });

  it('semnaleaza fisierele sarite dintr-o selectie MIXTA, fara sa le confunde cu esecuri', async () => {
    const progress: ImportProgress[] = [];
    await importFiles(
      [jpeg('a.jpg'), new File(['x'], 'clip.mp4', { type: 'video/mp4' })],
      p => progress.push(p), () => {}
    );

    const final = progress[progress.length - 1];
    expect(final.total).toBe(1); // totalul e al pozelor REALE, nu al fisierelor alese
    expect(final.warning).toContain('a fost sarit');
  });

  it('opreste lotul la anulare si raporteaza cate poze apucasera sa fie procesate', async () => {
    const token = createCancelToken();
    const progress: ImportProgress[] = [];
    const files = Array.from({ length: 8 }, (_, i) => jpeg(`p${i}.jpg`));

    await importFiles(files, p => {
      progress.push(p);
      if (p.phase === 'analiza' && p.done >= 2) token.cancelled = true;
    }, () => {}, token);

    const final = progress[progress.length - 1];
    expect(final.warning).toContain('Import anulat');
    expect(analyzedCount).toBeLessThan(files.length);
  });

  it('scrie toate tabelele unei poze in aceeasi tranzactie (photo + miniatura + preview + analiza)', async () => {
    await importFiles([jpeg('a.jpg')], () => {}, () => {});
    expect(putCalls).toEqual(expect.arrayContaining(['photos', 'thumbnails', 'previews', 'analyses']));
  });
});
