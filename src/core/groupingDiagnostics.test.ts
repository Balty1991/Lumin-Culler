import { describe, it, expect, beforeEach } from 'vitest';
import { writeGroupingMotive, readGroupingMotive, clearGroupingMotive } from './groupingDiagnostics';
import type { MotiveGrupare } from '../workers/hashCompare.worker';

const PLIN: MotiveGrupare = {
  legatVizual: 12, legatRafala: 5, legatMoment: 3,
  respinsPreaDiferit: 40, respinsPreaDeparteInTimp: 7, respinsAltSubiect: 2, respinsAltLoc: 1
};

describe('motivele grupării', () => {
  beforeEach(() => clearGroupingMotive());

  it('scrie și citește aceleași numere', () => {
    writeGroupingMotive(PLIN);
    expect(readGroupingMotive()).toEqual(PLIN);
  });

  it('fără nicio grupare încă, nu inventează zerouri', () => {
    expect(readGroupingMotive()).toBeNull();
  });

  it('o intrare stricată nu scoate ecranul din funcțiune', () => {
    localStorage.setItem('lumin-grouping-motive', '{"legatVizual":"multe"}');
    expect(readGroupingMotive()).toBeNull();
    localStorage.setItem('lumin-grouping-motive', 'nu e json');
    expect(readGroupingMotive()).toBeNull();
  });

  it('o intrare de la o versiune mai veche, fără toate câmpurile, e ignorată', () => {
    localStorage.setItem('lumin-grouping-motive', JSON.stringify({ legatVizual: 3 }));
    expect(readGroupingMotive()).toBeNull();
  });
});
