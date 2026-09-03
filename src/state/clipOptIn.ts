/**
 * state/clipOptIn.ts
 * Daca utilizatorul a cerut intelegerea semantica a pozelor (core/clip/).
 *
 * DE CE E OPT-IN, si nu pornit din start. Functia costa o descarcare unica de
 * cateva zeci de MB: runtime-ul ONNX (~26 MB de wasm) plus modelul. Pe un
 * telefon ieftin, cu date mobile limitate, aia nu e un detaliu tehnic — e o
 * decizie care apartine omului, nu aplicatiei. Aplicatia asta nu descarca zeci
 * de MB pe tacute nicaieri, si nu incepe acum.
 *
 * A doua parte, la fel de importanta: OPRIREA sterge datele. Cine inchide
 * functia nu ramane cu o tabela de vectori pe telefon "in caz ca se
 * razgandeste" — vezi db.clipEmbeddings, tinuta separat exact ca sa poata fi
 * golita dintr-o operatie.
 *
 * Implicit OPRIT si dintr-un al treilea motiv, mai putin placut si spus pe
 * fata: la momentul scrierii, modelul nu a fost inca masurat pe un telefon
 * real. Cat timp nu stim ce costa in secunde si in baterie, pornirea lui pentru
 * toata lumea ar fi o presupunere imbracata in functie.
 */
const STORAGE_KEY = 'lumin-clip-enabled';

export function isClipEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Mod privat, cota plina: functia optionala se considera oprita. Restul
    // aplicatiei nu depinde de ea in niciun fel.
    return false;
  }
}

/**
 * Porneste sau opreste functia. Stergerea vectorilor la oprire NU se face aici
 * (modulul asta n-are voie sa depinda de baza de date) — o face apelantul, si e
 * verificat de test.
 */
export function setClipEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Fara localStorage alegerea nu se retine intre porniri. Preferabil unei
    // exceptii intr-un comutator de setari.
  }
}
