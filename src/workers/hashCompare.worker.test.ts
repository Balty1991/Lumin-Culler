import { describe, expect, it } from 'vitest';
import { HashCompareService, type HashInput } from './hashCompare.worker';

/**
 * Verifica faptul ca inlocuirea scanarii liniare (Array.prototype.find) cu
 * BK-tree in groupPhotos() nu a schimbat comportamentul de grupare — acelasi
 * motiv pentru care bkTree.test.ts face un cross-check brute-force separat,
 * dar aici la nivelul serviciului complet folosit efectiv de importPipeline.
 */
function photo(id: string, hash: string, score = 50): HashInput {
  return { id, hash, score };
}

describe('HashCompareService.groupPhotos', () => {
  it('grupeaza poze cu dHash apropiat (sub prag) si lasa negrupate pozele izolate', async () => {
    const service = new HashCompareService();
    const photos: HashInput[] = [
      photo('a', '0'.repeat(64)),
      photo('b', '0'.repeat(63) + '1'), // distanta 1 fata de 'a' — aceeasi serie
      photo('c', '1'.repeat(64)), // distanta 64 fata de 'a' — izolata (alta poza)
      photo('d', '1'.repeat(63) + '0') // distanta 1 fata de 'c' — a doua serie
    ];

    const { groups, totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(2);
    const groupsByMember = new Map(groups.flatMap(g => g.memberIds.map(id => [id, g.groupId])));
    expect(groupsByMember.get('a')).toBe(groupsByMember.get('b'));
    expect(groupsByMember.get('c')).toBe(groupsByMember.get('d'));
    expect(groupsByMember.get('a')).not.toBe(groupsByMember.get('c'));
  });

  it('nu grupeaza o poza fara nicio alta similara (ramane fara groupId)', async () => {
    const service = new HashCompareService();
    const photos: HashInput[] = [photo('solo', '0'.repeat(64))];

    const { groups, totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(0);
    expect(groups).toEqual([]);
  });

  it('alege primul bucket creat cand o poza e la distanta buna de mai multe grupuri existente (tie-break identic cu varianta liniara)', async () => {
    const service = new HashCompareService();
    // 'x' devine seed-ul primului grup, 'y' al doilea (distanta 10 fata de 'x' —
    // peste prag, deci bucket separat) — 'z' e la distanta 5 fata de AMBELE
    // seed-uri (sub prag), deci trebuie sa se alature primului bucket creat ('x').
    const seedX = '0'.repeat(64);
    const seedY = '1'.repeat(10) + '0'.repeat(54);
    const z = '1'.repeat(5) + '0'.repeat(59);

    const photos: HashInput[] = [photo('x', seedX), photo('y', seedY), photo('z', z)];
    const { groups, totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(1); // 'y' ramane singura in bucketul ei (nu se aduna nimeni), deci fara grup
    const group = groups[0];
    expect(group.memberIds.sort()).toEqual(['x', 'z']);
  });

  it('preserva onUpdate callback pentru fiecare membru al unui grup', async () => {
    const service = new HashCompareService();
    const photos: HashInput[] = [photo('a', '0'.repeat(64)), photo('b', '0'.repeat(63) + '1')];
    const updates: { photoId: string; groupId: string }[] = [];

    await service.groupPhotos(photos, u => updates.push(u));

    expect(updates).toHaveLength(2);
    expect(new Set(updates.map(u => u.photoId))).toEqual(new Set(['a', 'b']));
    expect(updates[0].groupId).toBe(updates[1].groupId);
  });
});
