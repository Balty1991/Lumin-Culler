/**
 * core/zenMode.ts
 * "Mod Zen" (plan modernizare) — cand e activ, dupa fiecare import aplicatia
 * ruleaza automat aceeasi rezolvare de serii ca butonul manual "Rezolva toate
 * seriile" din BatchOpsPanel, fara sa astepte un click. Deliberat NU schimba
 * niciun criteriu de decizie, doar cand se declanseaza rezolvarea.
 */
const STORAGE_KEY = 'lumin-zen-mode';

export function readZenMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeZenMode(on: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch {
    // stocare indisponibila (mod privat strict etc.) — setarea tot se aplica pentru sesiunea curenta
  }
}
