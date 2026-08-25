/**
 * state/activeFilter.ts
 *
 * Ce filtru era deschis in biblioteca, tinut peste reporniri.
 *
 * Bug raportat cu doua capturi la cinci minute distanta: aplicatia minimizata,
 * apoi redeschisa, si benzile planului de lucru ("COMPARA ATENT", "DECIZI TU")
 * disparusera — grila arata tot, inclusiv pozele deja decise.
 *
 * Nu benzile se stricasera. Ele se taie DOAR pe filtrul 'review' (vezi
 * planStarts in App.tsx, si motivul de acolo: pe orice alta ordine
 * separatoarele ar sari inainte si inapoi prin lista). Ce se pierduse era
 * FILTRUL: Android recupereaza memoria omorand WebView-ul aplicatiilor din
 * fundal, Capacitor reincarca pagina la revenire, si tot store-ul Zustand
 * porneste de la valorile initiale. Pozele supravietuiesc in IndexedDB, dar
 * locul in care erai, nu.
 *
 * Se pastreaza doar filtrul, nu si restul starii de sesiune: e singurul lucru
 * pe care omul l-a ALES explicit si se asteapta sa-l regaseasca. Panourile
 * deschise, selectia in masa sau coada de sortare sunt stari de moment — a le
 * invia la pornire ar fi mai deconcertant decat a le pierde.
 */
import type { FilterKey } from './store';

const STORAGE_KEY = 'lumin-active-filter';

/** Aceleasi valori ca FilterKey — verificate la citire, ca o cheie veche/stricata sa nu strice pornirea. */
const VALID: readonly FilterKey[] = [
  'all', 'selected', 'candidate', 'review', 'rejected',
  'series', 'blinks', 'blurry', 'goldenHour', 'highlights'
];

export function readActiveFilter(): FilterKey {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(raw as FilterKey) ? raw as FilterKey : 'all';
  } catch {
    return 'all';
  }
}

export function writeActiveFilter(value: FilterKey): void {
  try {
    // 'all' e valoarea implicita: nu merita o intrare in stocare pentru ea.
    if (value === 'all') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // stocare indisponibila — filtrul tine cat sesiunea curenta, ca inainte
  }
}
