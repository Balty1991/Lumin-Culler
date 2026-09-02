import { describe, expect, it } from 'vitest';
import { previewStrictness, previewAllStrictness, STRICTNESS_LEVELS } from './strictnessPreview';
import { FIXED_THRESHOLDS, applyStrictness } from './scoreThresholds';
import { decidePhotoStatus } from './importPipeline';
import type { PhotoView } from '../state/store';

/**
 * core/strictnessPreview.test.ts
 * Cifrele pe care le arata bara de pe ecranul principal.
 *
 * Invariantul care conteaza: previzualizarea trebuie sa dea EXACT ce va face
 * aplicatia cand apesi. O previzualizare aproape corecta e mai rea decat
 * niciuna — promite o cifra si livreaza alta, si utilizatorul nu mai are motiv
 * sa creada nici restul ecranului. De-aia testul de mai jos nu compara cu
 * numere scrise de mana, ci cu `decidePhotoStatus`, adica exact functia pe care
 * o va rula motorul.
 */
function poza(over: Partial<PhotoView> & { id: string; aiScore: number }): PhotoView {
  return {
    fileName: `${over.id}.jpg`, importedAt: 0, status: 'review', rating: 0,
    sceneType: 'portrait', contextKey: 'portrait:known',
    faceCount: 1, knownFaceCount: 1, strangerCount: 0, personNames: [],
    allEyesOpen: true, sharpness: 80, exposure: 50, bestSmile: 0.5,
    subjectInFocus: true, edits: {}, colorLabel: 'none',
    ...over
  } as unknown as PhotoView;
}

/** Un set cu scoruri raspandite peste toate pragurile interesante. */
const LOT = [20, 30, 40, 52, 58, 60, 64, 66, 70, 74, 80, 92].map((n, i) =>
  poza({ id: `p${i}`, aiScore: n, sharpness: n < 40 ? 10 : 80 })
);

describe('previewStrictness', () => {
  it('da exact acelasi raspuns ca motorul, pentru fiecare treapta', () => {
    for (const level of STRICTNESS_LEVELS) {
      const praguri = applyStrictness(FIXED_THRESHOLDS, level);
      const asteptat = { kept: 0, rejected: 0, review: 0 };
      for (const p of LOT) {
        const s = decidePhotoStatus(p.aiScore, p, praguri);
        if (s === 'selected') asteptat.kept++;
        else if (s === 'rejected') asteptat.rejected++;
        else asteptat.review++;
      }
      const real = previewStrictness(LOT, FIXED_THRESHOLDS, level);
      expect({ kept: real.kept, rejected: real.rejected, review: real.review }, level).toEqual(asteptat);
    }
  });

  it('cele trei numere acopera toate pozele nedecise, fara sa se suprapuna', () => {
    for (const o of previewAllStrictness(LOT, FIXED_THRESHOLDS)) {
      expect(o.kept + o.rejected + o.review, o.strictness).toBe(LOT.length);
    }
  });

  it('mai ingaduitor inseamna mai multe pastrate — altfel eticheta ar minti', () => {
    const [lax, bal, strict] = previewAllStrictness(LOT, FIXED_THRESHOLDS);
    expect(lax.kept).toBeGreaterThanOrEqual(bal.kept);
    expect(bal.kept).toBeGreaterThanOrEqual(strict.kept);
    expect(strict.rejected).toBeGreaterThanOrEqual(bal.rejected);
  });

  it('NU numara pozele pe care le-ai decis tu — severitatea nu le atinge', () => {
    // Aceeasi regula ca in store.setCullingStrictness. Daca ar fi numarate,
    // bara ar promite schimbari care nu se vor intampla niciodata.
    const cuDecizii = [
      ...LOT,
      poza({ id: 'ales', aiScore: 10, status: 'selected' }),
      poza({ id: 'respins', aiScore: 99, status: 'rejected' }),
      poza({ id: 'candidat', aiScore: 50, status: 'candidate' })
    ];
    for (const o of previewAllStrictness(cuDecizii, FIXED_THRESHOLDS)) {
      expect(o.kept + o.rejected + o.review, o.strictness).toBe(LOT.length);
    }
  });

  it('nu se atinge de teancul deja etichetat, nici dupa ce motorul l-a etichetat el', () => {
    // Miezul deciziei de design: statusul `selected`/`rejected` nu spune daca a
    // ajuns acolo prin decizia ta sau prin propunerea motorului — nu exista un
    // asemenea camp. Deci severitatea lucreaza DOAR pe teancul de verificat, si
    // previzualizarea trebuie sa numere exact la fel. Altfel bara ar arata "3
    // pastrate" langa o biblioteca care afiseaza 5, si niciuna n-ar fi gresita.
    const praguri = applyStrictness(FIXED_THRESHOLDS, 'balanced');
    const dupaImport = LOT.map(p => ({ ...p, status: decidePhotoStatus(p.aiScore, p, praguri) }));
    const inca = dupaImport.filter(p => p.status === 'review').length;
    for (const o of previewAllStrictness(dupaImport, FIXED_THRESHOLDS)) {
      expect(o.kept + o.rejected + o.review, o.strictness).toBe(inca);
    }
  });

  it('"changed" numara cate poze din teancul de verificat s-ar muta', () => {
    const praguri = applyStrictness(FIXED_THRESHOLDS, 'balanced');
    const dupaImport = LOT.map(p => ({ ...p, status: decidePhotoStatus(p.aiScore, p, praguri) }));
    // Pe treapta pe care esti deja, nimic nu se muta — deci cifra care spune
    // "merita apasat" trebuie sa fie 0.
    expect(previewStrictness(dupaImport, FIXED_THRESHOLDS, 'balanced').changed).toBe(0);
    // Mai ingaduitor scoate poze din teanc (le aproba), deci ceva se misca.
    expect(previewStrictness(dupaImport, FIXED_THRESHOLDS, 'lax').changed).toBeGreaterThan(0);
  });

  it('pe o biblioteca goala nu arunca si nu inventeaza cifre', () => {
    for (const o of previewAllStrictness([], FIXED_THRESHOLDS)) {
      expect(o).toMatchObject({ kept: 0, rejected: 0, review: 0, changed: 0 });
    }
  });
});
