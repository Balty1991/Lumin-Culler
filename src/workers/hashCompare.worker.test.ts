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
    // 'x' devine seed-ul primului grup, 'y' al doilea (distanta 20 fata de 'x' —
    // peste prag, deci bucket separat) — 'z' e la distanta 10 fata de AMBELE
    // seed-uri (sub prag), deci trebuie sa se alature primului bucket creat ('x').
    const seedX = '0'.repeat(64);
    const seedY = '1'.repeat(20) + '0'.repeat(44);
    const z = '1'.repeat(10) + '0'.repeat(54);

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

  it('desparte un bucket dHash fals-pozitiv cand embedding-urile faciale arata subiecti diferiti, dar pastreaza AMBELE componente ca grupuri reale', async () => {
    const service = new HashCompareService();
    // Toate 4 sunt suficient de apropiate structural (dHash) ca sa cada in
    // acelasi bucket, dar 'a'/'b' au fata subiectului X, iar 'c'/'d' au fata
    // subiectului Y (embedding ortogonal) — un fals-pozitiv clasic (aceeasi
    // compozitie de cadru, oameni diferiti). Ambele perechi raman totusi
    // rafale reale in sine — nu doar componenta cea mai mare (bug real
    // raportat: componenta mai mica ramanea "negrupata", deci nesupravegheata).
    const faceX = [1, 0, 0, 0];
    const faceY = [0, 1, 0, 0];
    const photos: HashInput[] = [
      { ...photo('a', '0'.repeat(64)), faceEmbeddings: [faceX] },
      { ...photo('b', '0'.repeat(63) + '1'), faceEmbeddings: [faceX] },
      { ...photo('c', '0'.repeat(62) + '11'), faceEmbeddings: [faceY] },
      { ...photo('d', '0'.repeat(61) + '111'), faceEmbeddings: [faceY] }
    ];

    const { groups, totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(2);
    const groupsByMember = new Map(groups.flatMap(g => g.memberIds.map(id => [id, g.groupId])));
    expect(groupsByMember.get('a')).toBe(groupsByMember.get('b'));
    expect(groupsByMember.get('c')).toBe(groupsByMember.get('d'));
    expect(groupsByMember.get('a')).not.toBe(groupsByMember.get('c'));
  });

  it('nu desparte un bucket cand fetele detectate se potrivesc (acelasi subiect, unghiuri usor diferite)', async () => {
    const service = new HashCompareService();
    const face = [1, 0, 0, 0];
    const faceSlightlyDifferentAngle = [0.9, 0.436, 0, 0]; // cos similarity ~0.9, peste prag
    const photos: HashInput[] = [
      { ...photo('a', '0'.repeat(64)), faceEmbeddings: [face] },
      { ...photo('b', '0'.repeat(63) + '1'), faceEmbeddings: [faceSlightlyDifferentAngle] }
    ];

    const { groups, totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(1);
    expect(groups[0].memberIds.sort()).toEqual(['a', 'b']);
  });

  it('nu desparte un bucket fara fete detectate, chiar daca lipsesc compositionScore/colorHarmonyScore (comportament neschimbat)', async () => {
    const service = new HashCompareService();
    const photos: HashInput[] = [photo('a', '0'.repeat(64)), photo('b', '0'.repeat(63) + '1')];

    const { totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(1);
  });

  it('desparte un bucket fara fete cand compozitia SI armonia culorilor diverg puternic, dar pastreaza AMBELE componente ca grupuri reale', async () => {
    const service = new HashCompareService();
    const photos: HashInput[] = [
      { ...photo('a', '0'.repeat(64)), compositionScore: 0.9, colorHarmonyScore: 0.9 },
      { ...photo('b', '0'.repeat(63) + '1'), compositionScore: 0.9, colorHarmonyScore: 0.9 },
      { ...photo('c', '0'.repeat(62) + '11'), compositionScore: 0.1, colorHarmonyScore: 0.1 },
      { ...photo('d', '0'.repeat(61) + '111'), compositionScore: 0.1, colorHarmonyScore: 0.1 }
    ];

    const { groups, totalGroups } = await service.groupPhotos(photos);

    expect(totalGroups).toBe(2);
    const groupsByMember = new Map(groups.flatMap(g => g.memberIds.map(id => [id, g.groupId])));
    expect(groupsByMember.get('a')).toBe(groupsByMember.get('b'));
    expect(groupsByMember.get('c')).toBe(groupsByMember.get('d'));
    expect(groupsByMember.get('a')).not.toBe(groupsByMember.get('c'));
  });

  // imageEmbedding (ImageEmbedder general, Android nativ) — "a doua opinie"
  // pentru rafale FARA fete (peisaje, animale), unde inainte singurul semnal
  // de rafinare era compozitie+armonie culori, mult mai slab.
  describe('imageEmbedding (rafale fara fete)', () => {
    it('desparte un bucket dHash fals-pozitiv cand embedding-ul general arata continut diferit, dar pastreaza AMBELE componente ca grupuri reale', async () => {
      const service = new HashCompareService();
      const contentX = [1, 0, 0, 0];
      const contentY = [0, 1, 0, 0];
      const photos: HashInput[] = [
        { ...photo('a', '0'.repeat(64)), imageEmbedding: contentX },
        { ...photo('b', '0'.repeat(63) + '1'), imageEmbedding: contentX },
        { ...photo('c', '0'.repeat(62) + '11'), imageEmbedding: contentY },
        { ...photo('d', '0'.repeat(61) + '111'), imageEmbedding: contentY }
      ];

      const { groups, totalGroups } = await service.groupPhotos(photos);

      expect(totalGroups).toBe(2);
      const groupsByMember = new Map(groups.flatMap(g => g.memberIds.map(id => [id, g.groupId])));
      expect(groupsByMember.get('a')).toBe(groupsByMember.get('b'));
      expect(groupsByMember.get('c')).toBe(groupsByMember.get('d'));
      expect(groupsByMember.get('a')).not.toBe(groupsByMember.get('c'));
    });

    it('nu desparte un bucket cand embedding-urile generale se potrivesc (acelasi peisaj, cadre usor diferite)', async () => {
      const service = new HashCompareService();
      const content = [1, 0, 0, 0];
      const contentSlightlyDifferent = [0.9, 0.436, 0, 0]; // cos similarity ~0.9, peste prag
      const photos: HashInput[] = [
        { ...photo('a', '0'.repeat(64)), imageEmbedding: content },
        { ...photo('b', '0'.repeat(63) + '1'), imageEmbedding: contentSlightlyDifferent }
      ];

      const { groups, totalGroups } = await service.groupPhotos(photos);

      expect(totalGroups).toBe(1);
      expect(groups[0].memberIds.sort()).toEqual(['a', 'b']);
    });

    it('foloseste embedding-ul general in locul (nu impreuna cu) compozitie/armonie-culori cand ambele exista', async () => {
      const service = new HashCompareService();
      const content = [1, 0, 0, 0];
      // compozitie/armonie diverg puternic (ar desparti bucket-ul dupa vechiul
      // fallback), dar embedding-ul general e IDENTIC — trebuie sa ramana grupate.
      const photos: HashInput[] = [
        { ...photo('a', '0'.repeat(64)), imageEmbedding: content, compositionScore: 0.9, colorHarmonyScore: 0.9 },
        { ...photo('b', '0'.repeat(63) + '1'), imageEmbedding: content, compositionScore: 0.1, colorHarmonyScore: 0.1 }
      ];

      const { totalGroups } = await service.groupPhotos(photos);

      expect(totalGroups).toBe(1);
    });
  });
});

// Bug raportat cu captura: o serie evidenta (aceeasi scena, cadre consecutive,
// incadrare usor diferita) nu era grupata deloc, pentru ca dHash-ul sarea de
// pragul strans. Vezi TIME_CLOSE_SIMILARITY_THRESHOLD in hashCompare.worker.ts.
describe('serii prinse dupa apropierea in timp', () => {
  /** Distanta 18: peste pragul strans (14), sub cel relaxat (24). */
  const nearHash = '0'.repeat(46) + '1'.repeat(18);

  it('grupeaza doua cadre asemanatoare facute la cateva secunde unul de altul', async () => {
    const t = Date.now();
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t },
      { id: 'b', hash: nearHash, score: 50, capturedAt: t + 8_000 }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual(['a', 'b']);
  });

  it('NU le grupeaza daca sunt facute la ore distanta — asemanarea singura nu ajunge', async () => {
    const t = Date.now();
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t },
      { id: 'b', hash: nearHash, score: 50, capturedAt: t + 3 * 60 * 60 * 1000 }
    ]);
    expect(groups).toHaveLength(0);
  });

  it('NU le grupeaza cand lipsesc datele de captura (nu putem afirma nimic despre timp)', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50 },
      { id: 'b', hash: nearHash, score: 50 }
    ]);
    expect(groups).toHaveLength(0);
  });

  it('pragul strans ramane valabil singur, oricat de departate in timp ar fi pozele', async () => {
    const t = Date.now();
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t },
      { id: 'b', hash: '0'.repeat(63) + '1', score: 50, capturedAt: t + 30 * 24 * 3600 * 1000 }
    ]);
    expect(groups).toHaveLength(1);
  });
});
