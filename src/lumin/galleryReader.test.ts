import { describe, it, expect } from 'vitest';
import { chunkSizeAt } from './galleryReader';

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
