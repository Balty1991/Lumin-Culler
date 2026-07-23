/**
 * state/projectName.ts
 * Numele sesiunii/proiectului curent (ex: "Nunta Ana & Mihai", "Client X — sedinta foto") —
 * util pentru freelanceri care lucreaza in paralel la mai multe importuri/clienti si se pot
 * pierde intre tab-uri identice. Persistat local, nu se sincronizeaza cu pozele (nu e stocat
 * in Dexie) — e doar o eticheta de orientare in interfata.
 */
const STORAGE_KEY = 'lumin-project-name';

export function readStoredProjectName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeProjectName(name: string): void {
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — numele tot se aplica pentru sesiunea curenta
  }
}
