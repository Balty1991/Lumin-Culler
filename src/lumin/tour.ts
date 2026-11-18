/**
 * lumin/tour.ts
 * A văzut omul turul aplicației (AppTour.tsx)? Ținut separat ca pornirea să
 * poată întreba fără să încarce ecranul turului.
 */
const DONE_KEY = 'lumin-tour-done';

export function tourDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; }
}

export function markTourDone(): void {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* fără stocare: turul revine, nu e grav */ }
}

const FIRST_DAY_KEY = 'lumin-first-open-day';

/**
 * E momentul turului? Nu la primul import: atunci omul vede abia primele lui poze alese
 * (primul „aha”), iar un tur de 8 pași peste ele i-l acoperea. Turul vine după prima
 * sortare terminată, sau din a doua zi, dacă n-a sortat încă.
 */
export function tourDue(sortedDays: number, now = Date.now()): boolean {
  if (sortedDays > 0) return true;
  const today = new Date(now).toDateString();
  try {
    const first = localStorage.getItem(FIRST_DAY_KEY);
    if (!first) { localStorage.setItem(FIRST_DAY_KEY, today); return false; }
    return first !== today;
  } catch {
    return true;
  }
}
