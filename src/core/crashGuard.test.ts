import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('crashGuard', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  it('o poză de față la două închideri e sărită', async () => {
    const a = await import('./crashGuard');
    a.markInFlight('content://1');
    vi.resetModules();
    const b = await import('./crashGuard'); // prima repornire
    expect(b.crashSkippedUris().has('content://1')).toBe(false);
    b.markInFlight('content://1');
    vi.resetModules();
    const c = await import('./crashGuard'); // a doua
    expect(c.crashSkippedUris().has('content://1')).toBe(true);
  });
  it('o poză terminată normal nu primește punct', async () => {
    const a = await import('./crashGuard');
    a.markInFlight('content://2'); a.clearInFlight('content://2');
    vi.resetModules();
    const b = await import('./crashGuard');
    b.settlePreviousRun();
    expect(b.crashSkippedUris().size).toBe(0);
  });
});
