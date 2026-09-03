/**
 * core/formatTime.ts
 * Formatare compacta a unui numar de secunde ramase (ETA analiza AI) — vezi
 * state/store.ts (runImport, calculul etaSeconds) si App.tsx/Workspace.tsx.
 */
export function formatEta(totalSeconds: number): string {
  const s = Math.max(1, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/**
 * O durata LUNGA, spusa cum o spune un om: "3 h 20 min", "18 min", "45 s".
 *
 * De ce nu `formatEta` de mai sus. Aceea e facuta pentru o estimare care se
 * scurge sub ochii tai — minute si secunde, actualizate din secunda in secunda —
 * si e potrivita exact acolo. Pusa pe un total cumulat, insa, scrie "700m 0s"
 * pentru unsprezece ore si jumatate: nu e gresit, dar nimeni nu citeste asa
 * ceva ca pe unsprezece ore, si tocmai cifra aia trebuie sa se inteleaga dintr-o
 * privire (vezi ui/LifetimeProof.tsx).
 *
 * Secundele dispar de la un minut in sus si minutele de la o ora in sus cand
 * sunt zero: "2 h" e mai usor de citit decat "2 h 0 min", si nu pierde nimic.
 * Unitatile raman scurte (h/min/s) fiindca se citesc la fel in romana si in
 * engleza — o cheie de dictionar pentru fiecare ar fi adaugat sase siruri
 * pentru un castig de zero.
 */
export function formatSpan(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
}
