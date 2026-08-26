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

// Al treilea nivel de grupare: MOMENTE, nu rafale — acelasi subiect fotografiat
// de mai multe ori pe parcursul catorva minute (un pas in spate, o incercare pe
// verticala, inca o data pana se uita omul la tine). Cadrul se schimba prea mult
// pentru pragul de rafala, dar pentru cine sorteaza e tot "aceeasi poza".
describe('HashCompareService.groupPhotos — momente', () => {
  const t = Date.UTC(2026, 0, 1, 12, 0, 0);
  /** Hash la distanta 25 de zero — peste pragul de rafala (24), sub cel de moment (26). */
  const FAR = '1'.repeat(25) + '0'.repeat(39);
  const face = (seed: number) => [Array.from({ length: 8 }, (_, i) => (i === seed ? 1 : 0))];

  it('grupeaza doua cadre la minute distanta cand fata dovedeste ca e acelasi om', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t, faceEmbeddings: face(0) },
      { id: 'b', hash: FAR, score: 50, capturedAt: t + 4 * 60_000, faceEmbeddings: face(0) }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds.sort()).toEqual(['a', 'b']);
  });

  it('NU le grupeaza fara nicio dovada de subiect — timpul si dHash-ul singure nu ajung', async () => {
    // exact aceleasi poze, dar fara embedding-uri: lipsa semnalului inseamna "nu",
    // nu "presupunem ca da"
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t },
      { id: 'b', hash: FAR, score: 50, capturedAt: t + 4 * 60_000 }
    ]);
    expect(groups).toHaveLength(0);
  });

  it('NU le grupeaza cand fetele arata ca sunt oameni diferiti', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t, faceEmbeddings: face(0) },
      { id: 'b', hash: FAR, score: 50, capturedAt: t + 4 * 60_000, faceEmbeddings: face(5) }
    ]);
    expect(groups).toHaveLength(0);
  });

  it('nu intinde un moment peste fereastra lui, oricat de sigur ar fi subiectul', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t, faceEmbeddings: face(0) },
      { id: 'b', hash: FAR, score: 50, capturedAt: t + 30 * 60_000, faceEmbeddings: face(0) }
    ]);
    expect(groups).toHaveLength(0);
  });

  it('foloseste si embedding-ul de continut ca dovada, pentru cadre fara oameni', async () => {
    const emb = [1, 0, 0, 0];
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t, imageEmbedding: emb },
      { id: 'b', hash: FAR, score: 50, capturedAt: t + 5 * 60_000, imageEmbedding: emb }
    ]);
    expect(groups).toHaveLength(1);
  });

  // Bug raportat cu captura: un cadru cu fetita mergand pe alee si doua cu ea
  // asezata pe banca, in fata bisericii, ajunsesera in aceeasi serie — cu
  // "Recomandat AI" pe cel care mergea. Aceeasi fata, la minute distanta, dar
  // alt loc: o fata dovedeste CINE, nu UNDE.
  it('NU grupeaza acelasi om in doua locuri diferite, oricat de sigura ar fi fata', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'alee', hash: '0'.repeat(64), score: 92, capturedAt: t, faceEmbeddings: face(0),
        dominantColors: ['#4a7a3a', '#6d8f57', '#9fb08a'] },   // iarba, frunze
      { id: 'banca', hash: FAR, score: 58, capturedAt: t + 3 * 60_000, faceEmbeddings: face(0),
        dominantColors: ['#8a3a2a', '#c9c2b4', '#e8e2d6'] }    // banca rosie, zid alb
    ]);
    expect(groups).toHaveLength(0);
  });

  it('grupeaza acelasi om in acelasi loc — paleta apropiata nu pune veto', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'banca1', hash: '0'.repeat(64), score: 58, capturedAt: t, faceEmbeddings: face(0),
        dominantColors: ['#8a3a2a', '#c9c2b4', '#e8e2d6'] },
      { id: 'banca2', hash: FAR, score: 44, capturedAt: t + 3 * 60_000, faceEmbeddings: face(0),
        dominantColors: ['#8f4030', '#c4bdb0', '#e2dccf'] }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds.sort()).toEqual(['banca1', 'banca2']);
  });

  it('vetoul de scena nu se aplica la rafale stranse — acolo decide vizualul', async () => {
    // Distanta 10: sub pragul strans (14), acceptat neconditionat. Doua cadre
    // consecutive dintr-o rafala pot avea palete diferite (cineva imbracat in
    // rosu intra in cadru) fara sa fie alta scena.
    const near = '1'.repeat(10) + '0'.repeat(54);
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t, faceEmbeddings: face(0),
        dominantColors: ['#4a7a3a', '#6d8f57', '#9fb08a'] },
      { id: 'b', hash: near, score: 50, capturedAt: t + 2000, faceEmbeddings: face(0),
        dominantColors: ['#8a3a2a', '#c9c2b4', '#e8e2d6'] }
    ]);
    expect(groups).toHaveLength(1);
  });

  it('fara paleta salvata, se comporta ca inainte — lipsa de date nu pune veto', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, capturedAt: t, faceEmbeddings: face(0) },
      { id: 'b', hash: FAR, score: 50, capturedAt: t + 4 * 60_000, faceEmbeddings: face(0) }
    ]);
    expect(groups).toHaveLength(1);
  });

  it('nu schimba comportamentul pentru poze fara data capturii', async () => {
    const { groups } = await new HashCompareService().groupPhotos([
      { id: 'a', hash: '0'.repeat(64), score: 50, faceEmbeddings: face(0) },
      { id: 'b', hash: FAR, score: 50, faceEmbeddings: face(0) }
    ]);
    expect(groups).toHaveLength(0);
  });
});


/**
 * Bug real raportat cu captura: o poza cu o foaie scrisa si o poza cu un copil
 * si o pisica ajunsesera in aceeasi serie. Amandoua cad in acelasi bucket dHash
 * (hash-uri apropiate), dar una are fete si cealalta nu — iar exact atunci
 * niciunul dintre semnalele de subiect nu se putea compara: fetele lipsesc pe o
 * parte, embedding-ul general se calculeaza doar pentru pozele FARA fete, deci
 * lipseste pe cealalta.
 */
describe('serii: una cu oameni, alta fara', () => {
  const doc = (id: string, hash: string): HashInput => ({
    id, hash, score: 90, faceCount: 0, compositionScore: 0.2, colorHarmonyScore: 0.15
  });
  const persoana = (id: string, hash: string): HashInput => ({
    id, hash, score: 90, faceCount: 1,
    faceEmbeddings: [[1, 0, 0]],
    compositionScore: 0.75, colorHarmonyScore: 0.8
  });

  it('nu pune la un loc o poza cu oameni si una fara, chiar cand hash-urile sunt apropiate', async () => {
    const service = new HashCompareService();
    const { totalGroups } = await service.groupPhotos([
      doc('foaie', '0'.repeat(64)),
      persoana('copil', '0'.repeat(60) + '1111')
    ]);
    expect(totalGroups).toBe(0);
  });

  it('fara niciun semnal de continut, tot nu le pune impreuna daca doar una are oameni', async () => {
    const service = new HashCompareService();
    const { totalGroups } = await service.groupPhotos([
      { id: 'gol', hash: '0'.repeat(64), score: 50, faceCount: 0 },
      { id: 'cu-om', hash: '0'.repeat(62) + '11', score: 50, faceCount: 2 }
    ]);
    expect(totalGroups).toBe(0);
  });

  it('doua cadre din aceeasi rafala, amandoua fara oameni, raman impreuna', async () => {
    const service = new HashCompareService();
    const { totalGroups, groups } = await service.groupPhotos([
      doc('peisaj-1', '0'.repeat(64)),
      { ...doc('peisaj-2', '0'.repeat(62) + '11'), compositionScore: 0.22, colorHarmonyScore: 0.18 }
    ]);
    expect(totalGroups).toBe(1);
    expect(groups[0].memberIds).toHaveLength(2);
  });

  it('doua cadre cu aceeasi persoana raman impreuna', async () => {
    const service = new HashCompareService();
    const { totalGroups } = await service.groupPhotos([
      persoana('a', '0'.repeat(64)),
      persoana('b', '0'.repeat(62) + '11')
    ]);
    expect(totalGroups).toBe(1);
  });
});

describe('rafala care se indeparteaza de primul cadru', () => {
  /** Sir de 64 de biti cu primii `n` pusi pe '1' — distanta Hamming intre doua
   *  astfel de siruri e exact |n1 - n2|, deci putem construi o deriva masurata. */
  const drift = (n: number) => '1'.repeat(n) + '0'.repeat(64 - n);

  it('cinci cadre ale aceluiasi colt raman O SINGURA serie', async () => {
    // Cazul din captura: cinci poze ale aceluiasi colt de camera, la 10 secunde
    // una de alta, trei cu bifa verde. Vecinii sunt la 8 biti unul de altul, dar
    // capatul ajunge la 32 fata de inceput — cu comparatie doar fata de primul
    // cadru, ultimul cadea afara din serie si isi lua propria bifa.
    const service = new HashCompareService();
    const t = Date.parse('2026-08-24T11:00:00Z');
    const { groups } = await service.groupPhotos([0, 1, 2, 3, 4].map(i => ({
      id: `p${i}`, hash: drift(i * 8), score: 94 + i, capturedAt: t + i * 10_000
    })));

    expect(groups).toHaveLength(1);
    expect([...groups[0].memberIds].sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('deriva NU trece prin timp: aceleasi cadre la o zi distanta se rup', async () => {
    // Verificarea ca legatura ramane la fel de stricta ca inainte. Peste pragul
    // strans (14) fiecare veriga cere si apropiere in timp; la o zi distanta,
    // 16 biti intre vecini nu mai leaga nimic.
    const service = new HashCompareService();
    const t = Date.parse('2026-08-24T11:00:00Z');
    const { groups } = await service.groupPhotos([0, 1, 2].map(i => ({
      id: `z${i}`, hash: drift(i * 16), score: 90, capturedAt: t + i * 86_400_000
    })));

    expect(groups).toHaveLength(0);
  });

  it('doua scene fara nicio veriga intre ele raman doua serii', async () => {
    // Lantul nu are voie sa uneasca tot ce e in biblioteca: intre cele doua
    // grupuri sunt 40 de biti, adica nicio pereche sub prag.
    const service = new HashCompareService();
    const t = Date.parse('2026-08-24T11:00:00Z');
    const { groups } = await service.groupPhotos([
      { id: 'a0', hash: drift(0), score: 90, capturedAt: t },
      { id: 'a1', hash: drift(8), score: 91, capturedAt: t + 10_000 },
      { id: 'b0', hash: drift(48), score: 92, capturedAt: t + 20_000 },
      { id: 'b1', hash: drift(56), score: 93, capturedAt: t + 30_000 }
    ]);

    expect(groups).toHaveLength(2);
    const serii = groups.map(g => [...g.memberIds].sort().join('+')).sort();
    expect(serii).toEqual(['a0+a1', 'b0+b1']);
  });
});
