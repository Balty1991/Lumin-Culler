import { describe, it, expect, beforeEach } from 'vitest';
import {
  readProtectedPersons, writeProtectedPersons, isProtected, excludeProtected, countProtected
} from './protectedPersons';

const ph = (names: string[], extra: Record<string, unknown> = {}) => ({ personNames: names, ...extra });

describe('protectedPersons', () => {
  beforeEach(() => localStorage.clear());

  it('porneste fara nicio protectie', () => {
    expect(readProtectedPersons().size).toBe(0);
  });

  it('alegerea supravietuieste unei reincarcari', () => {
    writeProtectedPersons(new Set(['Ana', 'Bob']));
    expect([...readProtectedPersons()].sort()).toEqual(['Ana', 'Bob']);
  });

  it('ignora o valoare corupta in loc sa arunce', () => {
    localStorage.setItem('lumin-protected-persons', 'nu e json');
    expect(readProtectedPersons().size).toBe(0);
    localStorage.setItem('lumin-protected-persons', '{"Ana":1}');
    expect(readProtectedPersons().size).toBe(0);
    localStorage.setItem('lumin-protected-persons', '["Ana", 3, "", "Bob"]');
    expect([...readProtectedPersons()].sort()).toEqual(['Ana', 'Bob']);
  });

  it('fara nicio persoana protejata, nimic nu e protejat', () => {
    expect(isProtected(ph(['Ana']), new Set())).toBe(false);
  });

  it('o poza e protejata daca apare macar o persoana protejata', () => {
    const set = new Set(['Ana']);
    expect(isProtected(ph(['Ana']), set)).toBe(true);
    expect(isProtected(ph(['Bob', 'Ana']), set)).toBe(true);
    expect(isProtected(ph(['Bob']), set)).toBe(false);
    expect(isProtected(ph([]), set)).toBe(false);
  });

  it('numele se compara exact — "Ana" nu protejeaza "Anastasia"', () => {
    expect(isProtected(ph(['Anastasia']), new Set(['Ana']))).toBe(false);
  });

  it('scoate din tinte doar pozele protejate', () => {
    const targets = [ph(['Ana']), ph(['Bob']), ph([]), ph(['Ana', 'Bob'])];
    expect(excludeProtected(targets, new Set(['Ana']))).toHaveLength(2);
  });

  it('fara protectii, lista de tinte trece neatinsa (aceeasi referinta)', () => {
    const targets = [ph(['Ana'])];
    expect(excludeProtected(targets, new Set())).toBe(targets);
  });

  it('numara cate poze ar fi scoase, pentru mesajul dinaintea apasarii', () => {
    const targets = [ph(['Ana']), ph(['Ana']), ph(['Bob']), ph([])];
    expect(countProtected(targets, new Set(['Ana']))).toBe(2);
    expect(countProtected(targets, new Set())).toBe(0);
  });
});
