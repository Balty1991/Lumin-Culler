import { describe, expect, it } from 'vitest';
import { dateSearchWords } from './searchDateWords';

/** Cum compara store-ul: interogarea e normalizata la fel ca sirul. */
const q = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

describe('data unei poze, cautabila cum ar scrie-o omul', () => {
  const iulie = new Date(2026, 6, 29).getTime();

  it('luna intreaga', () => {
    expect(dateSearchWords(iulie, 'ro').includes(q('iulie'))).toBe(true);
    expect(dateSearchWords(iulie, 'en').includes(q('july'))).toBe(true);
  });

  it('luna scurta si anul', () => {
    expect(dateSearchWords(iulie, 'ro').includes(q('iul'))).toBe(true);
    expect(dateSearchWords(iulie, 'ro').includes('2026')).toBe(true);
  });

  it('nu confunda anii sau lunile', () => {
    expect(dateSearchWords(iulie, 'ro').includes('2024')).toBe(false);
    expect(dateSearchWords(iulie, 'ro').includes(q('decembrie'))).toBe(false);
  });

  it('fara diacritice, ca restul cautarii', () => {
    // februarie n-are diacritice, dar martie/octombrie in alte locale pot avea;
    // verificam ca sirul e deja normalizat, nu ca are un anume continut
    const s = dateSearchWords(iulie, 'ro');
    expect(s).toBe(s.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    expect(s).toBe(s.toLowerCase());
  });

  it('o data lipsa sau invalida da sir gol, nu arunca', () => {
    expect(dateSearchWords(undefined, 'ro')).toBe('');
    expect(dateSearchWords(NaN, 'ro')).toBe('');
    expect(dateSearchWords(Infinity, 'ro')).toBe('');
  });

  it('acelasi moment cere aceeasi munca o singura data (cache)', () => {
    const a = dateSearchWords(iulie, 'ro');
    const b = dateSearchWords(iulie, 'ro');
    expect(b).toBe(a);
  });

  it('limba schimba raspunsul, nu-l ia din cache-ul celeilalte', () => {
    expect(dateSearchWords(iulie, 'ro')).not.toBe(dateSearchWords(iulie, 'en'));
  });
});
