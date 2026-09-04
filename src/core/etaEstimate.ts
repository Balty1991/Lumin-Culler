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

/**
 * Cate poze inapoi se uita estimarea ca sa afle ritmul CURENT.
 *
 * Bug raportat de utilizator, cu doua capturi la un minut distanta: 33 din 77
 * "cam 50s ramase", apoi 44 din 77 "cam 45s ramase". Refacand calculul, ritmul
 * din fereastra dintre cele doua era de vreo 2 s/poza, dar estimarea afisata
 * pornea de la ~1,4 — media de la INCEPUTUL lotului.
 *
 * Media aia nu e gresita, e doar veche. Primele poze sunt mereu cele mai
 * rapide: telefonul e rece, memoria goala, iar pre-scanarea pune la inceput
 * pozele cu oameni, care nu sunt neaparat cele mai grele. Pe masura ce
 * procesorul se incalzeste si se strange presiune de memorie, ritmul real
 * scade — dar media, care are in ea toate pozele rapide de la inceput, coboara
 * mult mai incet decat adevarul. Rezultatul: un numar care ramane optimist
 * pana spre final, cand cade brusc. Exact ce se vede pe ecran ca "timerul nu
 * estimeaza corect".
 *
 * 20 de poze: la ritmurile reale masurate pe telefon inseamna vreo zece
 * secunde de lucru — destul cat sa nu tresara de la o poza grea, destul de
 * putin cat sa prinda o incetinire adevarata in cateva secunde. Zgomotul de
 * afisare ramane oricum tratat separat, de stabilizeEta.
 */
const WINDOW_PHOTOS = 20;

/**
 * Sub atatea poze in fereastra, ritmul recent nu inseamna inca nimic si se
 * revine la media de la inceput — aceeasi de pana acum. La inceputul lotului nu
 * exista alta informatie, iar o fereastra de doua poze ar face estimarea sa
 * sara la fiecare poza mai grea.
 */
const MIN_WINDOW_PHOTOS = 5;

/**
 * Estimarea BRUTA de secunde ramase, din ritmul recent — nu din media intregului
 * lot. Rezultatul trece apoi prin `stabilizeEta`, care se ocupa de afisare.
 *
 * Tine minte doar cateva perechi (secunde scurse, poze gata); nu are ceas
 * propriu si nu atinge DOM-ul, deci se testeaza direct.
 */
export interface EtaTracker {
  /** `undefined` cand inca nu se poate spune nimic onest (prea putine date, sau lotul s-a terminat). */
  sample(elapsedSec: number, done: number, total: number): number | undefined;
}

export function createEtaTracker(): EtaTracker {
  const masuratori: { elapsedSec: number; done: number }[] = [];
  return {
    sample(elapsedSec, done, total) {
      masuratori.push({ elapsedSec, done });
      // Fereastra gliseaza dupa POZE, nu dupa timp: cand analiza incetineste,
      // o fereastra masurata in secunde ar contine tot mai putine poze, adica
      // ar deveni tot mai zgomotoasa exact cand acuratetea conteaza mai mult.
      while (masuratori.length > 2 && done - masuratori[0].done > WINDOW_PHOTOS) masuratori.shift();

      const remaining = total - done;
      if (remaining <= 0) return undefined;

      const primul = masuratori[0];
      const pozeInFereastra = done - primul.done;
      const secundeInFereastra = elapsedSec - primul.elapsedSec;
      if (pozeInFereastra >= MIN_WINDOW_PHOTOS && secundeInFereastra > 0) {
        return (secundeInFereastra / pozeInFereastra) * remaining;
      }
      // Inceputul lotului: media de pana acum, ca inainte.
      if (done > 0 && elapsedSec > 1) return (elapsedSec / done) * remaining;
      return undefined;
    }
  };
}
