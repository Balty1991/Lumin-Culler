import { describe, expect, it } from 'vitest';
import { formatLegacyLine, formatScanLine, type LastScan } from './scanSummary';

const scan: LastScan = {
  count: 1240,
  durationMs: 48_000,
  stage1Ms: 12_000,
  stage2Ms: 36_000,
  at: 0
};

describe('rezumatul scanării', () => {
  it('spune durata pe poză și cele două trepte', () => {
    expect(formatScanLine(scan)).toBe(
      'Analizat 1.240 de poze în 48 s (0,04 s/poză)\npregătire 0,0 s · treapta 1 12 s · treapta 2 36 s · disc 0,0 s'
    );
  });

  it('reconstituie textul din Statistici al lui 2.1.2, pe același ceas', () => {
    expect(formatLegacyLine(scan)).toBe(
      'În 2.1.2, Statistici arăta „1240 de poze în 48.0s (25.8 poze/secundă)”, fără trepte. „poze/secundă” e inversul lui „s/poză”, pe același ceas.'
    );
  });

  it('o singură poză nu primește pluralul', () => {
    expect(formatScanLine({ ...scan, count: 1, durationMs: 1500, stage1Ms: 400, stage2Ms: 900 })).toContain('Analizat 1 poză');
  });
});
