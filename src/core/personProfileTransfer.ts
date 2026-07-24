/**
 * core/personProfileTransfer.ts
 * "Import/export profiluri" (plan 3.2.3, PersonsPanel) — export/import pentru
 * persoane INDIVIDUALE (sau o selectie), distinct de backupService.ts (care
 * exporta TOT: persoane + modele AI + decizii). Util cand vrei sa muti doar
 * un profil ("Ami") intre doua instalari de browser, fara sa atingi restul.
 */
import type { KnownPerson } from './db';

const VERSION = 1;

export interface PersonProfileExport {
  version: 1;
  exportedAt: number;
  persons: { name: string; embeddings: number[][] }[];
}

function sanitizeForFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'persoana';
}

export function buildPersonProfilesExport(persons: KnownPerson[]): PersonProfileExport {
  return {
    version: VERSION,
    exportedAt: Date.now(),
    persons: persons.map(p => ({ name: p.name, embeddings: p.embeddings }))
  };
}

export function personProfilesFileName(persons: KnownPerson[]): string {
  if (persons.length === 1) return `lumin-culler-persoana-${sanitizeForFileName(persons[0].name)}.json`;
  return `lumin-culler-persoane-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function parsePersonProfilesFile(file: File): Promise<PersonProfileExport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Fisierul ales nu este un JSON valid.');
  }
  const data = parsed as Partial<PersonProfileExport>;
  if (
    !data || typeof data !== 'object' || data.version !== VERSION || !Array.isArray(data.persons) ||
    !data.persons.every(p => typeof p?.name === 'string' && Array.isArray(p.embeddings))
  ) {
    throw new Error('Fisier de profil nerecunoscut sau dintr-o versiune incompatibila.');
  }
  return data as PersonProfileExport;
}
