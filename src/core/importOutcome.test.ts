import { describe, it, expect, beforeEach } from 'vitest';
import {
  readImportOutcomes, recordImportOutcome, resetImportOutcomes, summariseOutcomes,
  MAX_OUTCOMES, type ImportOutcome, measuredMsPerPhoto } from './importOutcome';

const o = (over: Partial<ImportOutcome> = {}): ImportOutcome =>
  ({ ts: 1, total: 100, imported: 100, failed: 0, skipped: 0, ...over });

describe('importOutcome', () => {
  beforeEach(() => localStorage.clear());

  it('porneste gol si nu rezuma nimic', () => {
    expect(readImportOutcomes()).toEqual([]);
    expect(summariseOutcomes()).toBeNull();
  });

  it('retine un import si il regaseste dupa reincarcare', () => {
    recordImportOutcome(o({ ts: 5, failed: 3 }));
    expect(readImportOutcomes()).toEqual([o({ ts: 5, failed: 3 })]);
  });

  it('nu retine un import fara niciun fisier', () => {
    recordImportOutcome(o({ total: 0, imported: 0, skipped: 0 }));
    expect(readImportOutcomes()).toEqual([]);
  });

  it('retine un import in care totul a fost sarit — si asta e ceva de stiut', () => {
    recordImportOutcome(o({ total: 0, imported: 0, skipped: 7 }));
    expect(readImportOutcomes()).toHaveLength(1);
  });

  it('pastreaza cele mai NOI importuri, nu primele', () => {
    for (let i = 0; i < MAX_OUTCOMES + 5; i++) recordImportOutcome(o({ ts: i }));
    const all = readImportOutcomes();
    expect(all).toHaveLength(MAX_OUTCOMES);
    expect(all[all.length - 1].ts).toBe(MAX_OUTCOMES + 4);
  });

  it('ignora intrarile corupte in loc sa arunce', () => {
    localStorage.setItem('lumin-import-outcomes', 'nu e json');
    expect(readImportOutcomes()).toEqual([]);
    localStorage.setItem('lumin-import-outcomes', JSON.stringify([o(), { ts: 'ieri' }, null, 7]));
    expect(readImportOutcomes()).toHaveLength(1);
  });

  it('nu retine nume de fisiere', () => {
    recordImportOutcome(o({ failed: 2, reasons: 'RangeError: out of memory (x2)' }));
    const raw = localStorage.getItem('lumin-import-outcomes') ?? '';
    expect(raw).not.toMatch(/\.(jpg|jpeg|png|heic|cr2|nef)/i);
  });

  it('scoate numele de fisier din motiv, oricat de bine ar fi ascuns', () => {
    recordImportOutcome(o({ failed: 1, reasons: 'RangeError: out of memory [fisier real: heic, etichetat "IMG_4821.HEIC"] (x1)' }));
    const stored = readImportOutcomes()[0].reasons!;
    expect(stored).toBe('RangeError: out of memory (x1)');
  });

  it('inlocuieste un nume de fisier ramas pe dinafara, in loc sa-l pastreze', () => {
    recordImportOutcome(o({ failed: 1, reasons: 'Nu s-a putut decoda vacanta-2019.jpg (x1)' }));
    expect(readImportOutcomes()[0].reasons).toBe('Nu s-a putut decoda <fisier> (x1)');
  });

  it('rezuma peste toate importurile, cu rata de esec', () => {
    recordImportOutcome(o({ ts: 1, total: 100, imported: 90, failed: 10 }));
    recordImportOutcome(o({ ts: 2, total: 100, imported: 100, failed: 0, skipped: 4 }));
    const s = summariseOutcomes()!;
    expect(s.imports).toBe(2);
    expect(s.totalPhotos).toBe(200);
    expect(s.totalFailed).toBe(10);
    expect(s.totalSkipped).toBe(4);
    expect(s.failureRate).toBe(5);
  });

  it('rezumatul da cel mai RECENT motiv, nu primul', () => {
    recordImportOutcome(o({ ts: 1, failed: 1, reasons: 'vechi' }));
    recordImportOutcome(o({ ts: 2, failed: 1, reasons: 'nou' }));
    expect(summariseOutcomes()!.lastReason).toBe('nou');
  });

  it('rezumatul nu imparte la zero', () => {
    recordImportOutcome(o({ total: 0, imported: 0, skipped: 3 }));
    expect(summariseOutcomes()!.failureRate).toBe(0);
  });

  it('resetul sterge tot', () => {
    recordImportOutcome(o());
    resetImportOutcomes();
    expect(readImportOutcomes()).toEqual([]);
  });
});

describe('measuredMsPerPhoto — numitorul pentru motorul nou', () => {
  /**
   * Fara cifra asta, "motorul nou ar adauga 106 ms pe poza" nu inseamna nimic:
   * 106 peste ce? Ea da termenul de comparatie, masurat la importurile
   * utilizatorului, nu presupus.
   */
  it('aduna toate importurile cu durata, nu doar ultimul', () => {
    // Un singur lot de trei poze e dominat de pornirea modelelor si n-ar
    // descrie deloc un import obisnuit.
    const ms = measuredMsPerPhoto([
      { ts: 1, total: 3, imported: 3, failed: 0, skipped: 0, durationMs: 30_000 },
      { ts: 2, total: 100, imported: 100, failed: 0, skipped: 0, durationMs: 70_000 }
    ]);
    expect(ms).toBeCloseTo(100_000 / 103, 3);
  });

  it('ignora inregistrarile fara durata — cele scrise inainte de acest camp', () => {
    const ms = measuredMsPerPhoto([
      { ts: 1, total: 50, imported: 50, failed: 0, skipped: 0 },
      { ts: 2, total: 10, imported: 10, failed: 0, skipped: 0, durationMs: 5_000 }
    ]);
    expect(ms).toBe(500);
  });

  it('fara nicio inregistrare cu durata nu inventeaza un numitor', () => {
    expect(measuredMsPerPhoto([])).toBeNull();
    expect(measuredMsPerPhoto([{ ts: 1, total: 5, imported: 5, failed: 0, skipped: 0 }])).toBeNull();
  });

  it('ignora un import care n-a adus nicio poza — ar fi impartire la zero', () => {
    expect(measuredMsPerPhoto([{ ts: 1, total: 5, imported: 0, failed: 5, skipped: 0, durationMs: 9_000 }])).toBeNull();
  });
});
