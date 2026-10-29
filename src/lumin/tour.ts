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
