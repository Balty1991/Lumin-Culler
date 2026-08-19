/**
 * state/protectedPersons.ts
 *
 * "Pe copil sa nu mi-l arunci niciodata."
 *
 * Operatiile in masa sunt cele care sperie: Auto-Cull respinge tot ce e sub un
 * prag, "rezolva toate seriile" pastreaza un cadru din fiecare. Amandoua sunt
 * corecte statistic si amandoua pot arunca exact poza la care tii — una unde
 * copilul rade, dar e putin miscata, deci are scor mic.
 *
 * Protectia rezolva asta fara sa strice nimic din motor: pozele in care apare
 * o persoana protejata sunt SCOASE din tinta operatiilor automate. Nu sunt
 * pastrate cu forta, nu li se umfla scorul, nu se atinge invatarea — doar nu se
 * resping singure. Utilizatorul le poate respinge oricand manual: protectia e
 * fata de automatizare, nu fata de el.
 *
 * Alegerea nu poate fi tacuta si nu poate fi implicita: se face pe persoane pe
 * care utilizatorul le-a inrolat el insusi, iar interfata trebuie sa spuna
 * cate poze sunt scoase din calcul, altfel "am apasat Auto-Cull si n-a facut
 * mare lucru" devine un mister.
 */

const KEY = 'lumin-protected-persons';

export function readProtectedPersons(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0));
  } catch {
    return new Set();
  }
}

export function writeProtectedPersons(names: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...names])); } catch {
    // stocare indisponibila — protectia tine cat sesiunea; nu blocam nimic
  }
}

/** Minimul din PhotoView de care are nevoie verificarea. */
export interface ProtectablePhoto {
  personNames: string[];
}

/** Poza contine cel putin o persoana protejata. */
export function isProtected(photo: ProtectablePhoto, protectedNames: Set<string>): boolean {
  if (!protectedNames.size) return false;
  return photo.personNames.some(n => protectedNames.has(n));
}

/**
 * Scoate din `targets` pozele protejate.
 *
 * Se aplica DUPA ce operatia si-a ales tintele, nu inainte: asa protectia
 * ramane un singur filtru, in acelasi loc, in loc sa fie strecurata in fiecare
 * selector in parte — unde ar fi fost uitata la urmatorul adaugat.
 */
export function excludeProtected<T extends ProtectablePhoto>(targets: T[], protectedNames: Set<string>): T[] {
  if (!protectedNames.size) return targets;
  return targets.filter(p => !isProtected(p, protectedNames));
}

/** Cate poze ar fi scoase dintr-o operatie. Pentru mesajul dinaintea apasarii. */
export function countProtected(targets: ProtectablePhoto[], protectedNames: Set<string>): number {
  if (!protectedNames.size) return 0;
  return targets.reduce((n, p) => n + (isProtected(p, protectedNames) ? 1 : 0), 0);
}
