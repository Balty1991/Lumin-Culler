/**
 * core/learning/habits.ts
 * Ce spun deciziile TALE despre felul in care fotografiezi.
 *
 * Motorul foloseste corectiile ca sa invete ce sa aleaga. Dar aceleasi date
 * raspund si la o intrebare complet diferita, pe care nimeni nu i-o pune:
 * exista tipare in ce arunci, pe care TU nu le stii?
 *
 * Fiecare decizie manuala e salvata cu momentul ei, iar fiecare poza are ora
 * capturii, subiectele detectate si focala. Incrucisate, ies afirmatii de genul
 * "pozele tale de seara le pastrezi de doua ori mai des decat cele de la pranz"
 * sau "arunci 9 din 10 poze cu mancare" — lucruri pe care un fotograf le simte
 * vag, dar nu le-a masurat niciodata pe propriile poze. A doua e si actionabila:
 * daca arunci mereu acelasi tip de poza, aplicatia poate inceta sa ti-l mai
 * propuna.
 *
 * DISCIPLINA, fiindca asta desparte o observatie de o ghicitoare:
 *
 * - doar decizii MANUALE. Statusurile puse de AI ar face motorul sa-si confirme
 *   singur presupunerile — ar "descoperi" exact tiparele pe care el le-a creat.
 * - un prag minim per grupa. Cu 4 poze de seara, "de doua ori mai des" e o
 *   moneda aruncata de patru ori.
 * - o abatere minima fata de rata ta generala. Daca pastrezi 60% din tot si 63%
 *   din pozele de dimineata, nu s-a intamplat nimic demn de spus.
 * - cel mult o constatare per categorie, si putine in total. O lista de zece
 *   "descoperiri" e horoscop, nu analiza.
 *
 * Fara dependinte: totul se testeaza direct pe o lista de decizii.
 */

/** Sub atatea decizii intr-o grupa, procentul ei e zgomot. */
export const MIN_BUCKET = 15;
/** Sub atatea decizii in total nu ne apucam deloc de cautat tipare. */
export const MIN_TOTAL = 40;
/** Cat de departe de rata ta generala trebuie sa fie o grupa ca sa merite spusa (puncte procentuale, 0..1). */
export const MIN_DEVIATION = 0.18;
/** Cate constatari aratam, cel mult — vezi nota despre horoscop. */
export const MAX_FINDINGS = 3;

export interface HabitInput {
  /** Ce ai ales TU (nu ce propunea AI-ul). */
  kept: boolean;
  /** Momentul capturii, nu al deciziei. */
  capturedAt?: number;
  sceneTags?: string[];
  /** Echivalent 35mm — singurul comparabil intre aparate (vezi ContextEngine). */
  focalLength35mm?: number;
}

export type HabitKind = 'time' | 'subject' | 'focal';

export interface Habit {
  kind: HabitKind;
  /** Cheia grupei: 'morning' | 'midday' | 'evening' | 'night', eticheta de scena bruta, sau 'wide' | 'normal' | 'tele'. */
  key: string;
  /** Cat pastrezi din grupa asta, 0..1. */
  keepRate: number;
  /** Cat pastrezi in general, 0..1 — termenul de comparatie. */
  baseline: number;
  /** Cate decizii stau in spatele grupei. */
  count: number;
}

/** Ora locala a capturii, in patru benzi. Local, nu UTC: "seara" inseamna seara ta. */
function timeBand(capturedAt: number): string {
  const h = new Date(capturedAt).getHours();
  if (h >= 5 && h <= 11) return 'morning';
  if (h >= 12 && h <= 16) return 'midday';
  if (h >= 17 && h <= 21) return 'evening';
  return 'night';
}

/**
 * Clasa de focala, in echivalent 35mm. Pragurile sunt conventiile clasice
 * (sub 24mm = ultrawide, peste 60mm = tele), nu o calibrare proprie.
 */
function focalBand(focalLength35mm: number): string {
  if (focalLength35mm < 24) return 'wide';
  if (focalLength35mm > 60) return 'tele';
  return 'normal';
}

/** Grupele unei categorii: cheie -> [pastrate, total]. */
function tally(rows: readonly HabitInput[], keysOf: (r: HabitInput) => string[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const r of rows) {
    for (const key of keysOf(r)) {
      const cell = out.get(key) ?? [0, 0];
      cell[0] += r.kept ? 1 : 0;
      cell[1] += 1;
      out.set(key, cell);
    }
  }
  return out;
}

/** Grupa cea mai departata de rata generala, dintre cele destul de mari — sau null. */
function strongest(kind: HabitKind, buckets: Map<string, [number, number]>, baseline: number): Habit | null {
  let best: Habit | null = null;
  for (const [key, [kept, count]] of buckets) {
    if (count < MIN_BUCKET) continue;
    const keepRate = kept / count;
    if (Math.abs(keepRate - baseline) < MIN_DEVIATION) continue;
    if (!best || Math.abs(keepRate - baseline) > Math.abs(best.keepRate - baseline)) {
      best = { kind, key, keepRate, baseline, count };
    }
  }
  return best;
}

/**
 * Tiparele demne de spus din deciziile tale. Lista goala inseamna exact ce
 * spune: nu s-a gasit nimic care sa treaca pragurile — un rezultat perfect
 * valid, si de departe cel mai onest raspuns cand nu exista un tipar real.
 */
export function findHabits(rows: readonly HabitInput[]): Habit[] {
  if (rows.length < MIN_TOTAL) return [];
  const baseline = rows.filter(r => r.kept).length / rows.length;

  const found = [
    strongest('time', tally(rows, r => (r.capturedAt !== undefined ? [timeBand(r.capturedAt)] : [])), baseline),
    // o poza are mai multe etichete, deci contribuie la fiecare — asta e corect:
    // intrebarea e "cum te porti cu pozele care CONTIN mancare", nu "cu pozele
    // care sunt exclusiv despre mancare"
    strongest('subject', tally(rows, r => r.sceneTags ?? []), baseline),
    strongest('focal', tally(rows, r => (r.focalLength35mm !== undefined ? [focalBand(r.focalLength35mm)] : [])), baseline)
  ].filter((h): h is Habit => h !== null);

  return found
    .sort((a, b) => Math.abs(b.keepRate - b.baseline) - Math.abs(a.keepRate - a.baseline))
    .slice(0, MAX_FINDINGS);
}
