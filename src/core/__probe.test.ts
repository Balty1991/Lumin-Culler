import { describe, it } from 'vitest';
import { findUnrecognizedFaceClusters } from './faceClustering';

/** Embeddinguri aproape ortogonale -> fiecare fata isi face propriul cluster (cazul cel mai rau). */
function distinctEmbeddings(n: number, dim: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'p' + i, fileName: 'f' + i,
    faces: [{
      personId: null,
      embedding: Array.from({ length: dim }, (_, k) => (k === i % dim ? 1 : 0.001 * ((i * 7 + k) % 3))),
      box: [0, 0, 0.2, 0.2] as [number, number, number, number]
    }]
  }));
}

describe('PROBE faceClustering', () => {
  it('worst case', () => {
    for (const n of [500, 1000, 2000, 4000]) {
      const photos = distinctEmbeddings(n, 1024);
      const t0 = Date.now();
      const res = findUnrecognizedFaceClusters(photos);
      console.log(`n=${n} clusters=${res.length} ms=${Date.now() - t0}`);
    }
  });
});
