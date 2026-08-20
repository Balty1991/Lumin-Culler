import { describe, it, expect, vi } from 'vitest';
import { quickDuplicateScan, EMPTY_SCAN, MIN_FILES_FOR_SCAN, type ScannableFile } from './quickDuplicateScan';

/** Fisier fals: continutul decide amprenta, marimea o dam noi. */
function f(name: string, size: number, content = name): ScannableFile {
  return {
    name, size,
    slice: () => new Blob([content]),
    // cate felii s-au citit — ca sa dovedim ca nu citim degeaba
    ...(({} as unknown) as object)
  };
}
/** Umplutura, ca sa trecem de pragul minim fara sa influentam rezultatul. */
const filler = (n: number) => Array.from({ length: n }, (_, i) => f('u' + i, 1000 + i, 'unic' + i));

describe('quickDuplicateScan', () => {
  it('nu porneste pe un lot mic — costul ar depasi ce afla', async () => {
    expect(await quickDuplicateScan([f('a', 10), f('b', 10)])).toEqual(EMPTY_SCAN);
  });

  it('gaseste doua copii ale aceluiasi fisier', async () => {
    const r = await quickDuplicateScan([f('a.jpg', 5000, 'X'), f('copie.jpg', 5000, 'X'), ...filler(MIN_FILES_FOR_SCAN)]);
    expect(r.groups).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.wastedBytes).toBe(5000);
  });

  it('socoteste locul eliberat, nu spatiul total ocupat', async () => {
    const r = await quickDuplicateScan([
      f('a', 4000, 'X'), f('b', 4000, 'X'), f('c', 4000, 'X'), ...filler(MIN_FILES_FOR_SCAN)
    ]);
    expect(r.duplicates).toBe(2);
    expect(r.wastedBytes).toBe(8000);
  });

  it('aceeasi marime dar alt continut NU e o copie', async () => {
    const r = await quickDuplicateScan([f('a', 5000, 'X'), f('b', 5000, 'Y'), ...filler(MIN_FILES_FOR_SCAN)]);
    expect(r).toEqual(EMPTY_SCAN);
  });

  it('nu citeste nimic cand nicio marime nu se repeta', async () => {
    const spied = filler(MIN_FILES_FOR_SCAN + 4).map(x => ({ ...x, slice: vi.fn(x.slice) }));
    const r = await quickDuplicateScan(spied);
    expect(r).toEqual(EMPTY_SCAN);
    for (const s of spied) expect(s.slice).not.toHaveBeenCalled();
  });

  it('citeste DOAR fisierele care impart o marime', async () => {
    const dubluri = [
      { ...f('a', 5000, 'X'), slice: vi.fn(() => new Blob(['X'])) },
      { ...f('b', 5000, 'X'), slice: vi.fn(() => new Blob(['X'])) }
    ];
    const unice = filler(MIN_FILES_FOR_SCAN).map(x => ({ ...x, slice: vi.fn(x.slice) }));
    await quickDuplicateScan([...dubluri, ...unice]);
    for (const d of dubluri) expect(d.slice).toHaveBeenCalled();
    for (const u of unice) expect(u.slice).not.toHaveBeenCalled();
  });

  it('sare peste fisierele fara marime cunoscuta', async () => {
    const r = await quickDuplicateScan([f('a', 0, 'X'), f('b', 0, 'X'), ...filler(MIN_FILES_FOR_SCAN)]);
    expect(r).toEqual(EMPTY_SCAN);
  });

  it('un fisier ilizibil nu strica scanarea si nu se potriveste cu nimic', async () => {
    const rupt: ScannableFile = { name: 'rupt', size: 5000, slice: () => { throw new Error('permisiune retrasa'); } };
    const r = await quickDuplicateScan([rupt, f('bun', 5000, 'X'), ...filler(MIN_FILES_FOR_SCAN)]);
    expect(r).toEqual(EMPTY_SCAN);
  });

  it('mai multe grupuri distincte se aduna corect', async () => {
    const r = await quickDuplicateScan([
      f('a1', 1_000_000, 'A'), f('a2', 1_000_000, 'A'),
      f('b1', 2_000_000, 'B'), f('b2', 2_000_000, 'B'), f('b3', 2_000_000, 'B'),
      ...filler(MIN_FILES_FOR_SCAN)
    ]);
    expect(r.groups).toBe(2);
    expect(r.duplicates).toBe(3);
    expect(r.wastedBytes).toBe(1_000_000 + 2 * 2_000_000);
  });
});
