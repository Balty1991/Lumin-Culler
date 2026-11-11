import { describe, it, expect } from 'vitest';
import { foldLook, pickLook, type LookMemory } from './myLook';

const empty: LookMemory = { saves: 0, styles: {} };
const fold = (m: LookMemory, ...xs: [string, number][]) => xs.reduce((a, [s, v]) => foldLook(a, s, v), m);

describe('stilul tău în editor', () => {
  it('nu spune nimic până la trei poze salvate', () => {
    expect(pickLook(fold(empty, ['warm', 0.8], ['warm', 0.8]))).toBeNull();
  });
  it('alege stilul salvat cel mai des, la intensitatea ta', () => {
    const look = pickLook(fold(empty, ['warm', 0.8], ['natural', 0.5], ['warm', 0.8]));
    expect(look).toMatchObject({ style: 'warm', amount: 0.8, saves: 3 });
  });
  it('se schimbă odată cu tine: ultimele salvări contează mai mult', () => {
    const m = fold(empty, ['warm', 0.8], ['warm', 0.8], ['warm', 0.8], ['film', 1], ['film', 1], ['film', 1], ['film', 1]);
    expect(pickLook(m)?.style).toBe('film');
  });
});
