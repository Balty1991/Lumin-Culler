import { describe, it, expect } from 'vitest';
import { faceBlinks, photoEyesClosed, eyesOpenFromFlags } from './blinkVerdict';

const T = 0.5;
const face = (left: number, right: number, smile = 0, w = 0.2) => ({ box: [0, 0, w, w], smile, eyesOpen: { left, right } });

describe('blinkVerdict', () => {
  it('ambii ochi închiși, fără zâmbet: clipește', () => {
    expect(faceBlinks(face(0.1, 0.1), T)).toBe(true);
  });
  it('râsul strânge ochii: nu e clipit', () => {
    expect(faceBlinks(face(0.25, 0.3, 0.9), T)).toBe(false);
  });
  it('un singur ochi sub prag, celălalt larg deschis: cap întors, nu clipit', () => {
    expect(faceBlinks(face(0.2, 0.95), T)).toBe(false);
  });
  it('o față mică din fundal cu ochii închiși nu decide poza', () => {
    expect(photoEyesClosed([face(0.9, 0.9, 0.5, 0.3), face(0.1, 0.1, 0, 0.06)], T)).toBe(false);
  });
  it('fața principală cu ochii închiși decide poza', () => {
    expect(photoEyesClosed([face(0.1, 0.1, 0, 0.3), face(0.9, 0.9, 0, 0.28)], T)).toBe(true);
  });
  it('la un grup de trei, o singură față secundară clipind nu respinge', () => {
    expect(photoEyesClosed([face(0.9, 0.9, 0, 0.3), face(0.9, 0.9, 0, 0.28), face(0.1, 0.1, 0, 0.25)], T)).toBe(false);
  });
  it('flagurile: fața mare deschisă, una mică închisă = ochi deschiși', () => {
    expect(eyesOpenFromFlags([{ ...face(0.9, 0.9, 0, 0.3), isBlinking: false }, { ...face(0.1, 0.1, 0, 0.05), isBlinking: true }])).toBe(true);
  });
});

describe('privirea în jos', () => {
  it('capul aplecat cu pleoape lăsate nu e clipit', () => {
    expect(faceBlinks({ pitch: -25, eyesOpen: { left: 0.3, right: 0.3 } }, 0.5)).toBe(false);
  });
  it('capul aplecat cu ochii chiar lipiți rămâne clipit', () => {
    expect(faceBlinks({ pitch: -25, eyesOpen: { left: 0.05, right: 0.05 } }, 0.5)).toBe(true);
  });
});
