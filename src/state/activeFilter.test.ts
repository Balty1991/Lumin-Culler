import { describe, expect, it, beforeEach } from 'vitest';
import { readActiveFilter, writeActiveFilter } from './activeFilter';

/**
 * Bug raportat cu doua capturi la cinci minute distanta: aplicatia minimizata,
 * apoi redeschisa, si benzile planului de lucru disparusera. Nu benzile se
 * stricasera — ele se taie doar pe filtrul 'review' — ci FILTRUL se pierduse,
 * fiindca Android omoara WebView-ul aplicatiilor din fundal si Capacitor
 * reincarca pagina de la zero la revenire.
 */
describe('activeFilter', () => {
  beforeEach(() => { localStorage.clear(); });

  it('porneste pe "all" cand nu s-a salvat nimic', () => {
    expect(readActiveFilter()).toBe('all');
  });

  it('tine minte filtrul peste o repornire', () => {
    writeActiveFilter('review');
    expect(readActiveFilter()).toBe('review');
  });

  it('nu ocupa stocarea pentru valoarea implicita', () => {
    writeActiveFilter('review');
    writeActiveFilter('all');
    expect(localStorage.getItem('lumin-active-filter')).toBeNull();
    expect(readActiveFilter()).toBe('all');
  });

  // O cheie stricata (versiune veche, editare manuala) n-are voie sa duca
  // aplicatia intr-un filtru inexistent la pornire.
  it('ignora o valoare necunoscuta si cade pe "all"', () => {
    localStorage.setItem('lumin-active-filter', 'inventat');
    expect(readActiveFilter()).toBe('all');
  });

  it('accepta toate filtrele reale', () => {
    for (const f of ['selected', 'candidate', 'review', 'rejected', 'series', 'blinks', 'blurry', 'goldenHour', 'highlights'] as const) {
      writeActiveFilter(f);
      expect(readActiveFilter()).toBe(f);
    }
  });
});
