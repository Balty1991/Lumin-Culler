import { describe, expect, it } from 'vitest';
import { previewAllStrictness, previewStrictness } from './strictnessPreview';
import { FIXED_THRESHOLDS } from './scoreThresholds';
import type { PhotoView } from '../state/store';

/**
 * core/strictnessReversible.test.ts
 * Bara de severitate merge in AMBELE sensuri.
 *
 * Bug raportat de utilizator, cu doua capturi la un minut distanta: la
 * "Echilibrat" scria 24 de verificat (7 / 8 / 10 pe cele trei trepte); a apasat
 * "Ingaduitor", si de atunci ramaneau 7, cu toate trei treptele pe 7. Intors la
 * "Echilibrat", nu se mai intampla nimic — cele 17 poze mutate erau acum
 * `selected`/`rejected`, iar codul le ocolea "ca sa nu calce peste decizia ta".
 * Doar ca nu era decizia lui, era propunerea motorului de acum trei secunde.
 *
 * Ce se testeaza aici e proprietatea care lipsea: dupa ce motorul a etichetat
 * ceva, treptele CONTINUA sa dea numere diferite. Fara ea, controlul e cu sens
 * unic — arata ca trei optiuni si e de fapt o singura apasare utila.
 */
function poza(over: Partial<PhotoView> & { id: string }): PhotoView {
  const baza = { status: 'review', aiScore: 50, sharpness: 70, exposure: 55, faceCount: 1, allEyesOpen: true };
  return { ...baza, ...over } as PhotoView;
}

/** Un lot imprastiat peste praguri, cu subiect recunoscut (altfel nimic nu s-ar auto-aproba). */
const lot = Array.from({ length: 30 }, (_, i) => poza({ id: `${i}`, aiScore: 20 + i * 2 }));

describe('inainte ca motorul sa fi etichetat ceva', () => {
  it('cele trei trepte dau numere diferite', () => {
    const rezultate = previewAllStrictness(lot, FIXED_THRESHOLDS).map(o => o.review);
    expect(new Set(rezultate).size).toBeGreaterThan(1);
  });
});

describe('DUPA ce motorul a etichetat (apasarea de la "ingaduitor")', () => {
  // Exact starea de dupa prima apasare: pozele peste pragul ingaduitor sunt
  // acum `selected`, puse de MOTOR.
  const dupaIngaduitor = lot.map(p =>
    p.aiScore >= 57 ? poza({ ...p, status: 'selected', aiDecided: true }) : p
  );

  it('treptele RAMAN diferite — bara nu s-a blocat', () => {
    const rezultate = previewAllStrictness(dupaIngaduitor, FIXED_THRESHOLDS).map(o => o.review);
    expect(new Set(rezultate).size).toBeGreaterThan(1);
  });

  it('intoarcerea la "sever" chiar are ce muta inapoi', () => {
    const sever = previewStrictness(dupaIngaduitor, FIXED_THRESHOLDS, 'strict');
    expect(sever.changed).toBeGreaterThan(0);
  });

  it('si numara la fel de multe poze ca inainte de apasare', () => {
    // Nimic nu s-a "pierdut" din calcul: aceleasi 30 de poze sunt inca in joc,
    // fiindca niciuna n-a fost hotarata de om.
    const inainte = previewStrictness(lot, FIXED_THRESHOLDS, 'balanced');
    const dupa = previewStrictness(dupaIngaduitor, FIXED_THRESHOLDS, 'balanced');
    expect(dupa.kept + dupa.rejected + dupa.review).toBe(inainte.kept + inainte.rejected + inainte.review);
  });
});

describe('deciziile TALE raman ale tale', () => {
  it('o poza pe care ai hotarat-o tu nu se mai numara si nu se mai muta', () => {
    const cuAlegereaTa = lot.map(p =>
      p.id === '29' ? poza({ ...p, status: 'rejected', aiDecided: false }) : p
    );
    const rezultat = previewStrictness(cuAlegereaTa, FIXED_THRESHOLDS, 'lax');
    expect(rezultat.kept + rezultat.rejected + rezultat.review).toBe(29);
  });

  it('nici o poza VECHE, de dinaintea campului — nu se mai poate sti cine a decis', () => {
    const veche = lot.map(p => (p.id === '29' ? poza({ ...p, status: 'selected' }) : p));
    const rezultat = previewStrictness(veche, FIXED_THRESHOLDS, 'lax');
    expect(rezultat.kept + rezultat.rejected + rezultat.review).toBe(29);
  });
});
