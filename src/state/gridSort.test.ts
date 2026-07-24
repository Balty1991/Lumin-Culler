import { describe, expect, it, beforeEach } from 'vitest';
import { compareBy, readGridSort, writeGridSort, type SortablePhoto } from './gridSort';

function photo(overrides: Partial<SortablePhoto>): SortablePhoto {
  return { capturedAt: 0, aiScore: 0, sharpness: 0, rating: 0, fileName: '', ...overrides };
}

describe('gridSort — compareBy', () => {
  it('compares by date (capturedAt), poze fara data tratate ca 0', () => {
    const a = photo({ capturedAt: 100 });
    const b = photo({ capturedAt: undefined });
    expect(compareBy('date', a, b)).toBeGreaterThan(0);
  });

  it('compares by score', () => {
    expect(compareBy('score', photo({ aiScore: 80 }), photo({ aiScore: 40 }))).toBeGreaterThan(0);
  });

  it('compares by sharpness', () => {
    expect(compareBy('sharpness', photo({ sharpness: 10 }), photo({ sharpness: 90 }))).toBeLessThan(0);
  });

  it('compares by rating', () => {
    expect(compareBy('rating', photo({ rating: 5 }), photo({ rating: 1 }))).toBeGreaterThan(0);
  });

  it('compares by filename (locale-aware)', () => {
    expect(compareBy('filename', photo({ fileName: 'a.jpg' }), photo({ fileName: 'b.jpg' }))).toBeLessThan(0);
  });
});

describe('gridSort — persistenta', () => {
  beforeEach(() => localStorage.clear());

  it('implicit este data ascendent cand nu exista nimic salvat', () => {
    expect(readGridSort()).toEqual({ key: 'date', dir: 'asc' });
  });

  it('citeste ce s-a scris anterior', () => {
    writeGridSort({ key: 'score', dir: 'desc' });
    expect(readGridSort()).toEqual({ key: 'score', dir: 'desc' });
  });

  it('cade pe implicit daca localStorage are date corupte', () => {
    localStorage.setItem('lumin-grid-sort', '{"key":"nu-exista","dir":"asc"}');
    expect(readGridSort()).toEqual({ key: 'date', dir: 'asc' });
  });
});
