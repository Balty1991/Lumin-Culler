/**
 * state/groupByPeople.ts
 * Daca "Toate" se grupeaza pe persoane — vezi state/libraryGroups.ts.
 *
 * Pornit din start, ca notificarile si stilul de editare: o grupare pe care
 * trebuie intai s-o gasesti intr-un meniu nu ajuta pe nimeni. Cine o vrea
 * plata o opreste dintr-o atingere, si refuzul se tine minte.
 *
 * Nu face nimic pana nu exista o persoana inrolata, deci pentru un utilizator
 * nou comutatorul pornit nu schimba absolut nimic.
 */
const KEY = 'lumin-group-by-people';

export function readGroupByPeople(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function writeGroupByPeople(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ramane pe sesiune */ }
}
