/**
 * core/tasteScore.ts
 * „AI-ul a ghicit X din N”: înainte ca omul să aleagă într-o pereche, AI-ul
 * spune pe care ar păstra-o. Predicția se face înainte de lecție, deci e o
 * măsurătoare cinstită: modelul n-a văzut răspunsul.
 *
 * Lângă scorul personal stă și cel al AI-ului generic (aceleași reguli pentru
 * toată lumea), ca omul să vadă cât a câștigat din faptul că l-a învățat.
 * Sub MIN_FOR_PERCENT răspunsuri se arată „7 din 10”, nu procente: la
 * eșantioane mici marja de eroare e uriașă.
 */
export type Side = 'a' | 'b';

export interface PairGuess {
  /** Pe care ar păstra-o AI-ul tău acum. */
  personal: Side;
  /** Pe care ar păstra-o un AI care n-a învățat nimic de la tine. */
  generic: Side;
}

export interface TasteScore {
  hits: number;
  genericHits: number;
  total: number;
}

export const EMPTY_SCORE: TasteScore = { hits: 0, genericHits: 0, total: 0 };
export const MIN_FOR_PERCENT = 20;

const STORAGE_KEY = 'lumin-taste-score';

/** Doar alegerile clare contează: „amândouă” și „niciuna” nu au un câștigător. */
export function scoreAnswer(score: TasteScore, guess: PairGuess | null, answer: string): TasteScore {
  if (!guess || (answer !== 'a' && answer !== 'b')) return score;
  return {
    hits: score.hits + (guess.personal === answer ? 1 : 0),
    genericHits: score.genericHits + (guess.generic === answer ? 1 : 0),
    total: score.total + 1
  };
}

export function readTasteScore(): TasteScore {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && Number.isFinite(raw.hits) && Number.isFinite(raw.genericHits) && Number.isFinite(raw.total)) return raw;
  } catch { /* stocare stricată sau indisponibilă */ }
  return EMPTY_SCORE;
}

export function writeTasteScore(score: TasteScore): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(score)); } catch { /* fără stocare */ }
}
