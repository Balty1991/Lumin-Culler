/**
 * core/thermalStatus.ts
 * Cat de cald e telefonul, si ce face aplicatia cu asta.
 *
 * Punte catre plugin-ul Capacitor local Thermal (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/ThermalPlugin.kt).
 *
 * DE CE. Un import de 2000 de poze tine procesorul la maxim vreo opt minute.
 * Pe flux sustinut, de la treapta "moderata" in sus, sistemul coboara singur
 * frecventele — 30-40% din debit, cu telefonul incalzindu-se in continuare.
 * `PowerManager` nu aparea nicaieri in proiect: se impingea la fel de tare si
 * la rece, si la fierbinte, iar a doua jumatate a unui import lung se petrecea
 * exact acolo.
 *
 * Ce NU face plafonul de mai jos: nu incetineste analiza. La treapta moderata
 * procesorul livreaza oricum mai putin decat cer patru poze in zbor; ce se
 * schimba e ca aplicatia nu mai adauga presiune peste un SoC care deja da
 * inapoi. Scorurile raman identice — se schimba doar cate poze sunt in lucru
 * deodata, la fel ca la comutatorul de mod economic.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * Treptele PowerManager.THERMAL_STATUS_* din Android, cu numele lor.
 * NONE=0, LIGHT=1, MODERATE=2, SEVERE=3, CRITICAL=4, EMERGENCY=5, SHUTDOWN=6.
 */
export const THERMAL_MODERATE = 2;

/**
 * Cate poze in zbor sunt permise de la "moderata" in sus.
 *
 * 2, adica exact valoarea conservatoare de dinainte de ridicarea plafonului
 * (vezi nativeAnalysisConcurrency in workerPool.ts) — o cifra care a mers luni
 * intregi pe telefoane reale, nu una inventata acum pentru cazul cald.
 */
export const THERMAL_THROTTLED_CONCURRENCY = 2;

interface ThermalPluginApi {
  status(): Promise<{ supported: boolean; status: number }>;
  watch(): Promise<{ supported: boolean; status?: number }>;
  addListener(event: 'thermalChange', handler: (data: { status: number }) => void): Promise<{ remove: () => Promise<void> }>;
}

const Thermal = registerPlugin<ThermalPluginApi>('Thermal');

export function isThermalStatusAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Thermal');
}

/**
 * Plafonul de concurenta impus de temperatura, sau null cand temperatura nu
 * cere nimic (rece, sau necunoscuta).
 *
 * `null` inseamna "nu am de spus nimic", NU "e rece": pe un telefon fara API-ul
 * termic (sub Android 10) sau pe web, apelantul trebuie sa ramana exact cum
 * era, nu sa presupuna ceva.
 */
export function thermalConcurrencyCap(status: number | null): number | null {
  if (status === null) return null;
  return status >= THERMAL_MODERATE ? THERMAL_THROTTLED_CONCURRENCY : null;
}

/** Treapta curenta, sau null daca nu se poate sti. */
export async function readThermalStatus(): Promise<number | null> {
  if (!isThermalStatusAvailable()) return null;
  try {
    const answer = await Thermal.status();
    return answer.supported ? answer.status : null;
  } catch {
    // Un plugin care nu raspunde nu are voie sa opreasca un import.
    return null;
  }
}

/**
 * Anunta `onChange` la fiecare schimbare de treapta, si o data cu valoarea
 * curenta. Intoarce o functie de oprire.
 *
 * Ascultator, nu interogare periodica: fiecare apel de plugin intra tot prin
 * firul unic al puntii Capacitor (chiar daca lucrul in sine pleaca de acolo pe
 * firul plugin-ului — vezi PluginWork.kt), deci o intrebare per poza s-ar aseza
 * exact in coada pe care incearca s-o scurteze.
 */
export async function watchThermalStatus(onChange: (status: number) => void): Promise<() => void> {
  if (!isThermalStatusAvailable()) return () => {};
  try {
    const started = await Thermal.watch();
    if (!started.supported) return () => {};
    if (typeof started.status === 'number') onChange(started.status);
    const handle = await Thermal.addListener('thermalChange', data => onChange(data.status));
    return () => { void handle.remove(); };
  } catch {
    return () => {};
  }
}
