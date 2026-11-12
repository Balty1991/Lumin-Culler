import { describe, expect, it } from 'vitest';
import { applyFilters, fixNames, parseQuery } from './assistantQuery';
import { answer } from './assistantBrain';
import type { PhotoView } from '../state/store';

const now = new Date(2026, 10, 12, 15).getTime(); // joi, 12 nov. 2026
const DAY = 86_400_000;
const p = (id: string, ago: number, extra: Partial<PhotoView> = {}) =>
  ({ id, fileName: id, importedAt: now - ago * DAY, capturedAt: now - ago * DAY, status: 'review', aiScore: 60, faceCount: 1, allEyesOpen: true,
    sharpness: 0.8, personNames: [], sceneTags: [], ...extra }) as unknown as PhotoView;

describe('ce înțelege asistentul', () => {
  it('timpul: ieri, săptămâna trecută, vara trecută, un an', () => {
    expect(parseQuery('poze de ieri', now).from).toBe(new Date(2026, 10, 11).getTime());
    const w = parseQuery('săptămâna trecută', now);
    expect(w.from).toBe(new Date(2026, 10, 2).getTime());
    expect(w.to).toBe(new Date(2026, 10, 9).getTime());
    const v = parseQuery('vara trecută la mare', now);
    expect(v.from).toBe(new Date(2026, 5, 1).getTime());
    expect(v.rest).toBe('la mare');
    expect(parseQuery('poze din 2024', now).from).toBe(new Date(2024, 0, 1).getTime());
  });
  it('filtrele și numărul', () => {
    const q = parseQuery('ultimele 5 poze păstrate', now);
    expect(q).toMatchObject({ limit: 5, newest: true, status: 'selected' });
    expect(parseQuery('poze neclare', now).quality).toBe('blurry');
    expect(parseQuery('cu ochii închiși', now).quality).toBe('eyesClosed');
  });
  it('numele cu o greșeală', () => {
    expect(fixNames('amy la mare', ['Ami'])).toBe('ami la mare');
  });
  it('cereri întregi', () => {
    const photos = [
      p('ieri-ami', 1, { personNames: ['Ami'], status: 'selected' }),
      p('ieri-mancare', 1, { sceneTags: ['Food'] }),
      p('veche-ami', 30, { personNames: ['Ami'] }),
      p('neclara', 2, { sharpness: 0.1 })
    ];
    const r1 = answer('pozele cu Amy de ieri', photos, now);
    expect(r1.kind === 'results' && r1.photos.map(x => x.id)).toEqual(['ieri-ami']);
    const r2 = answer('arată-mi pozele neclare', photos, now);
    expect(r2.kind === 'results' && r2.photos.map(x => x.id)).toEqual(['neclara']);
    const r3 = answer('geacă roșie', [p('g', 1, { sceneTags: ['Jacket'], dominantColors: ['#2255ee'] } as Partial<PhotoView>)], now);
    expect(r3.kind).toBe('none');
    expect(applyFilters(photos, parseQuery('păstrate', now)).map(x => x.id)).toEqual(['ieri-ami']);
  });
});

describe('asistentul face Reel', () => {
  it('„fă un reel cu Ami” caută pozele cu Ami și le face Reel', () => {
    const photos = [p('a1', 1, { personNames: ['Ami'] }), p('a2', 2, { personNames: ['Ami'] }), p('x', 1, { sceneTags: ['Food'] })];
    const r = answer('fă-mi un reel cu Ami', photos, now);
    expect(r.kind).toBe('reel');
    expect(r.kind === 'reel' && [...r.ids].sort()).toEqual(['a1', 'a2']);
  });
});
