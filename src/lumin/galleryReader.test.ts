import { describe, it, expect } from 'vitest';
import { chunkSizeAt, readerPace } from './galleryReader';

describe('pachetele cititorului de galerie', () => {
  it('primele două pachete dau cel mult 40 de poze, pentru pauza de antrenament', () => {
    for (const chunk of [24, 40, 64]) {
      const first = chunkSizeAt(0, chunk);
      const second = chunkSizeAt(first, chunk);
      expect(first).toBe(8);
      expect(first + second).toBeGreaterThanOrEqual(30);
      expect(first + second).toBeLessThanOrEqual(40);
    }
  });
  it('după pauză, pachetele au mărimea telefonului', () => {
    expect(chunkSizeAt(40, 64)).toBe(64);
    expect(chunkSizeAt(32, 24)).toBe(24);
  });
});

describe('ritmul citirii', () => {
  it('viteză maximă doar la încărcat și cu ecranul nefolosit', () => {
    expect(readerPace({ charging: true, visible: false, active: false })).toBe('full');
    expect(readerPace({ charging: true, visible: true, active: false })).toBe('full');
    expect(readerPace({ charging: true, visible: true, active: true })).toBe('gentle');
    expect(readerPace({ charging: false, visible: false, active: false })).toBe('gentle');
  });
});

import { oldPhoneMode } from './galleryReader';
describe('oldPhoneMode', () => {
  it('telefoanele cu 2 GB sau galeriile uriașe citesc restul doar la încărcat', () => {
    expect(oldPhoneMode(2, 500)).toBe(true);
    expect(oldPhoneMode(8, 12_000)).toBe(true);
    expect(oldPhoneMode(4, 3_000)).toBe(false);
  });
});
