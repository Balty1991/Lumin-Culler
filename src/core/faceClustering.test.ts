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
