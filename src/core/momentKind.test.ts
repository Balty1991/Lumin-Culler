import { describe, it, expect } from 'vitest';
import { isMoment } from './momentKind';

describe('isMoment', () => {
  it('tortul cu un copil e moment', () => expect(isMoment({ faceCount: 1, sceneTags: ['Cake', 'Candle'] })).toBe(true));
  it('doi oameni care zâmbesc e moment', () => expect(isMoment({ faceCount: 2, bestSmile: 0.7 })).toBe(true));
  it('râsul larg e moment', () => expect(isMoment({ faceCount: 1, bestSmile: 0.9 })).toBe(true));
  it('tortul fără oameni nu e moment (e mâncare)', () => expect(isMoment({ faceCount: 0, sceneTags: ['Cake'] })).toBe(false));
  it('un portret serios nu e moment', () => expect(isMoment({ faceCount: 1, bestSmile: 0.1 })).toBe(false));
});
