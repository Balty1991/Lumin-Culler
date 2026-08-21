import { describe, expect, it } from 'vitest';
import { rescueBestOfMoment, type MomentMember } from './momentRescue';

const m = (id: string, status: MomentMember['status']): MomentMember => ({ id, status });

describe('cel mai bun cadru al unui moment', () => {
  it('se salveaza cand tot grupul ar fi fost aruncat', () => {
    // rafala de seara: toate cadrele putin moi, deci toate respinse — momentul
    // ar fi disparut intreg inainte ca omul sa-l vada
    const grup = [m('a', 'rejected'), m('b', 'rejected'), m('c', 'rejected')];
    expect(rescueBestOfMoment(grup, 'b')).toBe('b');
  });

  it('nu se atinge de nimic cand a ramas macar un cadru in picioare', () => {
    expect(rescueBestOfMoment([m('a', 'rejected'), m('b', 'review')], 'a')).toBe(null);
    expect(rescueBestOfMoment([m('a', 'rejected'), m('b', 'selected')], 'a')).toBe(null);
    expect(rescueBestOfMoment([m('a', 'rejected'), m('b', 'pending')], 'a')).toBe(null);
  });

  it('nu inventeaza un salvat intr-un grup de unul singur', () => {
    // acolo hotaraste regula obisnuita: respingerea cere un defect care se poate numi
    expect(rescueBestOfMoment([m('a', 'rejected')], 'a')).toBe(null);
  });

  it('nu salveaza nimic daca cel mai bun nu e in grup', () => {
    expect(rescueBestOfMoment([m('a', 'rejected'), m('b', 'rejected')], 'lipseste')).toBe(null);
  });

  it('grup gol — nimic de facut', () => {
    expect(rescueBestOfMoment([], 'a')).toBe(null);
  });

  it('salveaza UNUL singur, nu tot grupul', () => {
    const grup = [m('a', 'rejected'), m('b', 'rejected'), m('c', 'rejected'), m('d', 'rejected')];
    const salvat = rescueBestOfMoment(grup, 'c');
    expect(salvat).toBe('c');
    // celelalte raman respinse — regula opreste disparitia clipei, nu triajul
    expect(grup.filter(x => x.id !== salvat).every(x => x.status === 'rejected')).toBe(true);
  });
});
