import type { MotiveGrupare, DovadaBanda } from '../workers/hashCompare.worker';

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
    // Banda de dovada e OPTIONALA: lipseste din intrarile scrise inainte de ea.
    // Daca e prezenta dar stricata, o scoatem in loc sa aruncam tot — restul
    // motivelor raman citibile, iar zerourile n-ar spune "n-a existat semnal",
    // ci ar minti ca s-a masurat si n-a gasit nimic.
    const cheiDovada: (keyof DovadaBanda)[] = [
      'faraSemnal', 'peFete', 'peImagine', 'subPragAproape', 'subPragMediu', 'subPragDeparte'
    ];
    const d = m.dovada as Partial<DovadaBanda> | undefined;
    const dovadaValida = !!d && typeof d === 'object'
      && cheiDovada.every(k => typeof d[k] === 'number' && Number.isFinite(d[k]));
    return { ...(m as MotiveGrupare), dovada: dovadaValida ? (d as DovadaBanda) : undefined };
  } catch {
    return null;
  }
}

export function clearGroupingMotive(): void {
  try { localStorage.removeItem(KEY); } catch { /* la fel ca mai sus */ }
}
