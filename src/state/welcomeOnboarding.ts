/**
 * state/welcomeOnboarding.ts
 * Persistarea "utilizatorul a vazut deja ecranul de bun venit" (ui/WelcomeOnboarding.tsx)
 * — o data vazut (fie parcurs pana la capat, fie inchis din X/Escape), nu mai
 * revine la vizitele urmatoare. Acelasi tipar ca installPrompt.ts/projectName.ts.
 */
const STORAGE_KEY = 'lumin-welcome-seen';

export function readWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeWelcomeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // stocare indisponibila (mod privat strict etc.) — ecranul poate reveni la urmatoarea vizita
  }
}
