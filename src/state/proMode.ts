/**
 * state/proMode.ts
 *
 * "Mod profesional" — funcțiile care nu au ce căuta în drumul unui om obișnuit.
 *
 * Aplicatia contine, de fapt, doua produse. Unul curata galeria: duplicate,
 * rafale, poze miscate, triaj rapid cu degetul mare. Celalalt e o unealta de
 * culling profesional: etichete XMP pentru Lightroom, contact sheet, galerie si
 * feedback pentru client, watermark, proiecte, gen fotografic, harta locatiilor.
 *
 * Amandoua sunt legitime. Impreuna insa fac un meniu prin care nu poate trece
 * nimeni: treizeci si opt de intrari, dintre care jumatate n-au niciun inteles
 * pentru cineva care voia doar sa scape de pozele duble.
 *
 * Comutatorul asta nu sterge nimic si nu blocheaza nimic. Muta doar ce e
 * profesional in spatele unei singure decizii, luata o data. Oprit implicit,
 * pentru ca utilizatorul tinta e cel cu galeria plina, nu fotograful de nunta —
 * iar fotograful de nunta gaseste comutatorul in doua secunde, pe cand celalalt
 * n-ar fi stiut niciodata ce sa faca cu "Feedback de la client (JSON)".
 */
const STORAGE_KEY = 'lumin-pro-mode';

export function readProMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeProMode(value: boolean): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stocare indisponibila — alegerea tine cat sesiunea curenta
  }
}
