import { describe, expect, it } from 'vitest';
import { autopilotKeeps } from './batchOps';

describe('autopilotul nu aruncă familia și nici hârtiile', () => {
  it('păstrează fețele înrolate și mută documentele și capturile deoparte', () => {
    expect(autopilotKeeps({ personNames: ['Ami'] })).toBe('family');
    expect(autopilotKeeps({ personNames: [], aside: 'screenshot' })).toBe('aside');
    expect(autopilotKeeps({ aside: 'document' })).toBe('aside');
    expect(autopilotKeeps({ personNames: [], aside: null })).toBeNull();
  });
});