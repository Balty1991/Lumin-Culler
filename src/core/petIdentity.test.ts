import { describe, expect, it } from 'vitest';
import {
  PET_CENTER_CROP, PET_CLUSTER_SIMILARITY, choosePetCrop, findUnnamedPetClusters,
  isAnimalTag, matchNamedPet, primaryAnimalLabel
} from './petIdentity';

function unit(x: number): number[] {
  const y = Math.sqrt(Math.max(0, 1 - x * x));
  return [x, y];
}

describe('choosePetCrop', () => {
  it('fără cutii, decupează centrul, nu tot cadrul', () => {
    expect(choosePetCrop([])).toEqual(PET_CENTER_CROP);
  });

  it('preferă cutia etichetată ca animal, nu pe cea mai mare din scenă', () => {
    const crop = choosePetCrop([
      { x: 0, y: 0, w: 0.9, h: 0.9, label: 'Home good' },
      { x: 0.4, y: 0.4, w: 0.2, h: 0.25, label: 'Dog' }
    ]);
    expect(crop.x).toBeGreaterThan(0.3);
    expect(crop.w).toBeLessThan(0.5);
  });

  it('fără etichetă de animal, ia cutia cea mai mare', () => {
    const crop = choosePetCrop([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'Fashion good' },
      { x: 0.2, y: 0.15, w: 0.5, h: 0.6, label: 'Home good' }
    ]);
    expect(crop.w).toBeGreaterThan(0.4);
  });
});

describe('findUnnamedPetClusters', () => {
  it('unește același animal peste prag și ține despărțit unul doar asemănător', () => {
    const same = unit(0.97);
    const similar = unit(0.90);
    expect(PET_CLUSTER_SIMILARITY).toBe(0.93);
    const clusters = findUnnamedPetClusters([
      { id: 'a', petLabel: 'dog', petEmbedding: [1, 0] },
      { id: 'b', petLabel: 'dog', petEmbedding: same },
      { id: 'c', petLabel: 'dog', petEmbedding: similar }
    ]);
    expect(clusters[0].members.map(m => m.photoId)).toEqual(['a', 'b']);
    expect(clusters[1].members.map(m => m.photoId)).toEqual(['c']);
  });

  it('nu amestecă un câine cu o pisică, chiar la embedding identic', () => {
    const clusters = findUnnamedPetClusters([
      { id: 'dog', petLabel: 'dog', petEmbedding: [1, 0, 0] },
      { id: 'cat', petLabel: 'cat', petEmbedding: [1, 0, 0] }
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('un animal deja numit nu mai intră la Numește', () => {
    expect(findUnnamedPetClusters([
      { id: 'rex', petLabel: 'dog', petName: 'Rex', petEmbedding: [1, 0] }
    ])).toEqual([]);
  });

  it('„hot dog” nu e un animal', () => {
    expect(isAnimalTag('hot dog')).toBe(false);
    expect(primaryAnimalLabel(['Hot dog', 'Dog'])).toBe('dog');
  });
});

describe('matchNamedPet', () => {
  it('pune numele doar peste prag', () => {
    expect(matchNamedPet(unit(0.97), [{ name: 'Rex', embedding: [1, 0] }])).toBe('Rex');
    expect(matchNamedPet(unit(0.90), [{ name: 'Rex', embedding: [1, 0] }])).toBeNull();
  });
});
