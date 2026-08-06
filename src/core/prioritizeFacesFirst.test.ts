import { describe, expect, it, vi, beforeEach } from 'vitest';

// prioritizeFacesFirst() decodeaza fiecare fisier la o rezolutie mica si
// apeleaza detectFacesNative() — nici createImageBitmap/canvas, nici plugin-ul
// nativ nu exista in jsdom, deci mock-uim intregul lant, capat la capat,
// pastrand identitatea fisierului prin el (bitmap -> canvas -> blob poarta
// numele fisierului sursa, ca detectFacesNative sa poata raspunde diferit per
// fisier in teste, in ciuda concurentei reale din interiorul functiei).
const isNativeFaceDetectionAvailable = vi.fn(() => true);
const facesByFileName = new Map<string, boolean>();
const detectFacesNative = vi.fn(async (blob: Blob) => {
  const name = await blob.text();
  const hasFace = facesByFileName.get(name) ?? false;
  return { faces: hasFace ? [{ boundingBox: { left: 0, top: 0, width: 1, height: 1 } }] : [], imageWidth: 1, imageHeight: 1 };
});
vi.mock('./nativeFaceDetection', () => ({
  isNativeFaceDetectionAvailable: () => isNativeFaceDetectionAvailable(),
  detectFacesNative: (blob: Blob) => detectFacesNative(blob)
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
