/**
 * Ecranul de setări e al treilea tab, nu un sertar.
 * Stă în afara store-ului mare ca să nu amestece panourile Pro cu navigația.
 */
import { useSyncExternalStore } from 'react';

let settingsOpen = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(listener => listener());
}

export function setLuminSettingsOpen(open: boolean): void {
  if (settingsOpen === open) return;
  settingsOpen = open;
  emit();
}

export function useLuminSettingsOpen(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => settingsOpen
  );
}
