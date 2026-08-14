/**
 * state/cullingPresets.ts
 * "Presetari de culling" (plan 3.2.3) — praguri reutilizabile pentru operatiile
 * in masa (BatchOpsPanel): un fotograf de nunti si unul de sport vor praguri
 * diferite de respingere/Auto-Cull; salvarea unei presetari evita re-reglarea
 * manuala a slider-elor la fiecare sesiune noua. Persistate local (JSON in
 * localStorage) — nu sunt date de biblioteca (Dexie), doar preferinte de UI.
 */
export interface CullingPreset {
  id: string;
  name: string;
  /** prag Auto-Cull: pastreaza cele mai bune X% din pozele nedecise. */
  cullPercent: number;
  /** prag "respinge sub": scorul AI sub care o poza nedecisa e propusa spre respingere. */
  rejectThreshold: number;
  /**
   * Sablon de redenumire la export (vezi core/renameTemplate.ts) — o presetare
   * de tip "Nunta" refoloseste probabil acelasi format de nume la fiecare
   * eveniment nou. Optional: absent pe presetarile mai vechi (dinainte de
   * acest camp) sau daca utilizatorul n-a completat niciun sablon la salvare —
   * la aplicare, absenta inseamna "nu schimba sablonul curent".
   */
  renameTemplate?: string;
  /** Genul fotografic (vezi state/genre.ts) tipic asociat acestei presetari. Optional, acelasi motiv ca renameTemplate. */
  genre?: string;
  createdAt: number;
}

const STORAGE_KEY = 'lumin-culling-presets';
const MAX_PRESETS = 12;

/**
 * Bug real gasit de auditul QA: readAll() verifica DOAR ca valoarea stocata e
 * un array, nu si ca fiecare element e o presetare reala — spre deosebire de
 * state/savedFilters.ts (isValidPreset), care valideaza structural fiecare
 * intrare. Consecinta concreta, nu teoretica: cu o singura intrare partiala in
 * localStorage (`[{"id":"x"}]`), saveCullingPreset() arunca
 * `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`
 * la filtrul dupa nume — adica salvarea ORICAREI presetari noi devine
 * imposibila pentru tot restul sesiunii, fara nicio cale de recuperare din UI.
 *
 * Nu e nevoie de editare manuala a localStorage ca sa se ajunga acolo:
 * core/backupService.ts (applySettings) scrie `settings.cullingPresets`
 * DIRECT, verbatim, din JSON-ul unui fisier de backup, fara nicio validare —
 * deci un backup dintr-o versiune mai veche/trunchiat/editat de om otraveste
 * cheia. O intrare invalida e sarita, restul raman utilizabile.
 */
function isValidPreset(v: unknown): v is CullingPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string'
    && typeof p.cullPercent === 'number' && typeof p.rejectThreshold === 'number'
    && typeof p.createdAt === 'number' && Number.isFinite(p.createdAt)
    && (p.renameTemplate === undefined || typeof p.renameTemplate === 'string')
    && (p.genre === undefined || typeof p.genre === 'string');
}

function readAll(): CullingPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidPreset) : [];
  } catch {
    return []; // JSON corupt sau stocare indisponibila — pornim de la o lista goala
  }
}

function writeAll(presets: CullingPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — presetarea tot se aplica pentru sesiunea curenta
  }
}

export function listCullingPresets(): CullingPreset[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

/** Salveaza sau suprascrie (dupa nume, insensibil la majuscule) o presetare — cel mai recent salvat cu acelasi nume o inlocuieste. */
export function saveCullingPreset(
  name: string,
  cullPercent: number,
  rejectThreshold: number,
  extra?: { renameTemplate?: string; genre?: string }
): CullingPreset[] {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return listCullingPresets();
  const existing = readAll().filter(p => p.name.toLowerCase() !== trimmed.toLowerCase());
  const preset: CullingPreset = {
    id: crypto.randomUUID(), name: trimmed, cullPercent, rejectThreshold,
    renameTemplate: extra?.renameTemplate || undefined,
    genre: extra?.genre || undefined,
    createdAt: Date.now()
  };
  const next = [preset, ...existing].slice(0, MAX_PRESETS);
  writeAll(next);
  return listCullingPresets();
}

export function deleteCullingPreset(id: string): CullingPreset[] {
  writeAll(readAll().filter(p => p.id !== id));
  return listCullingPresets();
}
