import { describe, it, expect } from 'vitest';
import { searchPhotos } from './textSearch';

const base = { fileName: 'IMG.jpg', importedAt: 0, personNames: [], faceCount: 0 };

describe('searchPhotos', () => {
  it('finds by Romanian word through scene tags and synonyms, without diacritics', () => {
    const photos = [
      { ...base, id: 'a', sceneTags: ['Cat', 'Bed'] },
      { ...base, id: 'b', sceneTags: ['Dog'] }
    ];
    expect(searchPhotos(photos, 'pisică').map(p => p.id)).toEqual(['a']);
    expect(searchPhotos(photos, 'pisica pat').map(p => p.id)).toEqual(['a']);
  });

  it('finds people by name, receipts by word and photos by month', () => {
    const photos = [
      { ...base, id: 'ana', personNames: ['Ana'], faceCount: 1, capturedAt: new Date(2026, 9, 3).getTime() },
      { ...base, id: 'bon', aside: 'document', ocrText: 'TOTAL 23 LEI' }
    ];
    expect(searchPhotos(photos, 'ana').map(p => p.id)).toEqual(['ana']);
    expect(searchPhotos(photos, 'bon').map(p => p.id)).toEqual(['bon']);
    expect(searchPhotos(photos, 'octombrie').map(p => p.id)).toEqual(['ana']);
  });
});
