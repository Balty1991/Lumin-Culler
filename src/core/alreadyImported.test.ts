import { describe, expect, it } from 'vitest';
import {
  buildLibraryIndex, partitionAlreadyImported, isAlreadyImported, emptyLibraryIndex
} from './alreadyImported';

/**
 * core/alreadyImported.test.ts
 * Cazul raportat la audit, cap-coada: 20 de poze, anulare la a 9-a, aceleasi 20
 * alese din nou. Fara modulul asta ieseau 29 de poze in biblioteca.
 */
function file(name: string, size: number, mediaUri?: string) {
  return { name, size, mediaUri };
}

describe('ce e deja in biblioteca', () => {
  it('acelasi nume si aceeasi marime inseamna acelasi fisier', () => {
    const index = buildLibraryIndex([{ fileName: 'IMG_001.jpg', sizeBytes: 4096 }]);
    expect(isAlreadyImported(index, file('IMG_001.jpg', 4096))).toBe(true);
    expect(isAlreadyImported(index, file('IMG_001.jpg', 4097))).toBe(false);
    expect(isAlreadyImported(index, file('IMG_002.jpg', 4096))).toBe(false);
  });

  it('majusculele din nume nu conteaza — Android si SAF nu sunt consecvente', () => {
    const index = buildLibraryIndex([{ fileName: 'IMG_001.JPG', sizeBytes: 4096 }]);
    expect(isAlreadyImported(index, file('img_001.jpg', 4096))).toBe(true);
  });

  it('URI-ul din galerie e destul singur, chiar cu alt nume sau alta marime', () => {
    const index = buildLibraryIndex([{ fileName: 'vechi.jpg', mediaUri: 'content://media/1' }]);
    expect(isAlreadyImported(index, file('redenumit.jpg', 999, 'content://media/1'))).toBe(true);
  });

  it('o inregistrare veche, fara marime si fara URI, nu blocheaza nimic', () => {
    const index = buildLibraryIndex([{ fileName: 'IMG_001.jpg' }]);
    expect(isAlreadyImported(index, file('IMG_001.jpg', 4096))).toBe(false);
  });

  /** Exact scenariul din raport. */
  it('reimportul dupa o anulare aduce doar ce lipseste', () => {
    const lot = Array.from({ length: 20 }, (_, i) => file(`p${i}.jpg`, 1000 + i));
    // Primul import s-a oprit la a 9-a poza: in biblioteca au ramas 9.
    const index = buildLibraryIndex(
      lot.slice(0, 9).map(f => ({ fileName: f.name, sizeBytes: f.size }))
    );

    const { fresh, alreadyImported } = partitionAlreadyImported(lot, index);

    expect(alreadyImported).toBe(9);
    expect(fresh).toHaveLength(11);
    expect(fresh.map(f => f.name)).not.toContain('p0.jpg');
  });

  it('doua copii ale aceluiasi fisier in acelasi lot se reduc la una', () => {
    const { fresh, alreadyImported } = partitionAlreadyImported(
      [file('a.jpg', 100), file('a.jpg', 100), file('b.jpg', 200)],
      emptyLibraryIndex()
    );
    expect(fresh.map(f => f.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(alreadyImported).toBe(1);
  });

  it('pe o biblioteca goala nu se sare peste nimic', () => {
    const lot = [file('a.jpg', 1), file('b.jpg', 2)];
    const { fresh, alreadyImported } = partitionAlreadyImported(lot, emptyLibraryIndex());
    expect(fresh).toHaveLength(2);
    expect(alreadyImported).toBe(0);
  });
});
