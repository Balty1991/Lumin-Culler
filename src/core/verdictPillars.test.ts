import { describe, expect, it } from 'vitest';
import { technicalPillar, seriesPillar, deliveryPillar, computePillars, type PillarSignals } from './verdictPillars';

const bun = (o: Partial<PillarSignals> = {}): PillarSignals => ({
  faceCount: 1, sharpness: 85, exposure: 50, allEyesOpen: true, ...o
});

describe('pilonul tehnic', () => {
  it('o poza curata e sus, una ratata e jos', () => {
    expect(technicalPillar(bun(), 85)).toBeGreaterThan(80);
    expect(technicalPillar(bun({ exposure: 15, highlightClipping: 0.2 }), 20)).toBeLessThan(35);
  });

  it('NU depinde de nicio pondere invatata — doi fotografi vad acelasi numar', () => {
    // functie pura de semnale masurate: acelasi input, acelasi output, mereu
    expect(technicalPillar(bun(), 85)).toBe(technicalPillar(bun(), 85));
  });

  it('un peisaj nu e penalizat ca n-are ochi de judecat', () => {
    // ponderea ochilor se redistribuie proportional peste restul, deci peisajul
    // ramane langa portretul echivalent — nu cade cu 15 puncte pentru ceva ce
    // nici nu are. (Nu sunt EGALE: un portret cu ochii perfect deschisi are un
    // semnal in plus, mai mare decat media celorlalte, deci urca un pic.)
    const peisaj = technicalPillar(bun({ faceCount: 0, allEyesOpen: false }), 85);
    const portret = technicalPillar(bun({ faceCount: 1, allEyesOpen: true }), 85);
    expect(Math.abs(peisaj - portret)).toBeLessThanOrEqual(2);
  });

  it('ochii inchisi trag in jos doar cand exista o fata', () => {
    expect(technicalPillar(bun({ faceCount: 2, allEyesOpen: false }), 85))
      .toBeLessThan(technicalPillar(bun({ faceCount: 2, allEyesOpen: true }), 85));
  });
});

describe('pilonul de serie', () => {
  it('nu exista fara serie', () => {
    expect(seriesPillar(70, [70])).toBe(null);
    expect(seriesPillar(70, [])).toBe(null);
  });

  it('cel mai bun al momentului ia 100, cel mai slab 0', () => {
    expect(seriesPillar(90, [90, 60, 30])).toBe(100);
    expect(seriesPillar(30, [90, 60, 30])).toBe(0);
  });

  it('lucreaza pe ranguri, nu pe diferenta de scor', () => {
    // aceleasi ranguri, diferente de scor complet diferite => acelasi rezultat
    expect(seriesPillar(51, [51, 50, 49])).toBe(seriesPillar(90, [90, 50, 10]));
  });

  it('cadrele egale primesc aceeasi cifra — niciunul nu ia 100 doar fiindca era primul', () => {
    const [a, b] = [seriesPillar(70, [70, 70, 40]), seriesPillar(70, [70, 70, 40])];
    expect(a).toBe(b);
    expect(a).toBeLessThan(100);
  });
});

describe('pilonul de livrare', () => {
  it('poate fi MARE pe o poza slaba — "nu e grozava, dar se aduce repede acolo"', () => {
    // subexpusa dar clara: expunerea se repara
    const subexpusa = bun({ exposure: 20 });
    expect(deliveryPillar(subexpusa, 85)).toBeGreaterThan(80);
  });

  it('claritatea nu se repara, deci taie adanc', () => {
    expect(deliveryPillar(bun(), 20)).toBeLessThan(65);
  });

  it('luminile ARSE taie, umbrele inecate nu', () => {
    const arse = deliveryPillar(bun({ highlightClipping: 0.2 }), 85);
    const inecate = deliveryPillar(bun({ shadowClipping: 0.2 }), 85);
    expect(arse).toBeLessThan(inecate);
  });

  it('ochii inchisi si subiectul neclar nu se repara', () => {
    expect(deliveryPillar(bun({ allEyesOpen: false }), 85)).toBeLessThan(deliveryPillar(bun(), 85));
    expect(deliveryPillar(bun({ subjectInFocus: false }), 85)).toBeLessThan(deliveryPillar(bun(), 85));
  });
});

describe('cei patru piloni impreuna', () => {
  it('se pot contrazice, si asta e informatie: cel mai bun dintr-o rafala ratata', () => {
    const p = computePillars(bun({ exposure: 20 }), 30, 40, [40, 20, 15], undefined);
    expect(p.series).toBe(100);
    expect(p.technical).toBeLessThan(50);
  });

  it('gustul lipseste cat timp e doar zgomot', () => {
    expect(computePillars(bun(), 85, 70, [70], 2).personal).toBe(null);
    expect(computePillars(bun(), 85, 70, [70], undefined).personal).toBe(null);
    expect(computePillars(bun(), 85, 70, [70], 9).personal).toBe(9);
  });
});
