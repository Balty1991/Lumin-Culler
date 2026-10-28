import { describe, it, expect } from 'vitest';
import { buildCoverage, monthStart } from './coverage';

describe('buildCoverage', () => {
  it('compares the gallery with what the AI has seen, month by month', () => {
    const oct = monthStart(new Date(2026, 9, 10).getTime());
    const sep = monthStart(new Date(2026, 8, 10).getTime());
    const rows = buildCoverage(new Map([[oct, 10], [sep, 40]]), [
      { capturedAt: new Date(2026, 9, 2).getTime(), importedAt: 0, status: 'selected' },
      { capturedAt: new Date(2026, 9, 3).getTime(), importedAt: 0, status: 'review' }
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ start: oct, inGallery: 10, seen: 2, waiting: 1 }),
      expect.objectContaining({ start: sep, inGallery: 40, seen: 0, waiting: 0 })
    ]);
  });
});
