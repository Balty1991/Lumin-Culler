/**
 * core/zenMode.ts
 * "Mod Zen" (plan modernizare) — cand e activ, dupa fiecare import aplicatia
 * ruleaza automat state/zenResolve.ts pe grupurile detectate: cele "confident"
 * (diferenta clara de scor AI, fara poze cu multe fete) sunt rezolvate singure,
 * cele "incerte" raman nedecise si sunt doar semnalate — vezi runZenResolve
 * (state/store.ts) si ui/ZenModePanel.tsx pentru ecranul dedicat.
 *
 * Doua comutatoare secundare (implicit ambele pornite, ca in mockup):
 * - autoDeleteObvious: grupurile confidente sunt si sterse nativ (nu doar
 *   marcate respinse) — Android tot cere o confirmare a sistemului, aplicatia
 *   doar nu mai adauga un dialog propriu peste ea.
 * - askOnUncertain: grupurile incerte sunt semnalate printr-o notificare in
 *   aplicatie (nu decise automat), in loc sa fie ignorate tacut.
 */
const MODE_KEY = 'lumin-zen-mode';
const AUTO_DELETE_KEY = 'lumin-zen-auto-delete';
const ASK_UNCERTAIN_KEY = 'lumin-zen-ask-uncertain';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch {
    // stocare indisponibila (mod privat strict etc.) — setarea tot se aplica pentru sesiunea curenta
  }
}

export function readZenMode(): boolean {
  return readFlag(MODE_KEY, false);
}

export function writeZenMode(on: boolean): void {
  writeFlag(MODE_KEY, on);
}

/** Implicit PORNIT (ca in mockup) — doar cand utilizatorul chiar il opreste explicit ramane oprit. */
export function readZenAutoDeleteObvious(): boolean {
  return readFlag(AUTO_DELETE_KEY, true);
}

export function writeZenAutoDeleteObvious(on: boolean): void {
  writeFlag(AUTO_DELETE_KEY, on);
}

/** Implicit PORNIT (ca in mockup) — vezi readZenAutoDeleteObvious. */
export function readZenAskOnUncertain(): boolean {
  return readFlag(ASK_UNCERTAIN_KEY, true);
}

export function writeZenAskOnUncertain(on: boolean): void {
  writeFlag(ASK_UNCERTAIN_KEY, on);
}
