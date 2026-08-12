import { describe, it, expect, beforeEach } from 'vitest';
import { isSensitiveDocument, selectPendingShieldReview, dismissSensitiveDocument, readShieldDismissedIds } from './documentShield';

beforeEach(() => {
  localStorage.clear();
});

describe('isSensitiveDocument', () => {
  it('is false when textCoverage is absent (web/PWA, no OCR)', () => {
    expect(isSensitiveDocument({})).toBe(false);
  });
  it('is false below the threshold', () => {
    expect(isSensitiveDocument({ textCoverage: 0.05 })).toBe(false);
  });
  it('is true at/above the threshold', () => {
    expect(isSensitiveDocument({ textCoverage: 0.15 })).toBe(true);
    expect(isSensitiveDocument({ textCoverage: 0.4 })).toBe(true);
  });
});

describe('dismissSensitiveDocument / readShieldDismissedIds', () => {
  it('starts empty', () => {
    expect(readShieldDismissedIds().size).toBe(0);
  });
  it('remembers dismissed ids across reads', () => {
    dismissSensitiveDocument('p1');
    dismissSensitiveDocument('p2');
    const ids = readShieldDismissedIds();
    expect(ids.has('p1')).toBe(true);
    expect(ids.has('p2')).toBe(true);
    expect(ids.has('p3')).toBe(false);
  });
});

describe('selectPendingShieldReview', () => {
  const photos = [
    { id: 'doc1', textCoverage: 0.3 },
    { id: 'doc2', textCoverage: 0.5 },
    { id: 'photo1', textCoverage: 0.01 },
    { id: 'photo2' }
  ];

  it('only returns sensitive documents', () => {
    const result = selectPendingShieldReview(photos, new Set(), new Set());
    expect(result.map(p => p.id)).toEqual(['doc1', 'doc2']);
  });

  it('excludes documents already moved to the private vault', () => {
    const result = selectPendingShieldReview(photos, new Set(['doc1']), new Set());
    expect(result.map(p => p.id)).toEqual(['doc2']);
  });

  it('excludes documents explicitly dismissed', () => {
    const result = selectPendingShieldReview(photos, new Set(), new Set(['doc2']));
    expect(result.map(p => p.id)).toEqual(['doc1']);
  });
});
