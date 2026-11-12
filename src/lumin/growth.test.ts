import { describe, expect, it } from 'vitest';
import { growthTimeline } from './growth';
import type { PhotoView } from '../state/store';

const p = (id: string, t: number, extra: Partial<PhotoView> = {}) =>
  ({ id, importedAt: t, capturedAt: t, status: 'review', aiScore: 50, faceCount: 1, personNames: [], ...extra } as unknown as PhotoView);
const at = (y: number, m = 6) => new Date(y, m - 1, 15).getTime();

describe('cum a crescut', () => {
  it('o poză pe an de viață, păstrata și portretul câștigă', () => {
    const list = [
      p('a', at(2022, 8), { faceCount: 3, aiScore: 90 }), p('b', at(2022, 9), { status: 'selected' }),
      p('c', at(2023, 7)), p('d', at(2024, 7), { status: 'rejected' }), p('e', at(2024, 8))
    ];
    const s = growthTimeline(list, { day: 1, month: 7, year: 2022 });
    expect(s.map(x => x.photo.id)).toEqual(['b', 'c', 'e']);
    expect(s.map(x => x.label)).toEqual([{ years: 0 }, { years: 1 }, { years: 2 }]);
  });
  it('fără zi de naștere: pe ani calendaristici; un singur an nu se arată', () => {
    expect(growthTimeline([p('a', at(2023)), p('b', at(2024))]).map(x => x.label)).toEqual([{ year: 2023 }, { year: 2024 }]);
    expect(growthTimeline([p('a', at(2023)), p('b', at(2023, 9))])).toEqual([]);
  });
});
