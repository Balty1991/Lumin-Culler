/**
 * state/reviewPlan.ts
 * Coada "de verificat", impartita in feluri de MUNCA, nu in feluri de poze.
 *
 * Dupa o sortare facuta de AI, grila schimba ordinea si atat — omul primeste o
 * lista in care nu stie unde incepe partea grea si unde se poate merge repede.
 * Separatoarele de mai jos transforma ordinea intr-un plan: cat ai de confirmat
 * din mers, cat ai de comparat, si unde chiar trebuie sa te uiti tu.
 *
 * Benzile se taie pe ACEEASI axa dupa care e deja sortata coada — cat de greu e
 * cazul (vezi reviewDifficulty in store.ts). Nu e o alegere de comoditate: o
 * banda definita pe alta axa ar produce separatoare intercalate prin lista, iar
 * un "plan" care sare inainte si inapoi nu mai e un plan.
 *
 * Fara i18n si fara React: intoarce chei si indici.
 */

/** Sub atata, AI-ul e limpede si omul doar confirma din mers. */
const EASY_MAX = 0.35;
/** Peste atata, motorul chiar nu se poate baza pe ce vede. */
const HARD_MIN = 0.7;

export type BandKey = 'easy' | 'compare' | 'hard';

export interface PlanBand {
  key: BandKey;
  /** Indexul primei poze din banda, in lista deja sortata. */
  startIndex: number;
  count: number;
}

export function bandOf(difficulty: number): BandKey {
  if (!Number.isFinite(difficulty)) return 'hard';
  if (difficulty < EASY_MAX) return 'easy';
  if (difficulty < HARD_MIN) return 'compare';
  return 'hard';
}

/**
 * Benzile listei, in ordinea in care apar.
 *
 * @param difficulties dificultatea fiecarei poze, in ordinea DEJA sortata a
 *   listei. Injectata, nu calculata aici: singurul loc care stie cum se masoara
 *   dificultatea e store-ul, si n-are voie sa existe o a doua definitie.
 */
export function planBands(difficulties: number[]): PlanBand[] {
  const bands: PlanBand[] = [];
  for (let i = 0; i < difficulties.length; i++) {
    const key = bandOf(difficulties[i]);
    const last = bands[bands.length - 1];
    // Doar cand banda chiar SE SCHIMBA. O lista nesortata ar produce altfel un
    // separator la fiecare a doua poza — de aceea benzile n-au sens decat peste
    // ordinea data de dificultate.
    if (last && last.key === key) last.count++;
    else bands.push({ key, startIndex: i, count: 1 });
  }
  return bands;
}

/**
 * Indexul de start -> banda care incepe acolo. Pentru randare: grila intreaba
 * pentru fiecare pozitie daca trebuie pus un separator inaintea ei.
 *
 * O banda cu o singura poza NU primeste separator: un titlu urmat de un singur
 * cadru ocupa mai mult loc decat cadrul si nu organizeaza nimic.
 */
export function bandStarts(bands: PlanBand[], minCount = 2): Map<number, PlanBand> {
  const map = new Map<number, PlanBand>();
  // Nici cand toata lista e o singura banda: acolo separatorul n-ar imparti nimic.
  if (bands.length < 2) return map;
  for (const b of bands) if (b.count >= minCount) map.set(b.startIndex, b);
  return map;
}

/**
 * Randurile grilei, rupte la fiecare inceput de banda.
 *
 * De ce nu se poate mai simplu: grila virtualizata deseneaza randuri de cate
 * `columns` poze, iar o banda care incepe la mijlocul unui rand ar pune pana la
 * trei poze sub titlul gresit. Aici randul se INCHIDE inainte de fiecare
 * separator — ultimul rand al unei benzi poate ramane incomplet, ceea ce e chiar
 * asezarea corecta: o sectiune se termina, alta incepe.
 *
 * Randurile intoarse sunt si unitatea de virtualizare, deci numarul lor e tot
 * ce trebuie sa stie virtualizatorul.
 */
export interface PlanRow<T> {
  /** Separatorul care se deseneaza DEASUPRA randului, cand randul incepe o banda. */
  band?: PlanBand;
  items: T[];
  /** Indexul primei poze din rand, in lista intreaga — PhotoCard il foloseste pentru numerotare. */
  startIndex: number;
}

export function buildRowPlan<T>(items: T[], columns: number, starts: Map<number, PlanBand>): PlanRow<T>[] {
  const cols = Math.max(1, Math.floor(columns));
  const rows: PlanRow<T>[] = [];
  let current: PlanRow<T> | null = null;
  for (let i = 0; i < items.length; i++) {
    const band = starts.get(i);
    if (band || !current || current.items.length === cols) {
      current = { items: [], startIndex: i, ...(band ? { band } : {}) };
      rows.push(current);
    }
    current.items.push(items[i]);
  }
  return rows;
}
