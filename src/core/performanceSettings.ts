/**
 * core/performanceSettings.ts
 * Comutator "mod economic" — reduce presiunea pe CPU/RAM la analiza AI, util pe
 * hardware slab (laptopuri vechi, 4GB RAM): pool de un singur worker (in loc de
 * pana la 4 in paralel) si dezactiveaza iris+emotie in Human.js (mai putina
 * inferenta per poza). Persistat local, citit direct de workerPool.ts la
 * init() — worker-ii au config FIXA la spawn, deci o schimbare a acestui
 * comutator dupa ce pool-ul e deja pornit necesita reincarcarea paginii.
 */
const STORAGE_KEY = 'lumin-economic-mode';

export function readEconomicMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeEconomicMode(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // stocare indisponibila (mod privat strict etc.) — setarea tot se aplica pentru sesiunea curenta
  }
}
