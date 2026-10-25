import { describe, expect, it } from 'vitest';
import { decideIsolate, isReviewQueue, paperScoreFromRgba, PAPER_DOCUMENT_MIN } from './singletonVerdict';

function paper(fill: (i: number, px: Uint8ClampedArray) => void, width = 48): number {
  const data = new Uint8ClampedArray(width * width * 4);
  for (let i = 0; i < width * width; i++) fill(i, data);
  return paperScoreFromRgba(data, width);
}

describe('decideIsolate', () => {
  it('păstrează o poză clară și bine expusă, fără fețe măsurate', () => {
    expect(decideIsolate({ fileName: 'IMG_001.jpg', sharpness: 80, exposure: 52, paperScore: 0.1 }).status).toBe('selected');
  });

  it('respinge o poză neclară', () => {
    expect(decideIsolate({ fileName: 'IMG_002.jpg', sharpness: 8, exposure: 50 }).status).toBe('rejected');
  });

  it('respinge ochii închiși când au fost măsurați', () => {
    expect(decideIsolate({
      fileName: 'IMG_003.jpg', sharpness: 80, exposure: 50, faceCount: 1, eyesOpenRatio: 0.2
    }).status).toBe('rejected');
  });

  it('nu inventează un clipit când ochii nu s-au măsurat', () => {
    expect(decideIsolate({ fileName: 'IMG_004.jpg', sharpness: 80, exposure: 50 }).status).toBe('selected');
  });

  it('lasă la verificat doar cazurile de lângă prag', () => {
    const decision = decideIsolate({ fileName: 'IMG_005.jpg', sharpness: 28, exposure: 50 });
    expect(decision.status).toBe('review');
    expect(decision.aside).toBeUndefined();
  });

  it('pune bonul la documente, nu în coada de verificat', () => {
    const decision = decideIsolate({ fileName: 'bon.jpg', sharpness: 90, exposure: 70, paperScore: PAPER_DOCUMENT_MIN });
    expect(decision).toEqual({ status: 'review', aside: 'document' });
    expect(isReviewQueue({ status: decision.status, aside: decision.aside })).toBe(false);
  });

  it('recunoaște captura după nume', () => {
    const decision = decideIsolate({ fileName: 'Screenshot_2026.png', sharpness: 90, exposure: 50 });
    expect(decision.aside).toBe('screenshot');
    expect(isReviewQueue(decision)).toBe(false);
  });

  it('o măsurătoare lipsă nu blochează cu „fără subiect” și nu inventează clipping', () => {
    expect(decideIsolate({ fileName: 'x.jpg', sharpness: Number.NaN, exposure: 50 }).status).toBe('review');
  });
});

describe('paperScoreFromRgba', () => {
  it('o coală albă cu text are scor mare', () => {
    const score = paper((i, px) => {
      const x = i % 48;
      const on = x % 3 === 0;
      const v = on ? 20 : 245;
      const o = i * 4;
      px[o] = px[o + 1] = px[o + 2] = v;
      px[o + 3] = 255;
    });
    expect(score).toBeGreaterThanOrEqual(PAPER_DOCUMENT_MIN);
  });

  it('o scenă colorată nu e hârtie', () => {
    const score = paper((i, px) => {
      const o = i * 4;
      px[o] = (i * 17) % 255;
      px[o + 1] = (i * 29) % 255;
      px[o + 2] = (i * 13) % 255;
      px[o + 3] = 255;
    });
    expect(score).toBeLessThan(PAPER_DOCUMENT_MIN);
  });

  it('o grilă prea mică nu se declară document', () => {
    expect(paperScoreFromRgba(new Uint8ClampedArray(8), 48)).toBe(0);
  });
});
