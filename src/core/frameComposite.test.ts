import { describe, expect, it } from 'vitest';
import {
  suggestComposite, faceAppearance, GOOD_ENOUGH, MAX_SWAPS, MIN_SWAP_GAIN,
  type CompositeFrame
} from './frameComposite';

/** Embedding-uri ortogonale = persoane clar diferite; acelasi vector = acelasi om. */
const ANA = [1, 0, 0, 0];
const BOGDAN = [0, 1, 0, 0];
const CARMEN = [0, 0, 1, 0];
const DAN = [0, 0, 0, 1];

function frame(id: string, faces: [number[], number][]): CompositeFrame {
  return { id, faces: faces.map(([embedding, quality]) => ({ embedding, quality })) };
}
const GOOD = 0.9;
const BAD = 0.1;

describe('faceAppearance', () => {
  it('duce clipitul aproape de zero, nu il mediaza cu restul', () => {
    // intr-o poza de grup un singur om cu ochii inchisi strica poza, oricat de
    // bine ar zambi ceilalti
    expect(faceAppearance({ isBlinking: true, smile: 1, eyeContact: 1 })).toBe(0);
  });

  it('rasplateste zambetul si privirea spre camera', () => {
    const neutru = faceAppearance({ isBlinking: false, smile: 0, eyeContact: 0 });
    const bun = faceAppearance({ isBlinking: false, smile: 1, eyeContact: 1 });
    expect(bun).toBeGreaterThan(neutru);
    expect(bun).toBeLessThanOrEqual(1);
    expect(neutru).toBeGreaterThanOrEqual(0);
  });

  it('scoate din "arata bine" o expresie stanjenitoare, fara s-o trateze ca pe ochi inchisi', () => {
    const awkward = faceAppearance({ isBlinking: false, smile: 0.8, awkward: true });
    expect(awkward).toBeLessThan(GOOD_ENOUGH);
    expect(awkward).toBeGreaterThan(0);
  });
});

describe('suggestComposite', () => {
  it('gaseste cadrul de baza si persoana de luat din alta parte', () => {
    const hint = suggestComposite([
      frame('c1', [[ANA, GOOD], [BOGDAN, GOOD], [CARMEN, BAD]]), // toti buni in afara de Carmen
      frame('c2', [[ANA, BAD], [BOGDAN, BAD], [CARMEN, GOOD]])
    ])!;
    expect(hint.baseFrameId).toBe('c1');
    expect(hint.swaps).toHaveLength(1);
    expect(hint.swaps[0].fromFrameId).toBe('c2');
    expect(hint.personCount).toBe(3);
  });

  it('tace cand un cadru e deja bun pentru toata lumea', () => {
    expect(suggestComposite([
      frame('c1', [[ANA, GOOD], [BOGDAN, GOOD]]),
      frame('c2', [[ANA, BAD], [BOGDAN, GOOD]])
    ])).toBeNull();
  });

  it('tace cand ar trebui combinate prea multe cadre — aia nu mai e o sugestie', () => {
    // patru oameni, si in orice cadru ai porni raman trei de adus din alta
    // parte: seria n-are un cadru de baza salvabil
    const hint = suggestComposite([
      frame('c1', [[ANA, GOOD], [BOGDAN, BAD], [CARMEN, BAD], [DAN, BAD]]),
      frame('c2', [[ANA, BAD], [BOGDAN, GOOD], [CARMEN, BAD], [DAN, BAD]]),
      frame('c3', [[ANA, BAD], [BOGDAN, BAD], [CARMEN, GOOD], [DAN, BAD]]),
      frame('c4', [[ANA, BAD], [BOGDAN, BAD], [CARMEN, BAD], [DAN, GOOD]])
    ]);
    expect(MAX_SWAPS).toBe(2);
    expect(hint).toBeNull();
  });

  it('accepta exact doua schimburi — plafonul e inclusiv', () => {
    const hint = suggestComposite([
      frame('c1', [[ANA, GOOD], [BOGDAN, BAD], [CARMEN, BAD]]),
      frame('c2', [[ANA, BAD], [BOGDAN, GOOD], [CARMEN, BAD]]),
      frame('c3', [[ANA, BAD], [BOGDAN, BAD], [CARMEN, GOOD]])
    ])!;
    expect(hint.baseFrameId).toBe('c1');
    expect(hint.swaps).toHaveLength(2);
  });

  it('nu spune nimic pentru o singura persoana — acolo "cel mai bun cadru" e deja tot raspunsul', () => {
    expect(suggestComposite([frame('c1', [[ANA, BAD]]), frame('c2', [[ANA, GOOD]])])).toBeNull();
  });

  it('nu spune nimic despre un singur cadru', () => {
    expect(suggestComposite([frame('c1', [[ANA, BAD], [BOGDAN, GOOD]])])).toBeNull();
  });

  it('ignora fetele care nu pot fi urmarite intre cadre (fara embedding)', () => {
    const hint = suggestComposite([
      { id: 'c1', faces: [{ quality: BAD }, { quality: GOOD }] },
      { id: 'c2', faces: [{ quality: GOOD }, { quality: GOOD }] }
    ]);
    expect(hint).toBeNull(); // mai bine tacem decat sa confundam doi oameni
  });

  it('nu propune un schimb pentru un castig neglijabil', () => {
    const abia = GOOD_ENOUGH - 0.02;
    const hint = suggestComposite([
      frame('c1', [[ANA, abia], [BOGDAN, GOOD]]),
      frame('c2', [[ANA, abia + MIN_SWAP_GAIN / 3], [BOGDAN, BAD]])
    ]);
    expect(hint).toBeNull();
  });

  it('nu propune un schimb catre un cadru in care persoana tot nu arata bine', () => {
    const hint = suggestComposite([
      frame('c1', [[ANA, 0.05], [BOGDAN, GOOD]]),
      frame('c2', [[ANA, 0.4], [BOGDAN, BAD]]) // mai bine, dar tot sub prag
    ]);
    expect(hint).toBeNull();
  });

  it('alege drept baza cadrul bun pentru CEI MAI MULTI, nu pe cel cu media cea mai mare', () => {
    // c1: doi stralucitori, unul clipeste. c2: toti trei decenti.
    const hint = suggestComposite([
      frame('c1', [[ANA, 1], [BOGDAN, 1], [CARMEN, 0]]),
      frame('c2', [[ANA, 0.7], [BOGDAN, 0.7], [CARMEN, 0.7]])
    ]);
    expect(hint).toBeNull(); // c2 e bun pentru toti -> niciun schimb de propus
  });

  it('pune primul schimbul care aduce cel mai mult', () => {
    const hint = suggestComposite([
      frame('c1', [[ANA, GOOD], [BOGDAN, 0.2], [CARMEN, 0.45]]), // baza: doi de adus, cu castiguri diferite
      frame('c2', [[ANA, BAD], [BOGDAN, 0.9], [CARMEN, BAD]]),
      frame('c3', [[ANA, BAD], [BOGDAN, BAD], [CARMEN, 0.9]])
    ])!;
    expect(hint.baseFrameId).toBe('c1');
    expect(hint.swaps).toHaveLength(2);
    expect(hint.swaps[0].fromFrameId).toBe('c2'); // Bogdan castiga 0.7, Carmen 0.45
    expect(hint.swaps[0].gain).toBeGreaterThanOrEqual(hint.swaps[1].gain);
  });
});

// "Persoana 3" nu-i spune nimanui CINE — numerotarea vine din ordinea interna de
// detectie, care nu apare nicaieri pe ecran. Cand persoana e inrolata, sfatul
// trebuie sa-i spuna pe nume.
describe('suggestComposite — numele persoanei', () => {
  it('poarta numele mai departe cand persoana e recunoscuta', () => {
    const hint = suggestComposite([
      { id: 'c1', faces: [{ embedding: ANA, quality: GOOD, name: 'Ana' }, { embedding: BOGDAN, quality: BAD, name: 'Bogdan' }] },
      { id: 'c2', faces: [{ embedding: ANA, quality: BAD, name: 'Ana' }, { embedding: BOGDAN, quality: GOOD, name: 'Bogdan' }] }
    ])!;
    expect(hint.swaps[0].name).toBe('Bogdan');
  });

  it('il ia din cadrul in care recunoasterea a reusit, chiar daca a ratat in altul', () => {
    const hint = suggestComposite([
      { id: 'c1', faces: [{ embedding: ANA, quality: GOOD }, { embedding: BOGDAN, quality: BAD, name: 'Bogdan' }] },
      { id: 'c2', faces: [{ embedding: ANA, quality: BAD }, { embedding: BOGDAN, quality: GOOD }] }
    ])!;
    expect(hint.swaps[0].name).toBe('Bogdan');
  });

  it('ramane fara nume cand persoana nu e inrolata — apelantul cade pe numerotare', () => {
    const hint = suggestComposite([
      { id: 'c1', faces: [{ embedding: ANA, quality: GOOD }, { embedding: BOGDAN, quality: BAD, name: null }] },
      { id: 'c2', faces: [{ embedding: ANA, quality: BAD }, { embedding: BOGDAN, quality: GOOD }] }
    ])!;
    expect(hint.swaps[0].name).toBeUndefined();
  });
});
