import { describe, it, expect } from 'vitest';
import { t } from './index';

describe('pluralul românesc automat', () => {
  it('pune „de” și singularul unde trebuie', () => {
    const ro = (n: number) => t('ro', 'lx.map.count', { count: n });
    expect(ro(1)).toContain('o poză');
    expect(ro(3)).toContain('3 poze');
    expect(ro(20)).toContain('20 de poze');
    expect(ro(101)).toContain('101 poze');
  });
  it('nu atinge „din” sau parametrii text', () => {
    expect(t('ro', 'lx.reader.title', { done: 20, total: 21 })).not.toContain('de din');
  });
});
