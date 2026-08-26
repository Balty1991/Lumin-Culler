import { describe, expect, it, beforeEach } from 'vitest';
import { isAiDegradedNoticeDismissed, dismissAiDegradedNotice } from './aiDegradedNotice';

describe('aiDegradedNotice', () => {
  beforeEach(() => { localStorage.clear(); });

  it('la inceput anuntul se arata', () => {
    expect(isAiDegradedNoticeDismissed('wasm')).toBe(false);
  });

  it('odata inchis, nu mai revine pentru acelasi backend', () => {
    dismissAiDegradedNotice('wasm');
    expect(isAiDegradedNoticeDismissed('wasm')).toBe(true);
  });

  // Daca situatia de accelerare se schimba, chiar e informatie noua.
  it('revine cand backendul s-a schimbat', () => {
    dismissAiDegradedNotice('wasm');
    expect(isAiDegradedNoticeDismissed('webgl')).toBe(false);
  });

  it('nu confunda un backend necunoscut cu unul inchis', () => {
    dismissAiDegradedNotice('unknown');
    expect(isAiDegradedNoticeDismissed('unknown')).toBe(true);
    expect(isAiDegradedNoticeDismissed('')).toBe(false);
  });
});
