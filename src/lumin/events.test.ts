import { describe, expect, it } from 'vitest';
import { buildEvents, orthodoxEaster } from './momentAlbums';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const photo = (id: string, capturedAt: number, sceneTags: string[] = []) => ({ id, capturedAt, status: 'review', aiScore: 50, personNames: [], sceneTags });

describe('orthodoxEaster', () => {
  it('știe Paștele ortodox', () => {
    expect(orthodoxEaster(2025).toDateString()).toBe(new Date(2025, 3, 20).toDateString());
    expect(orthodoxEaster(2026).toDateString()).toBe(new Date(2026, 3, 12).toDateString());
    expect(orthodoxEaster(2024).toDateString()).toBe(new Date(2024, 4, 5).toDateString());
  });
});

describe('buildEvents', () => {
  it('Crăciunul și o zi de naștere', () => {
    const photos = [
      photo('x1', at(2025, 12, 24)), photo('x2', at(2025, 12, 25)), photo('x3', at(2025, 12, 25, 18)),
      photo('b1', at(2026, 3, 3), ['cake']), photo('b2', at(2026, 3, 3), ['balloon']), photo('b3', at(2026, 3, 3)), photo('b4', at(2026, 3, 3))
    ];
    const ev = buildEvents(photos, 'ro');
    expect(ev.map(e => e.kind)).toEqual(['birthday', 'christmas']);
    expect(ev[1].title).toBe('Crăciunul 2025');
  });
  it('vacanța: zile la rând cu mult mai multe poze', () => {
    const photos = [
      ...[1, 5, 9, 13, 17].map((d, i) => photo(`n${i}`, at(2026, 6, d))),
      ...Array.from({ length: 30 }, (_, i) => photo(`t${i}`, at(2026, 7, 10 + (i % 3), 10 + (i % 8))))
    ];
    const ev = buildEvents(photos, 'ro');
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('trip');
    expect(ev[0].photos).toHaveLength(30);
  });
});
