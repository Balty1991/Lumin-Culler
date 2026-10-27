import { describe, expect, it } from 'vitest';
import { albumFolderName, buildAlbums, eventTitle, type AlbumPhoto } from './albums';

function photo(overrides: Partial<AlbumPhoto> & Pick<AlbumPhoto, 'id'>): AlbumPhoto {
  return {
    fileName: `${overrides.id}.jpg`,
    status: 'review',
    aiScore: 50,
    faceCount: 0,
    personNames: [],
    ...overrides
  };
}

const day = 24 * 60 * 60 * 1000;

describe('buildAlbums', () => {
  it('grupează persoanele după nume și lasă fețele fără nume deoparte', () => {
    const albums = buildAlbums([
      photo({ id: 'a', faceCount: 1, personNames: ['Ana'], status: 'selected' }),
      photo({ id: 'b', faceCount: 1, personNames: ['Ana', 'Mama'] }),
      photo({ id: 'c', faceCount: 2, personNames: [] })
    ]);
    expect(albums.people.map(p => p.name)).toEqual(['Ana', 'Mama']);
    expect(albums.people[0].photoIds).toEqual(['a', 'b']);
    expect(albums.people[0].selectedIds).toEqual(['a']);
    expect(albums.unnamedPhotoIds).toEqual(['c']);
  });

  it('ține același câine împreună și lasă unul doar asemănător de numit separat', () => {
    const same = [0.97, Math.sqrt(1 - 0.97 * 0.97)];
    const similar = [0.9, Math.sqrt(1 - 0.81)];
    const albums = buildAlbums([
      photo({ id: 'a', sceneTags: ['Dog'], petLabel: 'dog', petEmbedding: [1, 0] }),
      photo({ id: 'b', sceneTags: ['dog'], petLabel: 'dog', petEmbedding: same }),
      photo({ id: 'c', sceneTags: ['dog'], petLabel: 'dog', petEmbedding: similar }),
      photo({ id: 'named', sceneTags: ['dog'], petLabel: 'dog', petName: 'Rex', petEmbedding: [1, 0] })
    ]);
    expect(albums.animals[0].label).toBe('dog');
    expect(albums.animals[0].photoIds).toEqual(['a', 'b', 'c', 'named']);
    expect(albums.namedPets.map(p => p.name)).toEqual(['Rex']);
    expect(albums.unnamedPets[0].photoIds).toEqual(['a', 'b']);
    expect(albums.unnamedPets[1].photoIds).toEqual(['c']);
  });

  it('pune câinele la animale, din eticheta ML Kit, nu dintr-un folder', () => {
    const albums = buildAlbums([
      photo({ id: 'rex', sceneTags: ['Dog', 'Grass'], capturedAt: 10 }),
      photo({ id: 'rex2', sceneTags: ['Dog', 'Pet'], capturedAt: 11 }),
      photo({ id: 'rex3', sceneTags: ['Pet'], capturedAt: 12 }),
      photo({ id: 'hot', sceneTags: ['Hot dog'] })
    ]);
    expect(albums.animals).toHaveLength(1);
    expect(albums.animals[0].label).toBe('dog');
    expect(albums.animals[0].photoIds).toEqual(['rex', 'rex2', 'rex3']);
  });

  it('o poză intră într-un singur album de animal, iar o etichetă rătăcită nu face album', () => {
    const albums = buildAlbums([
      photo({ id: 'c1', sceneTags: ['Cat', 'Pet', 'Dog'] }),
      photo({ id: 'c2', sceneTags: ['Cat', 'Pet'] }),
      photo({ id: 'c3', sceneTags: ['Cat'] }),
      photo({ id: 'girl', sceneTags: ['Horse'] })
    ]);
    expect(albums.animals.map(a => a.label)).toEqual(['cat']);
    expect(albums.animals[0].photoIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('desparte evenimentele la o pauză lungă și la un salt de loc', () => {
    const albums = buildAlbums([
      photo({ id: 'a', capturedAt: 0, gpsLatitude: 44.4, gpsLongitude: 26.1 }),
      photo({ id: 'b', capturedAt: 30 * 60 * 1000, gpsLatitude: 44.4, gpsLongitude: 26.1, status: 'selected' }),
      photo({ id: 'c', capturedAt: 2 * 60 * 60 * 1000, gpsLatitude: 46.7, gpsLongitude: 23.6 }),
      photo({ id: 'a2', capturedAt: 60 * 60 * 1000, gpsLatitude: 44.4, gpsLongitude: 26.1 }),
      photo({ id: 'c2', capturedAt: 2.2 * 60 * 60 * 1000, gpsLatitude: 46.7, gpsLongitude: 23.6 }),
      photo({ id: 'c3', capturedAt: 2.4 * 60 * 60 * 1000, gpsLatitude: 46.7, gpsLongitude: 23.6 }),
      photo({ id: 'd', capturedAt: 10 * day })
    ]);
    // „d” e singură în ziua ei: nu e eveniment.
    expect(albums.events).toHaveLength(2);
    expect(albums.events[0].photoIds).toEqual(['c', 'c2', 'c3']);
    expect(albums.events[1].photoIds).toEqual(['a', 'b', 'a2']);
    expect(albums.events[1].selectedCount).toBe(1);
  });

  it('ține capturile și documentele în Altele, nu în evenimente', () => {
    const albums = buildAlbums([
      photo({ id: 's', fileName: 'Screenshot_2026.png', capturedAt: 5, faceCount: 0 }),
      photo({ id: 'd', fileName: 'factura.jpg', capturedAt: 6, textCoverage: 0.4, faceCount: 0 }),
      photo({ id: 'p', fileName: 'copil.jpg', capturedAt: 7, faceCount: 1, personNames: ['Ana'] }),
      photo({ id: 'p2', fileName: 'copil2.jpg', capturedAt: 8, faceCount: 1, personNames: ['Ana'] }),
      photo({ id: 'p3', fileName: 'copil3.jpg', capturedAt: 9, faceCount: 1, personNames: ['Ana'] })
    ]);
    expect(albums.screenshots).toEqual(['s']);
    expect(albums.documents).toEqual(['d']);
    expect(albums.events.flatMap(e => e.photoIds)).toEqual(['p', 'p2', 'p3']);
  });

  it('numără dublurile dintr-o serie, fără să le scoată din galerie', () => {
    const albums = buildAlbums([
      photo({ id: 'a', personNames: ['Ana'], faceCount: 1, groupId: 'g', status: 'selected', aiScore: 80 }),
      photo({ id: 'b', personNames: ['Ana'], faceCount: 1, groupId: 'g', status: 'review', aiScore: 40 }),
      photo({ id: 'c', personNames: ['Ana'], faceCount: 1, groupId: 'g', status: 'rejected', aiScore: 20 })
    ]);
    expect(albums.people[0].seriesCount).toBe(1);
    expect(albums.people[0].duplicateCount).toBe(1);
  });
});

describe('eventTitle', () => {
  it('scrie ziua când ieșirea e într-o singură zi', () => {
    const start = Date.UTC(2026, 9, 12, 10);
    expect(eventTitle(start, start + 60_000, 'ro')).toMatch(/12/);
    expect(eventTitle(start, start + 60_000, 'ro').toLowerCase()).toMatch(/oct/);
  });
});

describe('albumFolderName', () => {
  it('nu lasă o cale să iasă din nume', () => {
    expect(albumFolderName('Ana/../../etc')).toBe('Ana .. .. etc');
    expect(albumFolderName('   ')).toBe('Album');
  });
});
