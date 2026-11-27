import { describe, it, expect, beforeEach } from 'vitest';
import { featuresOf, isReason, readReasons, reasonCounts, reasonsFor, recordReason, MAX_REASONS } from './reasons';

const f = featuresOf({ aiScore: 30, faceCount: 2, sharpness: 0.4, bestSmile: 0.8, personNames: ['Ana', 'Ion'], aiFactors: [{ feature: 'smile' }, { feature: 'blur' }, { feature: 'eyes' }, { feature: 'x' }] });

describe('reasons (corectură cu motiv)', () => {
  beforeEach(() => localStorage.clear());

  it('oferă motivele potrivite direcției', () => {
    expect(reasonsFor(true)).toEqual(['person', 'moment', 'memory']);
    expect(reasonsFor(false)).toEqual(['blurry', 'looks', 'better']);
    expect(isReason('person')).toBe(true);
    expect(isReason('altceva')).toBe(false);
  });

  it('instantaneul trăsăturilor nu păstrează nume, doar numărul de persoane', () => {
    expect(f).toEqual({ aiScore: 30, faceCount: 2, sharpness: 0.4, bestSmile: 0.8, people: 2, factors: ['smile', 'blur', 'eyes'] });
    expect(JSON.stringify(f)).not.toContain('Ana');
    expect(featuresOf({})).toEqual({ aiScore: 0, faceCount: 0, sharpness: 0, bestSmile: 0, people: 0, factors: [] });
  });

  it('notează motivul cu direcția și înlocuiește motivul vechi pe aceeași poză', () => {
    recordReason('a', 'blurry', f, 1);
    recordReason('a', 'better', f, 2);
    recordReason('b', 'person', f, 3);
    const list = readReasons();
    expect(list.map(e => [e.id, e.r, e.kept])).toEqual([['a', 'better', false], ['b', 'person', true]]);
  });

  it('numără motivele, cu zero pentru cele lipsă', () => {
    recordReason('a', 'person', f);
    recordReason('b', 'person', f);
    recordReason('c', 'looks', f);
    expect(reasonCounts()).toEqual({ person: 2, moment: 0, memory: 0, blurry: 0, looks: 1, better: 0 });
  });

  it('jurnalul e plafonat și rezistă la date stricate', () => {
    for (let i = 0; i < MAX_REASONS + 20; i++) recordReason(`p${i}`, 'moment', f, i);
    const list = readReasons();
    expect(list).toHaveLength(MAX_REASONS);
    expect(list[0].id).toBe('p20');
    localStorage.setItem('cp.reasons.v1', '{stricat');
    expect(readReasons()).toEqual([]);
    localStorage.setItem('cp.reasons.v1', JSON.stringify([{ id: 'x', r: 'nimic', kept: true, f: {} }, null]));
    expect(readReasons()).toEqual([]);
  });

  it('ignoră un motiv necunoscut', () => {
    recordReason('a', 'nimic' as never, f);
    expect(readReasons()).toEqual([]);
  });
});
