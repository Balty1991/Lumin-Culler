import { describe, expect, it } from 'vitest';
import { candidateIds, incrementalStageOne, isSeriesCandidate, SERIES_CANDIDATE_HAMMING, stageOneKey, stageOneTime } from './twoStagePlan';

const far = '0'.repeat(64);
const near = `${'1'.repeat(8)}${'0'.repeat(56)}`;
const other = '1'.repeat(64);

describe('candidații etapei 2', () => {
  it('o poză singură nu pornește modelele grele', () => {
    expect(candidateIds([{ id: 'a', hash: far }]).size).toBe(0);
  });

  it('două cadre apropiate intră amândouă, cele îndepărtate nu', () => {
    const ids = candidateIds([
      { id: 'a', hash: far },
      { id: 'b', hash: near },
      { id: 'c', hash: other }
    ]);
    expect(SERIES_CANDIDATE_HAMMING).toBe(14);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('o poză nouă care continuă o serie deja în bibliotecă e candidat', () => {
    const ids = candidateIds([{ id: 'nou', hash: far }], [near]);
    expect([...ids]).toEqual(['nou']);
  });

  it('rafala din mână: mai diferită, dar la secunde distanță, e tot serie', () => {
    expect(isSeriesCandidate(20, 5_000)).toBe(true);
    expect(isSeriesCandidate(20, 10 * 60_000)).toBe(false);
    expect(isSeriesCandidate(14, 10 * 60_000)).toBe(true);
    expect(isSeriesCandidate(25, 1_000)).toBe(false);
    expect(isSeriesCandidate(20, undefined)).toBe(false);
  });

  it('ora unei poze din galerie nu e momentul importului', () => {
    const start = new Date(2026, 9, 27, 20, 0, 0).getTime();
    expect(stageOneTime({ name: 'a.jpg', lastModified: start + 5 }, start)).toBeUndefined();
    expect(stageOneTime({ name: 'IMG_20261024_081609.jpg', lastModified: start + 5 }, start))
      .toBe(new Date(2026, 9, 24, 8, 16, 9).getTime());
    expect(stageOneTime({ name: 'Screenshot_2026-10-24-08-16-09.png', lastModified: start }, start))
      .toBe(new Date(2026, 9, 24, 8, 16, 9).getTime());
    const old = start - 86_400_000;
    expect(stageOneTime({ name: 'x.jpg', lastModified: old }, start)).toBe(old);
  });

  it('fără amprentă, calea grea rămâne deschisă', () => {
    expect(candidateIds([{ id: 'x', hash: '' }]).has('x')).toBe(true);
  });
});

describe('rescanare incrementală', () => {
  it('aceeași cheie, mărime și dată se refolosesc', () => {
    const key = stageOneKey({ uri: 'content://media/1', name: 'a.jpg', size: 10, mtime: 5 });
    const plan = incrementalStageOne(
      [{ key, size: 10, mtime: 5 }],
      [
        { key, size: 10, mtime: 5 },
        { key: stageOneKey({ name: 'b.jpg', size: 3, mtime: 9 }), size: 4, mtime: 9 }
      ]
    );
    expect(plan.reuse).toEqual([key]);
    expect(plan.refresh).toHaveLength(1);
  });
});
