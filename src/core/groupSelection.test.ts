import { describe, expect, it } from 'vitest';
import { pickBestInGroup, type GroupCandidate } from './groupSelection';

function candidate(overrides: Partial<GroupCandidate>): GroupCandidate {
  return {
    id: 'p', sharpness: 50, exposure: 50, faceCount: 0, bestSmile: 0, allEyesOpen: true,
    ...overrides
  };
}

describe('pickBestInGroup', () => {
  it('throws on an empty group', () => {
    expect(() => pickBestInGroup([])).toThrow();
  });

  it('returns the only candidate for a single-member group', () => {
    expect(pickBestInGroup([candidate({ id: 'a' })])).toBe('a');
  });

  it('prefers the sharper frame when other factors are equal', () => {
    const result = pickBestInGroup([
      candidate({ id: 'blurry', sharpness: 20 }),
      candidate({ id: 'sharp', sharpness: 90 })
    ]);
    expect(result).toBe('sharp');
  });

  it('prefers balanced exposure over an over/under-exposed frame', () => {
    const result = pickBestInGroup([
      candidate({ id: 'blown-out', sharpness: 80, exposure: 98 }),
      candidate({ id: 'balanced', sharpness: 80, exposure: 50 })
    ]);
    expect(result).toBe('balanced');
  });

  it('penalizes a blinking subject vs. one with eyes open, all else equal', () => {
    const result = pickBestInGroup([
      candidate({ id: 'blinking', faceCount: 1, allEyesOpen: false, bestSmile: 0.8 }),
      candidate({ id: 'eyes-open', faceCount: 1, allEyesOpen: true, bestSmile: 0.8 })
    ]);
    expect(result).toBe('eyes-open');
  });

  it('uses groupEyesOpenRatio (not just allEyesOpen) for multi-face frames', () => {
    const result = pickBestInGroup([
      candidate({ id: 'half-closed', faceCount: 3, allEyesOpen: false, groupEyesOpenRatio: 0.33 }),
      candidate({ id: 'mostly-open', faceCount: 3, allEyesOpen: false, groupEyesOpenRatio: 0.66 })
    ]);
    expect(result).toBe('mostly-open');
  });

  it('rewards a higher compositionScore when technical quality is tied', () => {
    const result = pickBestInGroup([
      candidate({ id: 'weak-comp', sharpness: 80, exposure: 50, compositionScore: 0.2 }),
      candidate({ id: 'strong-comp', sharpness: 80, exposure: 50, compositionScore: 0.9 })
    ]);
    expect(result).toBe('strong-comp');
  });
});

// Ce a invatat motorul din deciziile utilizatorului cantareste si el la alegerea
// cadrului din serie — proportional cu cat de antrenat e (ContextEngine.learnedWeight).
describe('pickBestInGroup cu scorul invatat', () => {
  it('ignora complet aiScore cat timp motorul nu a invatat nimic (learnedWeight 0)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'clar', sharpness: 90, aiScore: 10 }),
      candidate({ id: 'neclar', sharpness: 20, aiScore: 99 })
    ]);
    expect(result).toBe('clar');
  });

  it('lasa scorul invatat sa decida cand motorul e antrenat, la diferente mici de calitate', () => {
    const result = pickBestInGroup([
      candidate({ id: 'a', sharpness: 60, aiScore: 20 }),
      candidate({ id: 'b', sharpness: 55, aiScore: 95 })
    ], 1);
    expect(result).toBe('b');
  });

  it('nu lasa scorul invatat sa salveze un cadru vizibil neclar (amestec, nu inlocuire)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'clar', sharpness: 100, aiScore: 50 }),
      candidate({ id: 'foarte-neclar', sharpness: 0, aiScore: 80 })
    ], 0.5);
    expect(result).toBe('clar');
  });

  it('se comporta ca inainte cand candidatii nu au aiScore deloc (web/inregistrari vechi)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'clar', sharpness: 90 }),
      candidate({ id: 'neclar', sharpness: 20 })
    ], 1);
    expect(result).toBe('clar');
  });
});

// Intr-o rafala, claritatea/expunerea/compozitia sunt aproape identice de la un
// cadru la altul — diferentele care conteaza cu adevarat sunt tocmai cele care
// lipseau din fixedScore.
describe('pickBestInGroup — diferentele care chiar despart cadrele unei rafale', () => {
  it('evita cadrul prins la mijlocul vorbirii cand restul e identic', () => {
    const result = pickBestInGroup([
      candidate({ id: 'gura-deschisa', faceCount: 2, groupSmileRatio: 1, groupEyesOpenRatio: 1, groupAwkwardRatio: 1 }),
      candidate({ id: 'curat', faceCount: 2, groupSmileRatio: 1, groupEyesOpenRatio: 1, groupAwkwardRatio: 0 })
    ]);
    expect(result).toBe('curat');
  });

  it('nu lasa expresia stanjenitoare sa faca scorul de fete negativ (ar penaliza dublu)', () => {
    // Ambele cadre au fetele la fel de proaste (fara zambet, ochii inchisi);
    // difera doar cat de stanjenitoare e expresia — 1.0 vs 0.6. Cu scaderea
    // oprita la 0, contributia fetelor e identica (zero) si decide claritatea,
    // deci castiga 'a'. Fara oprire, cele doua ar ajunge la -1 si -0.6, iar
    // diferenta de 0.4 ar depasi avansul de claritate al lui 'a' si ar castiga 'b'.
    const result = pickBestInGroup([
      candidate({ id: 'a', sharpness: 55, faceCount: 2, groupSmileRatio: 0, groupEyesOpenRatio: 0, groupAwkwardRatio: 1 }),
      candidate({ id: 'b', sharpness: 50, faceCount: 2, groupSmileRatio: 0, groupEyesOpenRatio: 0, groupAwkwardRatio: 0.6 })
    ]);
    expect(result).toBe('a');
  });

  it('prefera cadrul in care SUBIECTUL e clar, nu cel cu claritate globala mare si subiectul neclar', () => {
    // Bug-ul clasic al rafalei cu autofocus care "vaneaza": prim-planul ascutit
    // tine claritatea globala sus chiar cand omul din spate e neclar.
    const result = pickBestInGroup([
      candidate({ id: 'subiect-neclar', sharpness: 95, subjectInFocus: false }),
      candidate({ id: 'subiect-clar', sharpness: 75, subjectInFocus: true })
    ]);
    expect(result).toBe('subiect-clar');
  });

  it('nu sconteaza nimic cand focusul pe subiect nu a putut fi masurat (web, inregistrari vechi)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'necunoscut', sharpness: 95 }),
      candidate({ id: 'confirmat', sharpness: 90, subjectInFocus: true })
    ]);
    expect(result).toBe('necunoscut');
  });

  it('desparte doua cadre altfel identice dupa highlights arse', () => {
    const result = pickBestInGroup([
      candidate({ id: 'ars', highlightClipping: 0.4 }),
      candidate({ id: 'intreg', highlightClipping: 0 })
    ]);
    expect(result).toBe('intreg');
  });

  it('scontarea pentru subiect neclar e o scontare, nu un veto', () => {
    // Un cadru foarte clar cu subiectul confirmat neclar ramane totusi peste
    // unul pur si simplu neclar — scontarea muta ordinea intre cadre apropiate,
    // nu arunca la coada orice cadru cu subjectInFocus false.
    const result = pickBestInGroup([
      candidate({ id: 'clar-dar-subiect-moale', sharpness: 100, subjectInFocus: false }),
      candidate({ id: 'neclar-de-tot', sharpness: 20, subjectInFocus: true })
    ]);
    expect(result).toBe('clar-dar-subiect-moale');
  });
});
