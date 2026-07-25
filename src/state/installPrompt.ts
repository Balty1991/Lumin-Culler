/**
 * state/installPrompt.ts
 * Persistarea "utilizatorul a inchis bannerul de instalare" (ui/InstallPrompt.tsx) —
 * o data respins, nu mai revenim cu el la fiecare vizita (naging). Acelasi tipar
 * ca projectName.ts/theme.ts.
 */
const STORAGE_KEY = 'lumin-install-prompt-dismissed';

export function readInstallPromptDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeInstallPromptDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // stocare indisponibila (mod privat strict etc.) — bannerul poate reveni la urmatoarea vizita
  }
}
