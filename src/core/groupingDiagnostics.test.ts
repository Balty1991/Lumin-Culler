import { describe, it, expect, beforeEach } from 'vitest';
import { writeGroupingMotive, readGroupingMotive, clearGroupingMotive } from './groupingDiagnostics';
import type { MotiveGrupare } from '../workers/hashCompare.worker';

const PLIN: MotiveGrupare = {
  legatVizual: 12, legatRafala: 5, legatMoment: 3,
  respinsPreaDiferit: 40, respinsPreaDeparteInTimp: 7, respinsAltSubiect: 2, respinsAltLoc: 1,
  dovada: { faraSemnal: 4, peFete: 9, peImagine: 30, subPragAproape: 11, subPragMediu: 6, subPragDeparte: 13 }
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

  // Banda de dovadă a apărut după restul motivelor. O intrare scrisă înainte
  // de ea rămâne citibilă — dar fără să pretindă zerouri măsurate, care ar
  // spune „n-am găsit niciun semnal" în loc de „n-am măsurat".
  it('o intrare fără banda de dovadă rămâne citibilă, dar nu inventează zerouri', () => {
    const { dovada: _, ...faraBanda } = PLIN;
    writeGroupingMotive(faraBanda as MotiveGrupare);
    const citit = readGroupingMotive();
    expect(citit).toMatchObject(faraBanda);
    expect(citit!.dovada).toBeUndefined();
  });

  it('o bandă de dovadă stricată se scoate, restul motivelor rămân', () => {
    localStorage.setItem('lumin-grouping-motive',
      JSON.stringify({ ...PLIN, dovada: { faraSemnal: 'multe' } }));
    const citit = readGroupingMotive();
    expect(citit!.respinsAltSubiect).toBe(2);
    expect(citit!.dovada).toBeUndefined();
  });
});
