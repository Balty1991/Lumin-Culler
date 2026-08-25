/**
 * core/activePersons.ts
 *
 * Care profiluri de persoana sunt ACTIVE pentru recunoastere, fara abonament.
 *
 * Problema, ridicata de utilizator: cineva se aboneaza o luna, isi inroleaza
 * toti oamenii de care are nevoie, apoi renunta — si ramane cu ei pentru
 * totdeauna. Recunoasterea ruleaza la FIECARE import viitor, deci o luna de
 * abonament cumpara valoare permanenta.
 *
 * Solutia nu e stergerea. Aplicatia are deja un principiu scris, la dosarul
 * privat: "un abonament expirat n-are voie sa incuie pe cineva in afara
 * propriilor poze". Embeddingurile alea sunt munca omului — le-a facut el,
 * alegand poze de referinta.
 *
 * Se separa deci DATELE de SERVICIU. Profilurile raman toate: vizibile,
 * exportabile, stergibile, si se reactiveaza instant la reabonare. Ce se
 * opreste fara abonament e calculul care ruleaza la fiecare import — adica
 * exact lucrul pe care il platesti lunar. Datele sunt ale tale; calculul
 * continuu e produsul.
 *
 * Cine ramane activ e ALEGEREA utilizatorului, nu prima inrolare cronologic.
 * Diferenta e de ton: altfel aplicatia decide in locul lui, si aproape sigur
 * gresit — persoana care conteaza cel mai mult rareori e prima adaugata.
 */
import type { KnownPerson } from './db';
import { isPremium, FREE_ENROLLED_PERSONS } from './entitlement';

const STORAGE_KEY = 'lumin-active-persons';

/** Id-urile pe care utilizatorul le-a ales sa ramana active la gratuit. */
export function readPreferredActive(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writePreferredActive(ids: string[]): void {
  try {
    if (!ids.length) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // stocare indisponibila — se cade pe ordinea de inrolare, ca si cum n-ar fi ales nimic
  }
}

/**
 * Profilurile care chiar ajung la motorul de recunoastere.
 *
 * Cu abonament: toate. Fara: primele `FREE_ENROLLED_PERSONS`, in ordinea
 * ALEASA de utilizator, iar pentru restul dupa vechimea inrolarii — ca sa
 * existe un raspuns stabil si inainte ca cineva sa fi ales ceva.
 *
 * `enrolledAt` lipseste pe inregistrarile facute inainte de acest camp; se
 * cade pe `updatedAt`, care pentru ele e cel mai apropiat lucru de un moment
 * al inrolarii. Fara migrare.
 */
export function selectActivePersons(persons: KnownPerson[]): KnownPerson[] {
  if (isPremium()) return persons;
  const preferred = readPreferredActive();
  const rank = (p: KnownPerson): number => {
    const chosen = preferred.indexOf(p.id);
    // alesii intai, in ordinea alegerii; restul dupa, dupa vechime
    return chosen >= 0 ? chosen : preferred.length + (p.enrolledAt ?? p.updatedAt);
  };
  return [...persons].sort((a, b) => rank(a) - rank(b)).slice(0, FREE_ENROLLED_PERSONS);
}

/** Profilurile pastrate, dar adormite — pentru marcajul din panou. */
export function dormantPersons(persons: KnownPerson[]): KnownPerson[] {
  const active = new Set(selectActivePersons(persons).map(p => p.id));
  return persons.filter(p => !active.has(p.id));
}
