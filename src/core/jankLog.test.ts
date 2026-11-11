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
});
