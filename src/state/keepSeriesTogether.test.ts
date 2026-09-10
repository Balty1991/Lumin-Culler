import { describe, it, expect } from 'vitest';
import { keepSeriesTogether } from './keepSeriesTogether';

const p = (id: string, groupId?: string) => ({ id, ...(groupId ? { groupId } : {}) });
const ids = (list: { id: string }[]) => list.map(x => x.id).join(' ');

describe('seria rămâne o unitate în grilă', () => {
  it('membrii despărțiți de alte poze se strâng lângă primul dintre ei', () => {
    // a1 … a2 despărțite de o poză străină: exact cazul raportat.
    const grila = [p('a1', 'A'), p('x'), p('a2', 'A'), p('y')];
    expect(ids(keepSeriesTogether(grila))).toBe('a1 a2 x y');
  });

  it('seria apare unde era PRIMUL membru, nu la început și nu la sfârșit', () => {
    const grila = [p('x'), p('y'), p('a1', 'A'), p('z'), p('a2', 'A')];
    expect(ids(keepSeriesTogether(grila))).toBe('x y a1 a2 z');
  });

  it('ordinea dintre membri rămâne cea dinainte', () => {
    const grila = [p('a2', 'A'), p('x'), p('a1', 'A')];
    expect(ids(keepSeriesTogether(grila))).toBe('a2 a1 x');
  });

  it('mai multe serii nu se amestecă între ele', () => {
    const grila = [p('a1', 'A'), p('b1', 'B'), p('a2', 'A'), p('b2', 'B')];
    expect(ids(keepSeriesTogether(grila))).toBe('a1 a2 b1 b2');
  });

  it('pozele fără serie își păstrează locul relativ', () => {
    const grila = [p('x'), p('y'), p('z')];
    expect(ids(keepSeriesTogether(grila))).toBe('x y z');
  });

  it('fără nicio serie, intoarce ACEEASI referinta — memoizarea apelantului depinde de asta', () => {
    const grila = [p('x'), p('y')];
    expect(keepSeriesTogether(grila)).toBe(grila);
  });

  it('nu pierde si nu dubleaza nicio poza', () => {
    const grila = [p('a1', 'A'), p('x'), p('a2', 'A'), p('b1', 'B'), p('a3', 'A'), p('y'), p('b2', 'B')];
    const iesire = keepSeriesTogether(grila);
    expect(iesire).toHaveLength(grila.length);
    expect(new Set(iesire.map(i => i.id)).size).toBe(grila.length);
  });
});
