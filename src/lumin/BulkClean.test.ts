import { describe, it, expect } from 'vitest';
import { parseCleanCommand } from './BulkClean';

describe('parseCleanCommand', () => {
  it('capturi mai vechi de o lună', () => {
    expect(parseCleanCommand('Șterge capturile mai vechi de o lună')).toEqual({ kinds: ['screenshot'], months: 1 });
  });
  it('mișcate și întunecate de anul trecut', () => {
    const r = parseCleanCommand('pozele mișcate și întunecate de anul trecut');
    expect(r.kinds).toEqual(['blurry', 'dark']);
    expect(r.months).toBe(12);
  });
  it('documente mai vechi de 6 luni', () => {
    expect(parseCleanCommand('bonurile și documentele mai vechi de 6 luni')).toEqual({ kinds: ['document'], months: 6 });
  });
  it('fără nimic recunoscut', () => {
    expect(parseCleanCommand('fă ceva').kinds).toEqual([]);
  });
});
