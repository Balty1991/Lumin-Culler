import { describe, expect, it } from 'vitest';
import { bandOf, planBands, bandStarts, buildRowPlan } from './reviewPlan';

describe('in ce fel de munca intra o poza', () => {
  it('limpede, de comparat, sau chiar greu', () => {
    expect(bandOf(0.1)).toBe('easy');
    expect(bandOf(0.5)).toBe('compare');
    expect(bandOf(0.9)).toBe('hard');
  });

  it('o dificultate corupta se trateaza ca grea, nu ca usoara', () => {
    // a trimite o poza necunoscuta in "alege rapid" ar fi exact greseala scumpa
    expect(bandOf(NaN)).toBe('hard');
  });
});

describe('planul cozii', () => {
  it('grupeaza pozele consecutive in benzi', () => {
    const b = planBands([0.1, 0.2, 0.5, 0.6, 0.9]);
    expect(b.map(x => x.key)).toEqual(['easy', 'compare', 'hard']);
    expect(b.map(x => x.count)).toEqual([2, 2, 1]);
    expect(b.map(x => x.startIndex)).toEqual([0, 2, 4]);
  });

  it('o lista goala n-are benzi', () => {
    expect(planBands([])).toEqual([]);
  });

  it('o lista dintr-o singura banda ramane o banda', () => {
    expect(planBands([0.1, 0.15, 0.2])).toHaveLength(1);
  });
});

describe('unde se pun separatoarele', () => {
  it('la inceputul fiecarei benzi', () => {
    const starts = bandStarts(planBands([0.1, 0.2, 0.5, 0.6, 0.9, 0.95]));
    expect([...starts.keys()]).toEqual([0, 2, 4]);
  });

  it('niciunul cand toata lista e o singura banda — n-ar imparti nimic', () => {
    expect(bandStarts(planBands([0.1, 0.2, 0.3])).size).toBe(0);
  });

  it('o banda de o singura poza nu primeste titlu', () => {
    // un titlu urmat de un singur cadru ocupa mai mult loc decat cadrul
    const starts = bandStarts(planBands([0.1, 0.2, 0.5, 0.9, 0.95]));
    expect(starts.has(2)).toBe(false);
    expect([...starts.keys()]).toEqual([0, 3]);
  });
});

describe('randurile grilei se rup la granita de banda', () => {
  const items = Array.from({ length: 7 }, (_, i) => i);

  it('fara benzi, randurile se umplu normal', () => {
    const rows = buildRowPlan(items, 3, new Map());
    expect(rows.map(r => r.items)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(rows.every(r => r.band === undefined)).toBe(true);
  });

  it('un separator inchide randul dinaintea lui, ca nicio poza sa nu stea sub titlul gresit', () => {
    const bands = new Map([[4, { key: 'hard' as const, startIndex: 4, count: 3 }]]);
    const rows = buildRowPlan(items, 3, bands);
    expect(rows.map(r => r.items)).toEqual([[0, 1, 2], [3], [4, 5, 6]]);
    expect(rows[2].band?.key).toBe('hard');
    expect(rows[1].band).toBeUndefined();
  });

  it('un separator chiar la inceput nu lasa un rand gol inaintea lui', () => {
    const bands = new Map([[0, { key: 'easy' as const, startIndex: 0, count: 7 }]]);
    const rows = buildRowPlan(items, 3, bands);
    expect(rows[0].items).toEqual([0, 1, 2]);
    expect(rows[0].band?.key).toBe('easy');
  });

  it('fiecare rand isi stie indexul de start in lista intreaga', () => {
    const bands = new Map([[4, { key: 'hard' as const, startIndex: 4, count: 3 }]]);
    expect(buildRowPlan(items, 3, bands).map(r => r.startIndex)).toEqual([0, 3, 4]);
  });

  it('o lista goala nu produce randuri', () => {
    expect(buildRowPlan([], 3, new Map())).toEqual([]);
  });

  it('nu se sufoca la un numar de coloane absurd', () => {
    expect(buildRowPlan(items, 0, new Map()).every(r => r.items.length === 1)).toBe(true);
  });
});
