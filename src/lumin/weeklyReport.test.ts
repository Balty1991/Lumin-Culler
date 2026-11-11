import { describe, it, expect } from 'vitest';
import { buildWeeklyReport, weekKey } from './weeklyReport';
import type { PhotoView } from '../state/store';

const now = new Date(2026, 10, 11, 12).getTime();
const day = 86_400_000;
const base = { importedAt: 0, personNames: [], faceCount: 0, aiScore: 50, status: 'review', mediaUri: 'u', sizeBytes: 1_000_000 } as unknown as PhotoView;
const p = (id: string, extra: Partial<PhotoView>): PhotoView => ({ ...base, id, capturedAt: now - day, ...extra } as PhotoView);

describe('curățenia săptămânii', () => {
  it('adună cadrele în plus din serii și cele de la „Nu azi”, din ultimele șapte zile', () => {
    const r = buildWeeklyReport([
      p('best', { groupId: 'g', status: 'selected' }),
      p('extra', { groupId: 'g' }),
      p('no', { status: 'rejected' }),
      p('single', {}),
      p('old', { status: 'rejected', capturedAt: now - 20 * day }),
      p('web', { status: 'rejected', mediaUri: undefined }),
      p('doc', { status: 'rejected', aside: 'document' })
    ], now);
    expect(r.photos.map(x => x.id).sort()).toEqual(['extra', 'no']);
    expect(r).toMatchObject({ extras: 1, rejected: 1, bytes: 2_000_000 });
  });
  it('nu scoate niciodată poza păstrată sau cea mai bună din serie', () => {
    const r = buildWeeklyReport([p('a', { groupId: 'g', aiScore: 90 }), p('b', { groupId: 'g', aiScore: 40 })], now);
    expect(r.photos.map(x => x.id)).toEqual(['b']);
  });
  it('săptămâna e aceeași de luni până duminică', () => {
    expect(weekKey(new Date(2026, 10, 9).getTime())).toBe(weekKey(new Date(2026, 10, 15).getTime()));
    expect(weekKey(new Date(2026, 10, 16).getTime())).not.toBe(weekKey(new Date(2026, 10, 15).getTime()));
  });
});

import { trialDaysLeft } from './paywallMoment';
describe('sfârșitul probei gratuite', () => {
  const day = 86_400_000;
  const t0 = 1_800_000_000_000;
  const log = [{ at: t0, event: 'trial_started' as const, source: 'yearly' }];
  it('numără zilele rămase și tace după ce proba s-a terminat sau n-a existat', () => {
    expect(trialDaysLeft(t0 + 5.5 * day, log)).toBe(2);
    expect(trialDaysLeft(t0 + 6.5 * day, log)).toBe(1);
    expect(trialDaysLeft(t0 + 8 * day, log)).toBeNull();
    expect(trialDaysLeft(t0, [])).toBeNull();
  });
});
