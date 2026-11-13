/**
 * core/crashGuard.ts
 * O poză care închide aplicația (o eroare nativă în ML Kit sau MediaPipe, raportat:
 * „Închidere neașteptată la: ImageLabeling”) nu trebuie să o închidă la nesfârșit.
 *
 * Cât o poză e în analiză nativă, adresa ei stă scrisă pe disc. Dacă aplicația moare,
 * la pornirea următoare adresele rămase scrise primesc câte un punct. O poză cu două
 * puncte (a fost de față la două închideri) e sărită de citirea galeriei.
 */
const INFLIGHT_KEY = 'cp.crash.inflight';
const COUNT_KEY = 'cp.crash.count';
export const CRASH_SKIP_AFTER = 2;

const inflight = new Set<string>();

function readCounts(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(COUNT_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function save(): void {
  try { localStorage.setItem(INFLIGHT_KEY, JSON.stringify([...inflight])); } catch { /* fără stocare */ }
}

/** La pornire: ce era în lucru când a murit procesul primește un punct. */
export function settlePreviousRun(): void {
  try {
    const left = JSON.parse(localStorage.getItem(INFLIGHT_KEY) ?? '[]') as string[];
    if (left.length) {
      const counts = readCounts();
      for (const uri of left) counts[uri] = (counts[uri] ?? 0) + 1;
      const kept = Object.entries(counts).slice(-200);
      localStorage.setItem(COUNT_KEY, JSON.stringify(Object.fromEntries(kept)));
    }
    localStorage.removeItem(INFLIGHT_KEY);
  } catch { /* fără stocare */ }
}
if (typeof localStorage !== 'undefined') settlePreviousRun();

export function markInFlight(uri: string | undefined): void { if (uri) { inflight.add(uri); save(); } }
export function clearInFlight(uri: string | undefined): void { if (uri && inflight.delete(uri)) save(); }

/** Pozele care au fost de față la cel puțin două închideri: citirea galeriei le sare. */
export function crashSkippedUris(): Set<string> {
  const counts = readCounts();
  return new Set(Object.entries(counts).filter(([, n]) => n >= CRASH_SKIP_AFTER).map(([u]) => u));
}
