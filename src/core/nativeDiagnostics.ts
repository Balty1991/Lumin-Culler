/**
 * core/nativeDiagnostics.ts
 * Punte catre DiagnosticsPlugin.kt — cum s-a terminat rularea precedenta.
 *
 * De ce exista: aplicatia se inchidea in timpul analizei, si nimic nu ne spunea
 * unde. Cand procesul e omorat de o eroare NATIVA (SIGSEGV in MediaPipe sau ML
 * Kit) nu exista exceptie de prins in JS sau in Java — procesul dispare, si cu
 * el orice jurnal tinut in memorie.
 *
 * Partea nativa scrie fiecare apel de model pe disc, la intrare si la iesire
 * (vezi plugins/CrashLog.kt). La pornirea urmatoare intrebam aici ce a ramas
 * deschis: acela e modelul in care a murit.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface LastRunReport {
  /** true daca rularea precedenta a lasat un pas deschis — adica a fost omorata. */
  crashed: boolean;
  /** Numele pasului ramas deschis, ex. "FaceMesh" sau "Decodare". */
  crashedAt: string | null;
  /** Tot jurnalul, pentru cazurile in care numele singur nu ajunge. */
  steps: string[];
}

interface DiagnosticsPluginApi {
  lastRun(): Promise<LastRunReport>;
  clearLastRun(): Promise<void>;
}

const DiagnosticsNative = registerPlugin<DiagnosticsPluginApi>('Diagnostics');

function disponibil(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Diagnostics');
}

export async function lastRunReport(): Promise<LastRunReport | null> {
  if (!disponibil()) return null;
  try {
    const raport = await DiagnosticsNative.lastRun();
    return raport.steps?.length ? raport : null;
  } catch {
    return null;
  }
}

/** Se cheama DUPA ce raportul a fost aratat, ca sa nu revina la fiecare pornire. */
export async function forgetLastRun(): Promise<void> {
  if (!disponibil()) return;
  try {
    await DiagnosticsNative.clearLastRun();
  } catch {
    /* nimic de facut: raportul e un ajutor, nu o functie a produsului */
  }
}
