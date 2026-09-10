import type { MotiveGrupare } from '../workers/hashCompare.worker';

/**
 * core/groupingDiagnostics.ts
 * De ce n-au ajuns împreună pozele pe care omul le vede ca serie.
 *
 * Există pentru că răspunsul "nu mai detectează corect toate seriile" nu se
 * poate da din citit codul. Am verificat două bănuieli — pragul de timp și
 * `capturedAtExact` — și amândouă au căzut. Aceeași metodă care a lămurit
 * viteza, după trei diagnostice greșite: se măsoară, nu se presupune.
 *
 * Se păstrează ULTIMA grupare, nu o medie: gruparea rulează o dată per import,
 * iar întrebarea e mereu despre importul care tocmai s-a terminat.
 */
const KEY = 'lumin-grouping-motive';

export function writeGroupingMotive(m: MotiveGrupare): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {
    // stocare indisponibilă — diagnosticul e util, nu esențial
  }
}

export function readGroupingMotive(): MotiveGrupare | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const m = parsed as Partial<MotiveGrupare>;
    // Toate câmpurile sunt numere: o intrare scrisă de o versiune mai veche
    // (sau stricată de mână) nu are voie să scoată ecranul din funcțiune.
    const chei: (keyof MotiveGrupare)[] = [
      'legatVizual', 'legatRafala', 'legatMoment',
      'respinsPreaDiferit', 'respinsPreaDeparteInTimp', 'respinsAltSubiect', 'respinsAltLoc'
    ];
    if (!chei.every(k => typeof m[k] === 'number' && Number.isFinite(m[k]))) return null;
    return m as MotiveGrupare;
  } catch {
    return null;
  }
}

export function clearGroupingMotive(): void {
  try { localStorage.removeItem(KEY); } catch { /* la fel ca mai sus */ }
}
