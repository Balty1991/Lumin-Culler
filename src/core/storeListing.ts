/**
 * core/storeListing.ts
 * Deschiderea fisei din Google Play, pentru butonul "Lasa o parere".
 *
 * DE CE EXISTA. Raportul de testare extern a notat ca aplicatia n-are nicio
 * cale prin care utilizatorul sa poata lasa o recenzie — iar chestionarul de
 * acces la productie cere explicit sa spui ce ai schimbat dupa testare. Un
 * buton care chiar exista e diferenta dintre un raspuns adevarat si unul pe
 * care Google il poate verifica si dezminti.
 *
 * CE NU FACE, si e o decizie, nu o omisiune: nu apare niciun dialog "iti place
 * aplicatia?" peste ecran, la a treia sesiune sau dupa un export reusit.
 * Aplicatia asta nu intrerupe utilizatorul ca sa-i ceara ceva, nicaieri; un
 * pop-up de rating ar fi primul, si ar fi exact tiparul pe care recenziile
 * concurentei il reclama cel mai des. Butonul sta in meniu, la Ajutor, si
 * asteapta sa fie apasat.
 *
 * DOUA ADRESE, si ordinea conteaza:
 *  - `market://` deschide direct aplicatia Play, pe pagina de recenzii, fara sa
 *    treaca prin browser. Exista doar pe Android cu Play instalat;
 *  - `https://play.google.com/...` merge oriunde, inclusiv pe web/PWA si pe
 *    telefoanele fara Play Store.
 * Incercam intai schema nativa si cadem pe cea web daca sistemul n-o cunoaste.
 */

/** Acelasi identificator ca in capacitor.config.ts si android/app/build.gradle. */
export const APP_ID = 'com.luminculler.app';

export const STORE_URL_WEB = `https://play.google.com/store/apps/details?id=${APP_ID}`;
const STORE_URL_NATIVE = `market://details?id=${APP_ID}`;

/**
 * Deschide fisa din magazin. Intoarce adresa chiar deschisa, ca apelantul (si
 * testele) sa poata verifica ce s-a intamplat, nu doar ca "s-a apelat ceva".
 *
 * `noopener`: pagina deschisa nu are voie sa poata manipula fereastra
 * aplicatiei prin `window.opener`.
 */
export function openStoreListing(open: (url: string) => Window | null = url => window.open(url, '_blank', 'noopener')): string {
  try {
    // Pe un dispozitiv fara Play, `market://` nu deschide nimic si intoarce
    // null (sau arunca) — atunci mergem pe adresa web, care merge oriunde.
    const native = open(STORE_URL_NATIVE);
    if (native) return STORE_URL_NATIVE;
  } catch {
    // schema necunoscuta sistemului — cade pe web, mai jos
  }
  open(STORE_URL_WEB);
  return STORE_URL_WEB;
}
