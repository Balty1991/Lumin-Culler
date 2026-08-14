/**
 * core/etaEstimate.ts
 * Stabilizarea timpului ramas afisat in timpul analizei AI (vezi state/store.ts,
 * runImport) — nu calculul lui, ci ce anume are voie sa vada utilizatorul.
 *
 * Bug real raportat de utilizator: "timpul estimativ nu prea indica corect,
 * uneori urca, alteori scade". Estimarea bruta e rata medie de pana acum
 * (secunde scurse / poze gata) inmultita cu cate poze au ramas — corecta ca
 * matematica, dar recalculata la fiecare poza terminata si afisata pana la
 * secunda. Iar pozele NU costa la fel: una cu cinci fete si decodare RAW poate
 * dura de zece ori cat o captura de ecran. Asa, numarul sarea in sus si in jos
 * intre doua poze consecutive, ceea ce pentru cine se uita la ecran inseamna
 * "aplicatia habar n-are cat mai dureaza".
 *
 * Doua reguli, amandoua despre AFISARE, nu despre acuratete:
 *
 * 1. Rotunjire cu atat mai grosiera cu cat estimarea e mai mare. "~2m 30s" e la
 *    fel de folositor ca "2m 28s" si nu se mai schimba la fiecare tresarire de
 *    rata. Nimeni nu planifica nimic pe baza secundei.
 *
 * 2. Scaderile se accepta mereu; cresterile doar daca sunt REALE. O crestere
 *    sub prag e aproape sigur zgomot de la o poza mai grea, si atunci tinem
 *    valoarea de dinainte — un numar care sta pe loc citeste ca "mai durea",
 *    pe cand unul care urca citeste ca "se strica ceva".
 */

/** Peste cat trebuie sa creasca estimarea ca sa fie crezuta (25%). Sub asta, e zgomot de la o poza mai grea si tinem valoarea afisata. */
const GROWTH_TOLERANCE = 1.25;

/** Sub un minut: din 5 in 5 secunde. Sub zece minute: din 15 in 15. Peste: din minut in minut. */
function quantize(seconds: number): number {
  if (seconds < 60) return Math.max(5, Math.round(seconds / 5) * 5);
  if (seconds < 600) return Math.round(seconds / 15) * 15;
  return Math.round(seconds / 60) * 60;
}

/**
 * Ce secunde ramase sa arate acum, stiind ce a aratat ultima data (`shown`,
 * absent la prima estimare a lotului) si estimarea bruta curenta (`raw`).
 */
export function stabilizeEta(shown: number | undefined, raw: number): number {
  const next = quantize(raw);
  if (shown === undefined) return next;
  if (next <= shown) return next;
  return next > shown * GROWTH_TOLERANCE ? next : shown;
}
