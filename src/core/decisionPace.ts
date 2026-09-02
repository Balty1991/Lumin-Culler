/**
 * core/decisionPace.ts
 * Cat de repede decizi TU o poza — masurat, nu presupus.
 *
 * DE CE EXISTA, si de ce n-a existat pana acum. core/sessionOutcome.ts are o
 * regula scrisa negru pe alb: nu inventam "ti-am economisit 50 de minute",
 * fiindca n-avem de unde sti cat de repede ai fi triat manual, iar o cifra
 * inventata ar fi mirosita exact de utilizatorii pe care vrem sa-i convingem.
 * Regula aia ramane in picioare si nu se atinge nimeni de ea.
 *
 * Ce se schimba e ca acum CHIAR avem de unde sti. Fiecare decizie manuala scrie
 * un CorrectionRecord cu `ts` (vezi core/db.ts, camp indexat inca de la prima
 * versiune a schemei). Intervalele dintre doua decizii consecutive sunt exact
 * ritmul tau, masurat pe telefonul tau, la pozele tale. Nu e o presupunere
 * despre "un fotograf mediu" — e o observatie despre tine.
 *
 * PRECAUTIILE, fiindca un numar aproape-corect intr-un ecran de vanzare e mai
 * rau decat niciun numar:
 *
 *  - se folosesc doar intervalele dintr-o sedinta CONTINUA (sub MAX_GAP_MS).
 *    Cine lasa telefonul din mana si revine peste doua ore nu a "decis" doua ore;
 *  - se ia MEDIANA, nu media: o singura pauza de gandire de trei minute ar trage
 *    media in sus cat sa faca cifra ridicola;
 *  - sub MIN_GAPS intervale utilizabile nu se raspunde deloc. Ritmul dedus din
 *    cinci decizii nu e un ritm, e zgomot;
 *  - se ignora intervalele absurd de mici (sub MIN_GAP_MS): sunt apasari duble
 *    sau operatii in masa, nu decizii luate una cate una.
 *
 * CE RAMANE O APROXIMARE, spus aici ca sa nu se piarda: o poza evident proasta
 * se respinge mai repede decat una la limita, iar mediana e trasa de amestecul
 * lor. Estimarea inclina deci usor in sus fata de cat ar fi durat efectiv un
 * teanc de respinse evidente. De-aia interfata arata MEREU si baza ("la ritmul
 * tau de X s pe decizie"): cine vede din ce iese cifra poate s-o judece singur,
 * si asta e diferenta dintre o masuratoare si o reclama.
 */

/** Peste atat intre doua decizii, n-ai decis — ai lasat telefonul din mana. */
const MAX_GAP_MS = 60_000;
/** Sub atat nu e o decizie luata, e o apasare dubla sau o operatie in masa. */
const MIN_GAP_MS = 250;
/** Sub atatea intervale utilizabile, orice "ritm" e zgomot. */
export const MIN_GAPS = 20;

/**
 * Mediana intervalelor dintre decizii consecutive, in secunde. `null` cand inca
 * nu s-au adunat destule ca raspunsul sa insemne ceva.
 *
 * @param timestamps momentele deciziilor manuale (CorrectionRecord.ts), in orice ordine.
 */
export function medianDecisionSeconds(timestamps: readonly number[]): number | null {
  const sorted = [...timestamps].filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS) gaps.push(gap);
  }
  if (gaps.length < MIN_GAPS) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  // Pentru un numar par de intervale, media celor doua din mijloc — mediana
  // clasica; pentru unul impar, cel din mijloc.
  const ms = gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return ms / 1000;
}

/**
 * Cate secunde ti-a scutit motorul decizand singur `autoDecided` poze, la
 * ritmul tau masurat. `null` cand nu se poate raspunde onest.
 *
 * Nu e o inmultire mai complicata decat pare, si nici nu incearca sa fie: tot
 * rostul e ca AMBII factori sa fie masurati. `autoDecided` vine din lotul
 * curent, `paceSeconds` din istoricul deciziilor tale.
 */
export function estimateSecondsSaved(autoDecided: number, paceSeconds: number | null): number | null {
  if (paceSeconds === null || !(autoDecided > 0)) return null;
  return autoDecided * paceSeconds;
}
