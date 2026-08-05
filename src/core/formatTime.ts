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
