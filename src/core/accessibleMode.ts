/**
 * core/accessibleMode.ts
 * "Mod accesibil" (plan modernizare) — text mai mare, butoane de verdict mai
 * mari, pentru utilizatori cu vedere redusa/dexteritate redusa. Deliberat NU
 * un scalaj global al intregii aplicatii (multe componente — unealta de
 * decupare, panourile dense de editare — au dimensiuni fixe in px, calculate
 * geometric; un scalaj global le-ar rupe layout-ul). Doar textul de baza si
 * cele mai frecvente 2 butoane de decizie (selecteaza/respinge) cresc.
 */
const STORAGE_KEY = 'lumin-accessible-mode';

export function readAccessibleMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function applyAccessibleMode(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-a11y', '1');
  else document.documentElement.removeAttribute('data-a11y');

  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch {
    // stocare indisponibila (mod privat strict etc.) — setarea tot se aplica pentru sesiunea curenta
  }
}
