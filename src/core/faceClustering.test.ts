import { describe, expect, it } from 'vitest';
import { findUnrecognizedFaceClusters, type ClusterablePhoto } from './faceClustering';

const BOX: [number, number, number, number] = [0.1, 0.1, 0.2, 0.2];

function photo(id: string, faces: { personId: string | null; embedding?: number[] }[]): ClusterablePhoto {
  return { id, fileName: `${id}.jpg`, faces: faces.map(f => ({ ...f, box: BOX })) };
}

describe('findUnrecognizedFaceClusters', () => {
  it('groups near-identical embeddings from different photos into one cluster', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p2', [{ personId: null, embedding: [0.99, 0.01, 0] }]),
      photo('p3', [{ personId: null, embedding: [0.98, 0.02, 0] }])
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map(m => m.photoId).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('keeps dissimilar faces in separate clusters', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p2', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p3', [{ personId: null, embedding: [0, 1, 0] }]),
      photo('p4', [{ personId: null, embedding: [0, 1, 0] }])
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('ignores already-recognized faces (personId set)', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: 'known-id', embedding: [1, 0, 0] }]),
      photo('p2', [{ personId: 'known-id', embedding: [1, 0, 0] }])
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('ignores faces without an embedding', () => {
    const clusters = findUnrecognizedFaceClusters([photo('p1', [{ personId: null }])]);
    expect(clusters).toHaveLength(0);
  });

  it('drops clusters below the minimum size (a single unmatched face is not a suggestion)', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p2', [{ personId: null, embedding: [0, 1, 0] }])
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('sorts clusters largest first', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [0, 1, 0] }]),
      photo('p2', [{ personId: null, embedding: [0, 1, 0] }]),
      photo('p3', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p4', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p5', [{ personId: null, embedding: [1, 0, 0] }])
    ]);
    expect(clusters.map(c => c.members.length)).toEqual([3, 2]);
  });
});

/**
 * Optimizare facuta de auditul QA (vezi cosineWithNorms in faceClustering.ts):
 * normele erau recalculate la FIECARE comparatie, desi sunt constante per
 * cluster/per fata. Aceste teste blocheaza cerinta care conteaza: rezultatul
 * trebuie sa ramana EXACT acelasi, inclusiv la limita pragului si pentru
 * embeddinguri de lungimi diferite (unde se cade inapoi pe varianta originala,
 * care trunchiaza la cel mai scurt).
 */
describe('findUnrecognizedFaceClusters — echivalenta dupa precalcularea normelor', () => {
  it('gruparea nu depinde de MARIMEA vectorilor, doar de directia lor (cosinus, nu distanta)', () => {
    // acelasi unghi, norme foarte diferite -> tot un singur cluster
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('p2', [{ personId: null, embedding: [1000, 0, 0] }]),
      photo('p3', [{ personId: null, embedding: [0.0001, 0, 0] }])
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(3);
  });

  it('pragul ramane exact acolo unde era (0.65): 0.66 grupeaza, 0.64 nu', () => {
    const above = Math.cos(Math.acos(0.66));
    const below = Math.cos(Math.acos(0.64));
    const partner = (c: number) => [c, Math.sqrt(1 - c * c), 0];

    expect(findUnrecognizedFaceClusters([
      photo('a', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('b', [{ personId: null, embedding: partner(above) }])
    ])).toHaveLength(1);

    expect(findUnrecognizedFaceClusters([
      photo('a', [{ personId: null, embedding: [1, 0, 0] }]),
      photo('b', [{ personId: null, embedding: partner(below) }])
    ])).toHaveLength(0);
  });

  it('embeddinguri de lungimi DIFERITE cad pe calea veche (trunchiere), fara sa arunce', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [1, 0, 0, 0] }]),
      photo('p2', [{ personId: null, embedding: [1, 0] }])
    ]);
    expect(clusters).toHaveLength(1);
  });

  it('un embedding numai din zerouri nu grupeaza nimic (norma 0, similaritate 0)', () => {
    const clusters = findUnrecognizedFaceClusters([
      photo('p1', [{ personId: null, embedding: [0, 0, 0] }]),
      photo('p2', [{ personId: null, embedding: [0, 0, 0] }])
    ]);
    expect(clusters).toHaveLength(0);
  });
});
