import { describe, expect, it, vi, beforeEach } from 'vitest';

// prioritizeFacesFirst() decodeaza fiecare fisier la o rezolutie mica si
// apeleaza detectFacesNative() — nici createImageBitmap/canvas, nici plugin-ul
// nativ nu exista in jsdom, deci mock-uim intregul lant, capat la capat,
// pastrand identitatea fisierului prin el (bitmap -> canvas -> blob poarta
// numele fisierului sursa, ca detectFacesNative sa poata raspunde diferit per
// fisier in teste, in ciuda concurentei reale din interiorul functiei).
const isNativeFaceDetectionAvailable = vi.fn(() => true);
const facesByFileName = new Map<string, boolean>();
// Sursa e acum { blob } SAU { uri } — pre-scanarea foloseste URI-ul de galerie
// cand exista (nicio decodare in JS), altfel calea veche cu blob.
type Source = { blob?: Blob; uri?: string };
type Options = { fast?: boolean } | undefined;
const detectFacesNative = vi.fn(async (source: Source, _options?: Options) => {
  const name = source.uri ?? (source.blob ? await source.blob.text() : '');
  const hasFace = facesByFileName.get(name) ?? false;
  return { faces: hasFace ? [{ boundingBox: { left: 0, top: 0, width: 1, height: 1 } }] : [], imageWidth: 1, imageHeight: 1 };
});
vi.mock('./nativeFaceDetection', () => ({
  isNativeFaceDetectionAvailable: () => isNativeFaceDetectionAvailable(),
  detectFacesNative: (source: Source, options?: Options) => detectFacesNative(source, options)
}));

const failingDecodeNames = new Set<string>();

vi.stubGlobal('createImageBitmap', vi.fn(async (file: File) => {
  if (failingDecodeNames.has(file.name)) throw new Error('decode esuata (test)');
  return { width: 10, height: 10, close: () => {}, __name: file.name } as unknown as ImageBitmap;
}));

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag !== 'canvas') return originalCreateElement(tag);
  const canvas = originalCreateElement('canvas') as HTMLCanvasElement & { __sourceName?: string };
  Object.defineProperty(canvas, 'getContext', {
    value: () => ({
      drawImage: (bitmap: unknown) => { canvas.__sourceName = (bitmap as { __name?: string }).__name; }
    })
  });
  Object.defineProperty(canvas, 'toBlob', {
    value: (cb: (b: Blob | null) => void) => cb(new Blob([canvas.__sourceName ?? ''], { type: 'image/jpeg' }))
  });
  return canvas;
});

import { prioritizeFacesFirst } from './importPipeline';

function makeFile(name: string): File {
  return new File(['continut-fals'], name, { type: 'image/jpeg' });
}

describe('prioritizeFacesFirst', () => {
  beforeEach(() => {
    facesByFileName.clear();
    failingDecodeNames.clear();
    isNativeFaceDetectionAvailable.mockReturnValue(true);
    detectFacesNative.mockClear();
  });

  it('nu face nimic (web/PWA) cand detectia nativa de fete nu e disponibila', async () => {
    isNativeFaceDetectionAvailable.mockReturnValue(false);
    const images = [{ file: makeFile('a.jpg') }, { file: makeFile('b.jpg') }, { file: makeFile('c.jpg') }, { file: makeFile('d.jpg') }];

    const result = await prioritizeFacesFirst(images);

    expect(result).toBe(images); // aceeasi referinta — no-op, fara nicio incercare de decodare
    expect(detectFacesNative).not.toHaveBeenCalled();
  });

  it('nu face nimic sub pragul minim de lot (biblioteca mica, oricum gata rapid)', async () => {
    const images = [{ file: makeFile('a.jpg') }, { file: makeFile('b.jpg') }, { file: makeFile('c.jpg') }];

    const result = await prioritizeFacesFirst(images);

    expect(result).toBe(images);
    expect(detectFacesNative).not.toHaveBeenCalled();
  });

  // Costul pre-scanarii e liniar in numarul de poze, folosul nu e: pe un lot de
  // 437 de poze, scanarea completa lua ~2 minute inainte ca analiza sa inceapa
  // (raportat de utilizator). Vezi FACE_PRESCAN_MAX in importPipeline.ts.
  it('scaneaza doar inceputul unui lot mare, si raporteaza progresul scanarii', async () => {
    const images = Array.from({ length: 400 }, (_, i) => ({ file: makeFile(`p${i}.jpg`) }));
    // o fata dincolo de plafon — ramane pe locul ei, nu e promovata
    facesByFileName.set('p399.jpg', true);
    const scanned: number[] = [];

    const result = await prioritizeFacesFirst(images, done => scanned.push(done));

    expect(detectFacesNative.mock.calls.length).toBeLessThan(images.length);
    expect(result[0].file.name).toBe('p0.jpg');
    expect(result[399].file.name).toBe('p399.jpg');
    // progresul raportat merge pana la exact cate poze au fost chiar scanate
    expect(scanned[scanned.length - 1]).toBe(detectFacesNative.mock.calls.length);
  });

  it('muta pozele cu fete primele, pastrand ordinea originala STABILA in interiorul fiecarui grup', async () => {
    facesByFileName.set('b.jpg', true);
    facesByFileName.set('d.jpg', true);
    const images = [
      { file: makeFile('a.jpg') }, { file: makeFile('b.jpg') },
      { file: makeFile('c.jpg') }, { file: makeFile('d.jpg') }, { file: makeFile('e.jpg') }
    ];

    const result = await prioritizeFacesFirst(images);

    expect(result.map(i => i.file.name)).toEqual(['b.jpg', 'd.jpg', 'a.jpg', 'c.jpg', 'e.jpg']);
  });

  it('lasa fisierele RAW neprioritizate, fara sa incerce createImageBitmap pe ele', async () => {
    facesByFileName.set('portret.jpg', true);
    const images = [
      { file: makeFile('peisaj.cr2') }, { file: makeFile('portret.jpg') },
      { file: makeFile('detaliu.jpg') }, { file: makeFile('alt.nef') }
    ];

    const result = await prioritizeFacesFirst(images);

    expect(result.map(i => i.file.name)).toEqual(['portret.jpg', 'peisaj.cr2', 'detaliu.jpg', 'alt.nef']);
  });

  /**
   * Bug real gasit de auditul QA: `continue`-ul pentru RAW sarea si peste
   * onScanned(), nu doar peste detectie — deci pentru orice lot amestecat
   * (RAW + JPEG, adica exact fluxul unui fotograf care trage RAW+JPEG in
   * paralel), ultimul progres raportat ramanea sub total si bara fazei
   * "pregatire" ingheta la o fractiune, fara sa ajunga vreodata la capat.
   */
  it('raporteaza progres si pentru fisierele RAW sarite, ca faza "pregatire" sa ajunga la total (inainte: ingheta la 3/6)', async () => {
    const images = [
      { file: makeFile('a.cr2') }, { file: makeFile('b.jpg') }, { file: makeFile('c.nef') },
      { file: makeFile('d.jpg') }, { file: makeFile('e.arw') }, { file: makeFile('f.jpg') }
    ];
    const progress: [number, number][] = [];

    await prioritizeFacesFirst(images, (done, total) => progress.push([done, total]));

    expect(progress).toHaveLength(images.length);
    expect(progress[progress.length - 1]).toEqual([images.length, images.length]);
    // progresul ramane monoton crescator, fara sarituri peste vreun pas
    expect(progress.map(([done]) => done)).toEqual([1, 2, 3, 4, 5, 6]);
    // ...si totusi niciun RAW n-a trecut prin detectorul nativ
    expect(detectFacesNative).toHaveBeenCalledTimes(3);
  });

  it('un esec de decodare per-poza o lasa in grupul neprioritizat, fara sa opreasca restul pre-scanarii', async () => {
    failingDecodeNames.add('corupta.jpg');
    facesByFileName.set('cu-fata.jpg', true);
    const images = [
      { file: makeFile('corupta.jpg') }, { file: makeFile('cu-fata.jpg') },
      { file: makeFile('fara-fata-1.jpg') }, { file: makeFile('fara-fata-2.jpg') }
    ];

    const result = await prioritizeFacesFirst(images);

    expect(result.map(i => i.file.name)).toEqual(['cu-fata.jpg', 'corupta.jpg', 'fara-fata-1.jpg', 'fara-fata-2.jpg']);
  });
});

/**
 * Detectorul RAPID, si de ce merita un test propriu.
 *
 * Pre-scanarea citeste din rezultat exact un lucru: daca lista de fete e goala
 * sau nu. Pana acum primea totusi detectorul complet — mod ACCURATE plus
 * clasificare — care calculeaza zambetul si ochii deschisi pe fiecare fata din
 * lot, ca sa fie apoi aruncate. Cost pur, pe fiecare poza, exact in faza in
 * care omul se uita la o bara si nu se intampla nimic.
 *
 * Steagul `fast` nu se vede in niciun rezultat: daca dispare, totul continua sa
 * functioneze si sa treaca toate celelalte teste, doar mai incet. De-aia e
 * pazit aici, si nu altundeva.
 */
describe('pre-scanarea cere detectorul rapid', () => {
  beforeEach(() => {
    facesByFileName.clear();
    failingDecodeNames.clear();
    detectFacesNative.mockClear();
    isNativeFaceDetectionAvailable.mockReturnValue(true);
  });

  it('pe calea cu URI de galerie', async () => {
    const images = [
      { file: makeFile('a.jpg'), mediaUri: 'content://1' }, { file: makeFile('b.jpg'), mediaUri: 'content://2' },
      { file: makeFile('c.jpg'), mediaUri: 'content://3' }, { file: makeFile('d.jpg'), mediaUri: 'content://4' }
    ];
    await prioritizeFacesFirst(images);
    expect(detectFacesNative).toHaveBeenCalled();
    for (const [, options] of detectFacesNative.mock.calls) expect(options).toEqual({ fast: true });
  });

  it('si pe calea cu blob (selector de fisiere, fara URI)', async () => {
    const images = [
      { file: makeFile('a.jpg') }, { file: makeFile('b.jpg') },
      { file: makeFile('c.jpg') }, { file: makeFile('d.jpg') }
    ];
    await prioritizeFacesFirst(images);
    expect(detectFacesNative).toHaveBeenCalled();
    for (const [, options] of detectFacesNative.mock.calls) expect(options).toEqual({ fast: true });
  });
});
