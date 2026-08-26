import { describe, it, expect } from 'vitest';
import { findSimilarPhotos, SIMILAR_LIMIT, SIMILAR_THRESHOLD, type EmbeddedPhoto } from './similarPhotos';

/** Vector unitar intr-un spatiu mic, ca similaritatea cosinus sa fie usor de citit din test. */
const vec = (...v: number[]) => v;

describe('findSimilarPhotos', () => {
  it('intoarce pozele apropiate, cele mai apropiate intai, fara sursa', () => {
    const rows: EmbeddedPhoto[] = [
      { photoId: 'sursa', imageEmbedding: vec(1, 0, 0) },
      { photoId: 'aproape', imageEmbedding: vec(0.98, 0.2, 0) },
      { photoId: 'ceva-mai-departe', imageEmbedding: vec(0.75, 0.66, 0) },
      { photoId: 'strain', imageEmbedding: vec(0, 1, 0) }
    ];

    expect(findSimilarPhotos(rows, 'sursa')).toEqual(['aproape', 'ceva-mai-departe']);
  });

  it('sub prag nu intra nimic — "strain" e la 90 de grade', () => {
    const rows: EmbeddedPhoto[] = [
      { photoId: 'sursa', imageEmbedding: vec(1, 0) },
      { photoId: 'strain', imageEmbedding: vec(0, 1) }
    ];
    expect(findSimilarPhotos(rows, 'sursa')).toEqual([]);
  });

  it('o sursa fara embedding intoarce gol, nu arunca', () => {
    // Cazul real: poze importate inainte de plugin-ul nativ, sau importate in
    // browser. Apelantul trebuie sa spuna DE CE nu e nimic, nu sa arate o grila goala.
    const rows: EmbeddedPhoto[] = [
      { photoId: 'sursa' },
      { photoId: 'alta', imageEmbedding: vec(1, 0) }
    ];
    expect(findSimilarPhotos(rows, 'sursa')).toEqual([]);
    expect(findSimilarPhotos(rows, 'lipseste-cu-totul')).toEqual([]);
  });

  it('sare peste pozele fara embedding, fara sa se opreasca la ele', () => {
    const rows: EmbeddedPhoto[] = [
      { photoId: 'sursa', imageEmbedding: vec(1, 0) },
      { photoId: 'goala' },
      { photoId: 'vector-nul', imageEmbedding: vec(0, 0) },
      { photoId: 'buna', imageEmbedding: vec(1, 0) }
    ];
    expect(findSimilarPhotos(rows, 'sursa')).toEqual(['buna']);
  });

  it('nu intoarce mai mult decat plafonul', () => {
    const rows: EmbeddedPhoto[] = [{ photoId: 'sursa', imageEmbedding: vec(1, 0) }];
    for (let i = 0; i < SIMILAR_LIMIT + 25; i++) {
      rows.push({ photoId: `p${i}`, imageEmbedding: vec(1, i / 10000) });
    }
    expect(findSimilarPhotos(rows, 'sursa')).toHaveLength(SIMILAR_LIMIT);
  });

  it('pragul e mai permisiv decat cel de serie — altfel ar arata doar ce se vede deja grupat', () => {
    // IMAGE_EMBEDDING_MATCH_THRESHOLD din hashCompare.worker.ts e 0.75 si
    // raspunde la "acelasi cadru?". Aici intrebarea e "seamana?".
    expect(SIMILAR_THRESHOLD).toBeLessThan(0.75);
  });
});
