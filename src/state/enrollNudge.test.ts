import { describe, expect, it } from 'vitest';
import { shouldShowEnrollNudge, MIN_PHOTOS_WITH_FACES, MIN_DECISIONS } from './enrollNudge';

const gata = { enrolledPersons: 0, photosWithFaces: MIN_PHOTOS_WITH_FACES, decidedPhotos: MIN_DECISIONS, dismissed: false };

describe('cand merita indemnul de inrolare', () => {
  it('dupa ce omul a triat ceva, pe o biblioteca cu oameni in ea', () => {
    expect(shouldShowEnrollNudge(gata)).toBe(true);
  });

  it('niciodata inainte sa fi triat destul — un indemn la instalare e o cerinta nemeritata', () => {
    expect(shouldShowEnrollNudge({ ...gata, decidedPhotos: MIN_DECISIONS - 1 })).toBe(false);
    expect(shouldShowEnrollNudge({ ...gata, decidedPhotos: 0 })).toBe(false);
  });

  it('niciodata pe o biblioteca fara oameni — sfatul n-ar avea sens', () => {
    expect(shouldShowEnrollNudge({ ...gata, photosWithFaces: 0 })).toBe(false);
    expect(shouldShowEnrollNudge({ ...gata, photosWithFaces: MIN_PHOTOS_WITH_FACES - 1 })).toBe(false);
  });

  it('niciodata daca deja exista cineva inrolat — nu mai are ce spune', () => {
    expect(shouldShowEnrollNudge({ ...gata, enrolledPersons: 1 })).toBe(false);
  });

  it('inchis o data, inchis definitiv — inrolarea se face o data, nu se aminteste periodic', () => {
    expect(shouldShowEnrollNudge({ ...gata, dismissed: true })).toBe(false);
  });
});
