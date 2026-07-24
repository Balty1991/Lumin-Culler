/**
 * state/projectMetadata.ts
 * "Metadate personalizate" (plan 2.3.5): nume client, tip eveniment, locatie —
 * atasate proiectului (numele de sesiune din PhotoRecord.project), nu fiecarei
 * poze individual, fiindca in practica sunt aceleasi pentru toata sesiunea.
 * Persistate local (JSON in localStorage, cheie = numele proiectului) — nu
 * sunt parte din Dexie, la fel ca celelalte preferinte de organizare (genre,
 * gridDensity). Folosite in exportul XMP (xmpGenerator.ts) ca metadate
 * suplimentare, cautabile si prin dc:subject keywords.
 */
export interface ProjectMetadata {
  client?: string;
  event?: string;
  location?: string;
}

const STORAGE_KEY = 'lumin-project-metadata';

function readAll(): Record<string, ProjectMetadata> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // JSON corupt sau stocare indisponibila
  }
}

function writeAll(all: Record<string, ProjectMetadata>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — se aplica doar pentru sesiunea curenta
  }
}

export function getProjectMetadata(project: string): ProjectMetadata {
  return readAll()[project] ?? {};
}

export function setProjectMetadata(project: string, meta: ProjectMetadata): void {
  const all = readAll();
  const cleaned: ProjectMetadata = {
    client: meta.client?.trim() || undefined,
    event: meta.event?.trim() || undefined,
    location: meta.location?.trim() || undefined
  };
  if (!cleaned.client && !cleaned.event && !cleaned.location) {
    delete all[project];
  } else {
    all[project] = cleaned;
  }
  writeAll(all);
}
