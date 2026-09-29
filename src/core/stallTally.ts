/**
 * core/stallTally.ts
 * Cat a stat analiza PE LOC in timpul unui import, si unde era aplicatia atunci.
 *
 * DE CE. Raportat de utilizator de mai multe ori, cu capturi: cu ecranul stins
 * analiza mergea, dar cu aplicatia minimizata si lucru in ALTE aplicatii, bara
 * ramanea pe loc — "83 din 87", apoi "29 din 86 · 1 min.", apoi "82 din 87 ·
 * 7 min." — si pornea inapoi abia cand omul intra din nou in aplicatie.
 * Prioritatea randarii a scurtat blocajele, dar nu le-a eliminat, iar tot ce
 * am avut ca dovada au fost capturi cu o bara care nu se misca. Nu se poate
 * spune din ele cat s-a pierdut, de cate ori, si nici daca ajuta vreo setare.
 *
 * Aceeasi lectie ca la OCR-ul de 80 de secunde: defectul acela a fost gasit
 * pentru ca exista o cifra in Statistici. Aici nu exista niciuna.
 *
 * CE MASURAM. Golurile dintre doua poze terminate. Cu mai multe poze in lucru
 * deodata, una se termina in mod normal la o secunda-doua dupa alta; chiar si
 * cea mai lenta poza masurata vreodata (~21s) nu opreste restul firelor. Un gol
 * de peste STALL_THRESHOLD_MS inseamna ca NIMIC n-a inaintat — tot importul a
 * stat.
 *
 * Si il impartim dupa un singur criteriu, care e si cel care decide ce faci cu
 * cifra:
 *  - a stat cat aplicatia NU era pe ecran → de la telefon (economisirea
 *    bateriei, managerul producatorului). Se trateaza din Setari, nu din cod.
 *  - a stat CU aplicatia pe ecran → de la noi. N-ar trebui sa existe; daca
 *    apare, e un defect de cautat, ca OCR-ul care astepta la nesfarsit.
 *
 * DE CE NU TICURI DE CEAS. Un cronometru al paginii se opreste cand procesul e
 * inghetat — dar si cand Chromium doar RARESTE temporizatoarele unei pagini
 * ascunse, in timp ce analiza merge perfect. Ar fi numarat ca pauza exact
 * testul care trecea, cel cu ecranul stins. Pozele terminate nu mint: daca se
 * termina, analiza a mers.
 *
 * Fara dependinte de DOM: momentul si vizibilitatea vin de la apelant, ca in
 * core/activeElapsed.ts.
 */

/**
 * Pragul peste care un gol intre doua poze terminate e "a stat", nu "a lucrat
 * la o poza grea".
 *
 * Masurat pe telefonul utilizatorului: analiza AI a unei poze, 4,2s de obicei
 * si 6,3s in cel mai rau caz; iar cu mai multe poze in lucru deodata, golul
 * dintre doua terminari e mult mai mic de atat. Douazeci de secunde lasa loc
 * de trei ori celui mai rau caz obisnuit, deci ce trece peste chiar e o oprire.
 */
export const STALL_THRESHOLD_MS = 20_000;

export interface StallTally {
  /** Timp total stat pe loc cat aplicatia NU era pe ecran. */
  hiddenMs: number;
  /** De cate ori. */
  hiddenCount: number;
  /** Timp total stat pe loc CU aplicatia pe ecran — de la noi, n-ar trebui sa existe. */
  visibleMs: number;
  /** De cate ori. */
  visibleCount: number;
}

export interface StallTracker {
  /** De chemat la fiecare poza terminata. */
  progress(at: number, hidden: boolean): void;
  /** De chemat la fiecare schimbare de vizibilitate. */
  visibility(hidden: boolean): void;
  read(): StallTally;
}

export function createStallTracker(
  startedAt: number,
  startHidden: boolean,
  threshold: number = STALL_THRESHOLD_MS
): StallTracker {
  let ultima = startedAt;
  /**
   * A fost aplicatia ascunsa MACAR O CLIPA de la ultima poza terminata?
   *
   * Nu starea din clipa de acum: golul care conteaza e intreg intervalul. Omul
   * iese din aplicatie, analiza sta sapte minute, omul intra inapoi, si abia
   * atunci se termina urmatoarea poza — cu aplicatia VIZIBILA. Citita doar in
   * momentul ala, oprirea ar fi fost pusa pe seama noastra, adica exact invers.
   */
  let ascunsaInInterval = startHidden;
  const tally: StallTally = { hiddenMs: 0, hiddenCount: 0, visibleMs: 0, visibleCount: 0 };

  return {
    progress(at, hidden) {
      const gol = at - ultima;
      if (gol >= threshold) {
        if (ascunsaInInterval) {
          tally.hiddenMs += gol;
          tally.hiddenCount++;
        } else {
          tally.visibleMs += gol;
          tally.visibleCount++;
        }
      }
      ultima = at;
      ascunsaInInterval = hidden;
    },
    visibility(hidden) {
      if (hidden) ascunsaInInterval = true;
    },
    read() {
      return { ...tally };
    }
  };
}
