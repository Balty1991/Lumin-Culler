import { describe, expect, it } from 'vitest';
import { decidePhotoStatus } from './importPipeline';

/**
 * core/subjectGuard.test.ts
 * Ce se intampla cu o poza pe care motorul n-o poate NUMI.
 *
 * `decidePhotoStatus` are o regula stricta: o poza fara fete si fara nicio
 * eticheta de subiect nu se auto-aproba NICIODATA, oricat de bun i-ar fi
 * scorul. Intentia e buna — nu aprobi automat ceva ce nu poti descrie.
 *
 * Testele astea exista ca sa faca EFECTUL vizibil, fiindca depinde complet de
 * cat de bun e etichetatorul, iar el difera intre platforme:
 *  - pe Android nativ, ML Kit (~400 etichete) numeste aproape orice poza;
 *  - pe web, CenterNet cu 80 de clase fixe si prag 0.5 nu numeste mai nimic.
 *
 * Deci aceeasi regula, acelasi cod, doua comportamente foarte diferite.
 */
const bunaDarAnonima = {
  faceCount: 0, knownFaceCount: 0, sceneTags: undefined, textCoverage: undefined,
  subjectInFocus: true, sharpness: 95, exposure: 55,
  highlightClipping: 0, shadowClipping: 0, allEyesOpen: true, groupEyesOpenRatio: undefined
};

describe('o poza excelenta pe care motorul n-o poate numi', () => {
  it('NU se auto-aproba, oricat de mare i-ar fi scorul', () => {
    expect(decidePhotoStatus(99, bunaDarAnonima, { select: 60, reject: 30, adapted: false })).toBe('review');
  });

  it('nici cu pragul de aprobare coborat la minimum', () => {
    // Adica: severitatea "ingaduitor" nu poate misca poza asta. Bara de pe
    // ecranul principal arata acelasi numar la toate trei treptele, si are
    // dreptate — dar omul crede ca butonul e stricat.
    expect(decidePhotoStatus(99, bunaDarAnonima, { select: 1, reject: 0, adapted: false })).toBe('review');
  });

  it('DAR se auto-aproba imediat ce exista o eticheta de subiect', () => {
    // Aceeasi poza, acelasi scor: singura diferenta e ca etichetatorul a spus
    // un cuvant. Pe Android il spune; pe web, de cele mai multe ori, nu.
    const cuEticheta = { ...bunaDarAnonima, sceneTags: ['dog'] };
    expect(decidePhotoStatus(99, cuEticheta, { select: 60, reject: 30, adapted: false })).toBe('selected');
  });

  it('si se auto-aproba cand are o fata in cadru', () => {
    const cuFata = { ...bunaDarAnonima, faceCount: 1 };
    expect(decidePhotoStatus(99, cuFata, { select: 60, reject: 30, adapted: false })).toBe('selected');
  });
});
