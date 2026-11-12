import { describe, it, expect, beforeEach } from 'vitest';
import { clearJankLog, jankMark, jankSummary, recordJank } from './jankLog';

describe('jurnalul blocajelor', () => {
  beforeEach(() => clearJankLog());
  it('notează blocajul cu pasul activ și ignoră ce e sub 200 ms', () => {
    const done = jankMark('fețe');
    recordJank(450, 1_800_000_000_000);
    recordJank(120, 1_800_000_000_100);
    done();
    recordJank(300, 1_800_000_001_000);
    const s = jankSummary();
    expect(s).toContain('fețe: 1x, total 450 ms, max 450 ms');
    expect(s).toContain('-: 1x, total 300 ms');
    expect(s).not.toContain('120');
  });
  it('spune limpede când nu a fost niciun blocaj', () => {
    expect(jankSummary()).toBe('niciun blocaj peste 200 ms');
  });
  it('atribuie blocajul pașilor care s-au suprapus în timp cu el, chiar dacă s-au terminat între timp', () => {
    const done = jankMark('decodare');
    const t0 = performance.now();
    done();
    recordJank(600, 1_800_000_002_000, t0 - 10);
    expect(jankSummary()).toMatch(/decodare[^|]*: 1x, total 600 ms/);
  });
});

describe('detaliul din Long Animation Frames', () => {
  it('scrie scripturile cele mai lungi și desenul', async () => {
    const { loafDetail } = await import('./jankLog');
    const d = loafDetail({ startTime: 0, duration: 900, renderStart: 700, styleAndLayoutStart: 750,
      scripts: [{ duration: 600, invoker: 'IDBRequest.onsuccess', sourceFunctionName: 'put', sourceURL: 'https://x/assets/db-AbC123xy.js' }] } as never);
    expect(d).toContain('IDBRequest.onsuccess→put@db.js 600ms');
    expect(d).toContain('desen 200ms');
  });
});
