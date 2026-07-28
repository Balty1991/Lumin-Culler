/**
 * state/applyEditsPreference.ts
 * Preferinta persistata: fotograful decide EXPLICIT, la fiecare export, daca
 * ajustarile de baza (EditPanel) se "coc" in galeria pentru client sau daca
 * clientul vede pozele neatinse — implicit FALS (comportamentul dinainte de
 * modulul de editare), activat doar cand chiar se doreste.
 */
const STORAGE_KEY = 'lumin-apply-edits-in-gallery';

export function readApplyEditsInGallery(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeApplyEditsInGallery(value: boolean): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stocare indisponibila — preferinta ramane valabila doar pentru sesiunea curenta
  }
}
