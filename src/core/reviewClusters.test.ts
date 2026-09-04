import { describe, expect, it } from 'vitest';
import { clusterReviewQueue, causeOf, worthSummarising, MIN_QUEUE_FOR_SUMMARY, type ClusterablePhoto } from './reviewClusters';
import { DEFECT_SHARPNESS, DEFECT_EYES_OPEN_RATIO, hasNoRecognizableSubject } from './importPipeline';

/**
 * core/reviewClusters.test.ts
 * Rezumatul cozii de verificat, pe cauze.
 *
 * Ce se poate strica aici nu da nicio eroare: rezumatul spune pur si simplu
 * altceva decat contine coada. Si e cel mai prost fel de bug pentru functia
 * asta — tot rostul ei e sa fie CREZUTA dintr-o privire, ca sa nu mai deschizi
 * pozele una cate una.
 */
/**
 * Poza implicita e una OBISNUITA: fara defect, dar cu un subiect recunoscut
 * (`sceneTags: ['dog']`). Eticheta nu e decor — fara ea, poza ar cadea in cauza
 * `noSubject`, iar testele de mai jos care verifica "fara defect => other" ar
 * masura altceva decat cred ca masoara.
 */
function poza(over: Partial<ClusterablePhoto> & { id: string }): ClusterablePhoto {
  return { sharpness: 80, exposure: 55, faceCount: 0, allEyesOpen: true, sceneTags: ['dog'], ...over };
}

describe('cauza dominanta', () => {
  const fara = new Set<string>();

  it('foloseste EXACT pragul motorului pentru claritate', () => {
    // Poza care intra in "neclare" trebuie sa fie exact poza pentru care bara de
    // claritate se face rosie in panoul de metrici. Doua praguri ar insemna
    // doua pareri in aceeasi aplicatie.
    expect(causeOf(poza({ id: 'a', sharpness: DEFECT_SHARPNESS - 0.01 }), fara)).toBe('blurry');
    expect(causeOf(poza({ id: 'b', sharpness: DEFECT_SHARPNESS }), fara)).toBe('other');
  });

  it('foloseste EXACT pragul motorului pentru ochi, la grup', () => {
    const sub = poza({ id: 'a', faceCount: 3, groupEyesOpenRatio: DEFECT_EYES_OPEN_RATIO - 0.01 });
    const peste = poza({ id: 'b', faceCount: 3, groupEyesOpenRatio: DEFECT_EYES_OPEN_RATIO });
    expect(causeOf(sub, fara)).toBe('eyesClosed');
    expect(causeOf(peste, fara)).toBe('other');
  });

  it('nu acuza ochii inchisi intr-o poza fara oameni', () => {
    // `allEyesOpen: false` pe un peisaj nu inseamna nimic — n-are cine sa clipeasca.
    expect(causeOf(poza({ id: 'a', faceCount: 0, allEyesOpen: false }), fara)).toBe('other');
  });

  it('miscarea bate ochii inchisi — fizica a decis deja', () => {
    // O poza miscata nu se repara nicicum; ce altceva ar fi in neregula la ea
    // e irelevant pentru decizie.
    const amandoua = poza({ id: 'a', sharpness: 10, faceCount: 2, allEyesOpen: false });
    expect(causeOf(amandoua, fara)).toBe('blurry');
  });

  it('defectele bat seria — o serie de cadre miscate nu e o alegere', () => {
    const inSerie = poza({ id: 'a', sharpness: 10, groupId: 'g1' });
    expect(causeOf(inSerie, new Set(['g1']))).toBe('blurry');
  });

  it('expunerea conteaza doar cand chiar se pierde informatie', () => {
    expect(causeOf(poza({ id: 'a', highlightClipping: 0.5 }), fara)).toBe('exposure');
    expect(causeOf(poza({ id: 'b', shadowClipping: 0.5 }), fara)).toBe('exposure');
    // O poza doar inchisa la ton, fara zone infundate, se repara din editare.
    expect(causeOf(poza({ id: 'c', exposure: 20, highlightClipping: 0.01 }), fara)).toBe('other');
  });
});

describe('clusterReviewQueue', () => {
  it('suma grupurilor e EXACT numarul de poze — un rezumat trebuie sa se adune', () => {
    // Daca o poza ar aparea in doua grupuri, "30 neclare + 12 cu ochii inchisi"
    // din 35 de poze ar fi o propozitie in care nimeni n-ar mai avea incredere.
    const coada = [
      poza({ id: '1', sharpness: 10 }),
      poza({ id: '2', sharpness: 10, faceCount: 2, allEyesOpen: false }),
      poza({ id: '3', faceCount: 2, allEyesOpen: false }),
      poza({ id: '4', groupId: 'g' }), poza({ id: '5', groupId: 'g' }),
      poza({ id: '6', highlightClipping: 0.9 }),
      poza({ id: '7' })
    ];
    const grupuri = clusterReviewQueue(coada);
    expect(grupuri.reduce((n, g) => n + g.photoIds.length, 0)).toBe(coada.length);
    const toate = grupuri.flatMap(g => g.photoIds);
    expect(new Set(toate).size).toBe(coada.length);
  });

  it('cel mai mare grup vine primul — acolo e cea mai mare economie de gesturi', () => {
    const coada = [
      poza({ id: '1' }), poza({ id: '2' }), poza({ id: '3' }),
      poza({ id: '4', sharpness: 10 })
    ];
    expect(clusterReviewQueue(coada)[0].cause).toBe('other');
    expect(clusterReviewQueue(coada)[0].photoIds).toHaveLength(3);
  });

  it('o poza singura cu eticheta de serie NU e o serie', () => {
    // Nu e o alegere de facut: e doar o poza care se intampla sa aiba un groupId.
    const grupuri = clusterReviewQueue([poza({ id: '1', groupId: 'g' }), poza({ id: '2' })]);
    expect(grupuri.map(g => g.cause)).toEqual(['other']);
  });

  it('doua cadre din aceeasi serie chiar formeaza un grup de ales', () => {
    const grupuri = clusterReviewQueue([poza({ id: '1', groupId: 'g' }), poza({ id: '2', groupId: 'g' })]);
    expect(grupuri).toEqual([{ cause: 'series', photoIds: ['1', '2'] }]);
  });

  it('o coada goala da o lista goala, nu grupuri goale', () => {
    expect(clusterReviewQueue([])).toEqual([]);
  });
});

describe('worthSummarising — cand rezumatul chiar spune ceva', () => {
  it('tace pe o coada scurta', () => {
    const scurta = clusterReviewQueue(
      Array.from({ length: MIN_QUEUE_FOR_SUMMARY - 1 }, (_, i) => poza({ id: `${i}`, sharpness: i % 2 ? 10 : 80 }))
    );
    expect(worthSummarising(scurta)).toBe(false);
  });

  it('tace cand totul cade intr-un singur grup', () => {
    // "47 de verificat, toate 47 neclare" e aceeasi informatie ca "47 de
    // verificat", spusa cu mai multe cuvinte.
    const unSingurGrup = clusterReviewQueue(
      Array.from({ length: 20 }, (_, i) => poza({ id: `${i}`, sharpness: 10 }))
    );
    expect(unSingurGrup).toHaveLength(1);
    expect(worthSummarising(unSingurGrup)).toBe(false);
  });

  it('vorbeste cand coada e lunga SI amestecata', () => {
    const amestec = clusterReviewQueue(
      Array.from({ length: 20 }, (_, i) => poza({ id: `${i}`, sharpness: i % 3 ? 80 : 10 }))
    );
    expect(worthSummarising(amestec)).toBe(true);
  });
});

/**
 * Grupul `noSubject` — vezi hasNoRecognizableSubject in core/importPipeline.ts.
 *
 * E singurul grup din rezumat care nu descrie un defect al POZEI, ci o limita a
 * motorului: n-a recunoscut niciun subiect, deci n-a avut voie sa aprobe
 * singur, oricat de mare i-ar fi fost scorul. Pe web asta se intampla des —
 * detectorul de obiecte are vocabular COCO-80, fara clase pentru munte, cer,
 * floare sau apus — asa ca grupul poate fi mare, si tocmai de-aia trebuie
 * NUMIT: nenumit, ar fi fost cel mai gros teanc din "la limita, fara un defect
 * anume", adica exact intrebarea fara raspuns pe care rezumatul o inchide.
 */
describe('grupul "fara subiect recunoscut"', () => {
  const fara = new Set<string>();

  it('un peisaj fara fete si fara etichete cade aici, nu in "other"', () => {
    expect(causeOf(poza({ id: 'a', sceneTags: undefined }), fara)).toBe('noSubject');
  });

  it('etichetele abstracte NU trec drept subiect — acelasi verdict ca motorul', () => {
    // "pattern"/"texture" sunt in NON_FOLDER_SCENE_TAGS: motorul nu le
    // considera subiect, deci nici rezumatul nu are voie.
    expect(causeOf(poza({ id: 'a', sceneTags: ['pattern', 'texture'] }), fara)).toBe('noSubject');
  });

  it('o fata e de ajuns, chiar fara nicio eticheta', () => {
    expect(causeOf(poza({ id: 'a', faceCount: 1, sceneTags: undefined }), fara)).toBe('other');
  });

  it('vine DUPA defectele reale: o poza si miscata, si nerecunoscuta, e miscata', () => {
    expect(causeOf(poza({ id: 'a', sharpness: 10, sceneTags: undefined }), fara)).toBe('blurry');
  });

  it('numara exact pozele pe care le-a oprit motorul', () => {
    // Aceeasi conditie, importata din motor, nu rescrisa aici: daca cele doua
    // ar diverge vreodata, rezumatul ar promite o cifra si ar livra alta.
    const p = poza({ id: 'a', sceneTags: undefined });
    expect(hasNoRecognizableSubject(p)).toBe(true);
    expect(causeOf(p, fara)).toBe('noSubject');
  });
});
