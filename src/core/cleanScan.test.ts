import { describe, expect, it } from 'vitest';
import {
  BLUR_VARIANCE_MAX, BURST_GAP_MS, LARGE_VIDEO_BYTES,
  basketsFromLibrary, basketsFromScan, estimateSavedBytes,
  isMessengerBucket, isScreenshotBucket,
  type CleanImageRow, type CleanVideoRow
} from './cleanScan';

function image(over: Partial<CleanImageRow> & Pick<CleanImageRow, 'uri'>): CleanImageRow {
  return {
    name: over.uri,
    bytes: 1000,
    width: 100,
    height: 100,
    taken: 1_700_000_000_000,
    bucket: 'Camera',
    hash: null,
    blur: 200,
    ...over
  };
}

function basket(id: string, rows: ReturnType<typeof basketsFromScan>) {
  return rows.find(b => b.id === id)!;
}

describe('dosare', () => {
  it('recunoaște capturile în limbile în care le numește telefonul', () => {
    expect(isScreenshotBucket('Screenshots')).toBe(true);
    expect(isScreenshotBucket('Capturi de ecran')).toBe(true);
    expect(isScreenshotBucket('Bildschirmfotos')).toBe(true);
    expect(isScreenshotBucket('Camera')).toBe(false);
  });

  it('recunoaște dosarele de mesagerie', () => {
    expect(isMessengerBucket('WhatsApp Images')).toBe(true);
    expect(isMessengerBucket('Telegram')).toBe(true);
    expect(isMessengerBucket('Camera')).toBe(false);
  });
});

describe('basketsFromScan', () => {
  it('păstrează copia cea mai nouă dintr-un grup de duplicate și pune restul la șters', () => {
    const baskets = basketsFromScan([
      image({ uri: 'a', hash: 'same', bytes: 5000, taken: 10 }),
      image({ uri: 'b', hash: 'same', bytes: 5000, taken: 20 }),
      image({ uri: 'c', hash: 'same', bytes: 5000, taken: 15 })
    ], []);
    expect(basket('duplicates', baskets).items.map(i => i.uri)).toEqual(['c', 'a']);
    expect(basket('duplicates', baskets).bytes).toBe(10000);
    expect(basket('duplicates', baskets).premark).toBe(true);
    expect(basket('duplicates', baskets).keeper?.name).toBe('b');
  });

  it('nu confundă două fișiere de aceeași mărime cu amprente diferite', () => {
    const baskets = basketsFromScan([
      image({ uri: 'a', hash: 'one', bytes: 5000 }),
      image({ uri: 'b', hash: 'two', bytes: 5000 })
    ], []);
    expect(basket('duplicates', baskets).items).toHaveLength(0);
  });

  it('dintr-o rafală păstrează cadrul cel mai clar', () => {
    const t = 1_000_000;
    const baskets = basketsFromScan([
      image({ uri: 'a', taken: t, blur: 40, bytes: 100 }),
      image({ uri: 'b', taken: t + BURST_GAP_MS, blur: 400, bytes: 100 }),
      image({ uri: 'c', taken: t + BURST_GAP_MS * 2, blur: 90, bytes: 100 })
    ], []);
    expect(basket('bursts', baskets).items.map(i => i.uri).sort()).toEqual(['a', 'c']);
    expect(basket('bursts', baskets).premark).toBe(true);
    expect(basket('bursts', baskets).keeper?.reason).toBe('sharpness');
    expect(basket('blurry', baskets).items).toHaveLength(0);
  });

  it('într-o rafală păstrează ochii deschiși, nu cadrul mai clar dar clipit', () => {
    const t0 = 1_700_000_000_000;
    const baskets = basketsFromScan([
      image({ uri: 'blink', blur: 900, eyesOpen: false, exposure: 50, taken: t0 }),
      image({ uri: 'open', blur: 420, eyesOpen: true, exposure: 50, taken: t0 + 400 }),
      image({ uri: 'soft', blur: 30, taken: t0 + 800 })
    ], []);
    expect(basket('bursts', baskets).keeper?.name).toBe('open');
    expect(basket('bursts', baskets).keeper?.reason).toBe('eyes');
    expect(basket('bursts', baskets).items.map(i => i.uri).sort()).toEqual(['blink', 'soft']);
  });

  it('pune la neclare doar ce e sub prag și nu e deja într-o rafală sau captură', () => {
    const baskets = basketsFromScan([
      image({ uri: 'soft', blur: BLUR_VARIANCE_MAX - 1 }),
      image({ uri: 'sharp', blur: BLUR_VARIANCE_MAX }),
      image({ uri: 'shot', blur: 10, bucket: 'Screenshots' })
    ], []);
    expect(basket('blurry', baskets).items.map(i => i.uri)).toEqual(['soft']);
    expect(basket('screenshots', baskets).items.map(i => i.uri)).toEqual(['shot']);
  });

  it('nu pune aceeași poză în două coșuri', () => {
    const baskets = basketsFromScan([
      image({ uri: 'a', hash: 'same', bytes: 800, bucket: 'Screenshots', taken: 2 }),
      image({ uri: 'b', hash: 'same', bytes: 800, bucket: 'Screenshots', taken: 1 })
    ], []);
    const ids = baskets.flatMap(b => b.items.map(i => `${b.id}:${i.uri}`));
    expect(ids).toEqual(['duplicates:b']);
  });

  it('listează videoclipurile mari, cele mai mari întâi, și le lasă pe cele mici afară', () => {
    const small: CleanVideoRow = { uri: 's', name: 's.mp4', bytes: LARGE_VIDEO_BYTES - 1, width: 1280, height: 720, durationMs: 1000 };
    const big: CleanVideoRow = { uri: 'b', name: 'b.mp4', bytes: LARGE_VIDEO_BYTES + 10, width: 1920, height: 1080, durationMs: 2000 };
    const bigger: CleanVideoRow = { uri: 'B', name: 'B.mp4', bytes: LARGE_VIDEO_BYTES * 3, width: 3840, height: 2160, durationMs: 3000 };
    const videos = basket('videos', basketsFromScan([], [small, big, bigger]));
    expect(videos.items.map(i => i.uri)).toEqual(['B', 'b']);
  });
});

describe('estimateSavedBytes', () => {
  it('promite o economie pentru un 4K și nu promite mai mult de 85%', () => {
    const saved = estimateSavedBytes(1_000_000_000, 3840, 2160);
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThanOrEqual(850_000_000);
  });

  it('nu inventează o economie din nimic', () => {
    expect(estimateSavedBytes(0, 1920, 1080)).toBe(0);
    expect(estimateSavedBytes(-5, 1920, 1080)).toBe(0);
  });
});

describe('basketsFromLibrary', () => {
  it('dintr-o serie păstrează cadrul cel mai clar și separă ochii închiși de neclare', () => {
    const baskets = basketsFromLibrary([
      { id: '1', fileName: 'a.jpg', sharpness: 10, faceCount: 0, allEyesOpen: true, groupId: 'g', status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 10 },
      { id: '2', fileName: 'b.jpg', sharpness: 90, faceCount: 1, allEyesOpen: false, groupId: 'g', status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 12 },
      { id: '3', fileName: 'c.jpg', sharpness: 20, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5 },
      { id: '4', fileName: 'd.jpg', sharpness: 80, faceCount: 1, allEyesOpen: false, status: 'review', blurBelow: 40, eyesOpenBelow: 0.5 },
      { id: '5', fileName: 'e.jpg', sharpness: 80, faceCount: 1, allEyesOpen: false, status: 'rejected', blurBelow: 40, eyesOpenBelow: 0.5 }
    ]);
    expect(baskets.find(b => b.id === 'bursts')!.items.map(i => i.photoId)).toEqual(['1']);
    expect(baskets.find(b => b.id === 'blurry')!.items.map(i => i.photoId)).toEqual(['3']);
    expect(baskets.find(b => b.id === 'eyes')!.items.map(i => i.photoId)).toEqual(['4']);
  });

  it('din două portrete păstrează ochii deschiși și marchează restul', () => {
    const baskets = basketsFromLibrary([
      { id: 'open', fileName: 'open.jpg', sharpness: 62, exposure: 50, faceCount: 1, allEyesOpen: true, groupId: 'p', status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 10 },
      { id: 'shut', fileName: 'shut.jpg', sharpness: 84, exposure: 50, faceCount: 1, allEyesOpen: false, groupId: 'p', status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 10 }
    ]);
    const bursts = baskets.find(b => b.id === 'bursts')!;
    expect(bursts.keeper?.name).toBe('open.jpg');
    expect(bursts.keeper?.reason).toBe('eyes');
    expect(bursts.premark).toBe(true);
    expect(bursts.items.map(i => i.photoId)).toEqual(['shut']);
  });

  it('grupează copiile cu aceeași amprentă și ține videoclipurile mari separat', () => {
    const baskets = basketsFromLibrary([
      { id: 'a', fileName: 'IMG_1.jpg', sharpness: 80, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 1000, hash: 'abc' },
      { id: 'b', fileName: 'IMG_1 (1).jpg', sharpness: 40, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 1000, hash: 'abc' },
      { id: 'v', fileName: 'clip.mp4', sharpness: 10, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: LARGE_VIDEO_BYTES + 5 },
      { id: 'tiny', fileName: 'small.mp4', sharpness: 10, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5, sizeBytes: 1000 }
    ]);
    const dups = baskets.find(b => b.id === 'duplicates')!;
    expect(dups.items.map(i => i.photoId)).toEqual(['b']);
    expect(dups.keeper?.name).toBe('IMG_1.jpg');
    expect(dups.premark).toBe(true);
    expect(baskets.find(b => b.id === 'videos')!.items.map(i => i.photoId)).toEqual(['v']);
    expect(baskets.find(b => b.id === 'blurry')!.items).toEqual([]);
  });

  it('pune capturile și mesageria după numele fișierului, nu doar după etichetă', () => {
    const baskets = basketsFromLibrary([
      { id: 's', fileName: 'Screenshot_1.png', sharpness: 90, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5 },
      { id: 'w', fileName: 'WhatsApp Image.jpg', sharpness: 90, faceCount: 0, allEyesOpen: true, status: 'pending', blurBelow: 40, eyesOpenBelow: 0.5 }
    ]);
    expect(baskets.find(b => b.id === 'screenshots')!.items.map(i => i.photoId)).toEqual(['s']);
    expect(baskets.find(b => b.id === 'messengers')!.items.map(i => i.photoId)).toEqual(['w']);
  });
});
