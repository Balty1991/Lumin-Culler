import { describe, it, expect } from 'vitest';
import { RenderQueue } from './renderQueue';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('rândul la poza clară', () => {
  it('poza mare trece înaintea dalelor, iar dintre dale prima e cea mai nouă', async () => {
    const q = new RenderQueue<string>(1, 24);
    const order: string[] = [];
    let release!: () => void;
    const first = q.add(() => new Promise<string>(r => { release = () => { order.push('a'); r('a'); }; }), false);
    const job = (n: string, urgent: boolean) => q.add(async () => { order.push(n); return n; }, urgent);
    const rest = [job('dala1', false), job('dala2', false), job('ecran', true), job('dala3', false)];
    release();
    await Promise.all([first, ...rest]);
    expect(order).toEqual(['a', 'ecran', 'dala3', 'dala2', 'dala1']);
  });
  it('dalele vechi peste limită se abandonează, nu țin rândul pe loc', async () => {
    const q = new RenderQueue<number>(1, 2);
    let release!: () => void;
    const blocker = q.add(() => new Promise<number>(r => { release = () => r(0); }), true);
    const results = [1, 2, 3, 4].map(n => q.add(async () => n, false));
    await tick();
    expect(q.waiting).toBe(2);
    release();
    await blocker;
    expect(await Promise.all(results)).toEqual([null, null, 3, 4]);
  });
  it('o cerere care eșuează întoarce null și rândul merge mai departe', async () => {
    const q = new RenderQueue<number>(1, 24);
    const bad = q.add(async () => { throw new Error('x'); }, true);
    const good = q.add(async () => 7, true);
    expect(await bad).toBeNull();
    expect(await good).toBe(7);
  });
});
