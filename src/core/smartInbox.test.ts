import { describe, it, expect } from 'vitest';
import {
  classifyPhoto, buildSmartInbox, countNonPersonal,
  DOCUMENT_TEXT_COVERAGE, SCREENSHOT_TEXT_COVERAGE, type InboxCandidate
} from './smartInbox';

function p(over: Partial<InboxCandidate> = {}): InboxCandidate {
  return { id: 'a', fileName: 'IMG_0001.jpg', faceCount: 0, ...over };
}

describe('classifyPhoto', () => {
  it('numele pus de sistem e cel mai sigur semnal', () => {
    expect(classifyPhoto(p({ fileName: 'Screenshot_2026-08-19-10-22-31.png' }))).toBe('screenshot');
    expect(classifyPhoto(p({ fileName: 'screen_shot 3.png' }))).toBe('screenshot');
    expect(classifyPhoto(p({ fileName: 'Captura de ecran.png' }))).toBe('screenshot');
    expect(classifyPhoto(p({ fileName: 'screenrecord_01.mp4.jpg' }))).toBe('screenshot');
  });

  it('numele se verifica de la INCEPUT, nu oriunde', () => {
    // altfel "eu si screenshotul.jpg" ar disparea din poze
    expect(classifyPhoto(p({ fileName: 'eu si screenshotul.jpg' }))).toBe('personal');
    expect(classifyPhoto(p({ fileName: 'poza cu captura pe perete.jpg' }))).toBe('personal');
  });

  it('ignora calea si majusculele din nume', () => {
    expect(classifyPhoto(p({ fileName: '/DCIM/Screenshots/SCREENSHOT_9.PNG' }))).toBe('screenshot');
  });

  it('o fata inseamna poza cu oameni, oricat text ar fi in cadru', () => {
    expect(classifyPhoto(p({ faceCount: 1, textCoverage: 0.9 }))).toBe('personal');
  });

  it('text mult si fara fete inseamna document', () => {
    expect(classifyPhoto(p({ textCoverage: DOCUMENT_TEXT_COVERAGE + 0.01 }))).toBe('document');
    expect(classifyPhoto(p({ textCoverage: DOCUMENT_TEXT_COVERAGE - 0.01 }))).toBe('personal');
  });

  it('etichetele de obiect contrazic ipoteza de document', () => {
    // o poza cu un tort si o pancarta ramane o poza
    expect(classifyPhoto(p({ textCoverage: 0.4, sceneTags: ['cake'] }))).toBe('personal');
  });

  it('text mult plus proportie de ecran inseamna captura, chiar fara nume', () => {
    expect(classifyPhoto(p({
      textCoverage: SCREENSHOT_TEXT_COVERAGE + 0.05, width: 1080, height: 2400
    }))).toBe('screenshot');
  });

  it('proportia de ecran singura nu clasifica nimic', () => {
    // multe poze verticale au aceeasi proportie
    expect(classifyPhoto(p({ width: 1080, height: 2400 }))).toBe('personal');
  });

  it('fara OCR (web, fara ruta nativa) se bazeaza doar pe nume', () => {
    expect(classifyPhoto(p({ fileName: 'IMG_1234.jpg' }))).toBe('personal');
    expect(classifyPhoto(p({ fileName: 'Screenshot_1.png' }))).toBe('screenshot');
  });
});

describe('buildSmartInbox', () => {
  it('nu intoarce nimic pentru o biblioteca numai cu poze', () => {
    expect(buildSmartInbox([p({ id: '1' }), p({ id: '2', faceCount: 2 })])).toEqual([]);
  });

  it('grupeaza pe categorii, capturile inaintea documentelor', () => {
    const groups = buildSmartInbox([
      p({ id: 'd', textCoverage: 0.5 }),
      p({ id: 's', fileName: 'Screenshot_1.png' }),
      p({ id: 'foto' })
    ]);
    expect(groups.map(g => g.category)).toEqual(['screenshot', 'document']);
    expect(groups[0].ids).toEqual(['s']);
    expect(groups[1].ids).toEqual(['d']);
  });

  it('nu intoarce niciodata categoria personala — nu e ceva de rezolvat', () => {
    const groups = buildSmartInbox([p({ id: 'foto' }), p({ id: 's', fileName: 'Screenshot_1.png' })]);
    expect(groups.some(g => (g.category as string) === 'personal')).toBe(false);
  });
});

describe('countNonPersonal', () => {
  it('numara la fel ca gruparea', () => {
    const photos = [
      p({ id: '1', fileName: 'Screenshot_1.png' }),
      p({ id: '2', textCoverage: 0.5 }),
      p({ id: '3' }),
      p({ id: '4', faceCount: 3 })
    ];
    expect(countNonPersonal(photos)).toBe(2);
    expect(buildSmartInbox(photos).flatMap(g => g.ids)).toHaveLength(2);
  });
});

/**
 * Bug raportat cu captura: poze la cutia unei lampi LED si la cutia unei
 * telecomenzi ajunsesera in banda "COMPARA ATENT", adica aplicatia cerea sa
 * fie comparate cu alternativele lor, ca doua cadre dintr-o sedinta.
 */
describe('lucruri, nu momente', () => {
  const baza = { id: 'x', fileName: 'IMG_2026.jpg', faceCount: 0 };

  it('o cutie de produs nu mai trece drept amintire', () => {
    expect(classifyPhoto({
      ...baza, textCoverage: 0.18, sceneTags: ['box', 'packaging', 'electronics']
    })).toBe('object');
  });

  it('nici cu putin text, daca etichetele spun clar ca e un lucru', () => {
    expect(classifyPhoto({
      ...baza, textCoverage: 0.07, sceneTags: ['remote control', 'device']
    })).toBe('object');
  });

  // Ramura care exista dinainte, si care trebuie sa ramana intacta: etichetele
  // de fiinta/scena salveaza o poza reala care se intampla sa aiba text in ea.
  it('un caine langa un panou ramane amintire', () => {
    expect(classifyPhoto({
      ...baza, textCoverage: 0.2, sceneTags: ['dog', 'grass', 'park']
    })).toBe('personal');
  });

  it('o pagina scrisa ramane document, nu lucru', () => {
    expect(classifyPhoto({ ...baza, textCoverage: 0.4 })).toBe('document');
  });

  it('o fata bate orice eticheta de obiect', () => {
    expect(classifyPhoto({
      ...baza, faceCount: 1, textCoverage: 0.3, sceneTags: ['box', 'packaging']
    })).toBe('personal');
  });

  it('o poza fara text si fara etichete ramane amintire', () => {
    expect(classifyPhoto({ ...baza })).toBe('personal');
  });

  it('buildSmartInbox scoate lucrurile ca grup separat', () => {
    const grupuri = buildSmartInbox([
      { ...baza, id: 'cutie', textCoverage: 0.18, sceneTags: ['box', 'label'] },
      { ...baza, id: 'pagina', textCoverage: 0.4 },
      { ...baza, id: 'copil', faceCount: 1 }
    ]);
    expect(grupuri.find(g => g.category === 'object')?.ids).toEqual(['cutie']);
    expect(grupuri.find(g => g.category === 'document')?.ids).toEqual(['pagina']);
    expect(grupuri.some(g => g.ids.includes('copil'))).toBe(false);
  });
});
