import { describe, expect, it } from 'vitest';
import { lockedFromAutoDecision } from './aiDecision';
import type { PhotoRecord } from './db';

/**
 * core/aiDecision.test.ts
 *
 * Regula pazita aici a fost gasita de utilizator, cu doua capturi: bara de
 * severitate era ireversibila. Apesi "Ingaduitor", 17 poze primesc eticheta;
 * te razgandesti, apesi "Echilibrat", si nu se mai intampla nimic.
 *
 * Ce se poate strica din nou, si de-aia are teste separate: cele doua greseli
 * posibile sunt simetrice si NU sunt la fel de grave. Sa rastorni o eticheta
 * pusa de om e o pierdere reala. Sa nu poti rasturna una pusa de motor e doar
 * o bara care pare stricata. De-aia poza VECHE, despre care nu se mai poate
 * sti, se trateaza ca decizie a omului.
 */
const poza = (over: Partial<PhotoRecord>): Pick<PhotoRecord, 'status' | 'aiDecided'> =>
  ({ status: 'review', ...over }) as Pick<PhotoRecord, 'status' | 'aiDecided'>;

describe('ce poate rescrie severitatea', () => {
  it('o poza nedecisa — evident', () => {
    expect(lockedFromAutoDecision(poza({ status: 'review' }))).toBe(false);
    expect(lockedFromAutoDecision(poza({ status: 'pending' }))).toBe(false);
  });

  it('o eticheta pusa de MOTOR se poate rescrie — asta era tot bugul', () => {
    expect(lockedFromAutoDecision(poza({ status: 'selected', aiDecided: true }))).toBe(false);
    expect(lockedFromAutoDecision(poza({ status: 'rejected', aiDecided: true }))).toBe(false);
  });
});

describe('ce NU poate rescrie severitatea', () => {
  it('o eticheta pusa de OM ramane a lui', () => {
    expect(lockedFromAutoDecision(poza({ status: 'selected', aiDecided: false }))).toBe(true);
    expect(lockedFromAutoDecision(poza({ status: 'rejected', aiDecided: false }))).toBe(true);
  });

  it('"candidat" e tot o hotarare a omului, nu o stare de asteptare', () => {
    expect(lockedFromAutoDecision(poza({ status: 'candidate', aiDecided: false }))).toBe(true);
    // Motorul nu produce niciodata 'candidate', dar chiar si asa marcata,
    // regula ramane cea de sus: statusul asta il pune doar omul.
    expect(lockedFromAutoDecision(poza({ status: 'candidate', aiDecided: true }))).toBe(false);
  });

  it('o poza DE DINAINTEA campului se trateaza ca decizie a omului', () => {
    // Nu se mai poate sti cine a pus eticheta. Greseala mai putin grava e sa
    // n-o atingem: pentru bibliotecile existente nu se schimba nimic.
    expect(lockedFromAutoDecision(poza({ status: 'selected' }))).toBe(true);
    expect(lockedFromAutoDecision(poza({ status: 'rejected' }))).toBe(true);
  });
});
