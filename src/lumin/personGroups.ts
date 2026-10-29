/**
 * lumin/personGroups.ts
 * Oamenii pe grupuri: Familie, Prieteni, Colegi. Ținute pe telefon, pe nume;
 * din ele, pe pagina Oameni, filtrul de grup și albumul comun al grupului.
 */
export type PersonGroup = 'family' | 'friends' | 'work';
export const PERSON_GROUPS: PersonGroup[] = ['family', 'friends', 'work'];
const KEY = 'lumin-person-groups';

export function readPersonGroups(): Record<string, PersonGroup> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, PersonGroup>; } catch { return {}; }
}
export function setPersonGroup(name: string, group: PersonGroup | null): void {
  const all = readPersonGroups();
  if (group) all[name] = group; else delete all[name];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}
