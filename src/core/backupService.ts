/**
 * core/backupService.ts
 * Backup local automat + restaurare (planul de dezvoltare, 2.3.4 "Managementul
 * datelor si sincronizare") — exporta ce e cu-adevarat greu de refacut:
 * persoanele cunoscute (profiluri faciale inrolate manual) si modelele
 * ContextEngine (preferintele AI invatate din corectii). NU include miniaturi/
 * preview-uri/originale (blob-uri mari, regenerabile prin reimport) si nici
 * `corrections` brute (istoricul de antrenament e deja "topit" in ponderile
 * din contextModels — restaurarea lor separat ar risca coliziuni de ++id cu
 * corectii deja existente in DB-ul tinta, fara niciun beneficiu suplimentar).
 *
 * Deciziile per-poza (status/rating) sunt incluse best-effort, identificate
 * prin "amprenta" fisierului (nume + data capturii) — id-ul real (UUID) NU se
 * pastreaza intre sesiuni/dispozitive diferite, deci nu poate fi folosit ca
 * cheie de potrivire. Utile pentru: recuperare dupa stergerea accidentala a
 * datelor browserului, sau migrarea preferintelor pe un profil/dispozitiv nou
 * inainte de a reimporta acelasi folder de poze.
 */
import { db, type KnownPerson, type ContextModelRecord, type PhotoRecord } from './db';
import { contextEngine } from './learning/ContextEngine';
import { analysisPool } from './workerPool';

const BACKUP_VERSION = 1;

export interface BackupPhotoDecision {
  fileName: string;
  capturedAt?: number;
  status: PhotoRecord['status'];
  rating?: number;
}

export interface BackupData {
  version: 1;
  exportedAt: number;
  persons: KnownPerson[];
  contextModels: ContextModelRecord[];
  photoDecisions: BackupPhotoDecision[];
}

export function backupFileName(): string {
  return `lumin-culler-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function buildBackup(): Promise<BackupData> {
  const [persons, contextModels, photos] = await Promise.all([
    db.persons.toArray(),
    db.contextModels.toArray(),
    db.photos.toArray()
  ]);
  // doar pozele cu o decizie reala (status diferit de "pending") sau cu rating —
  // restul (poze inca nedecise) nu au nimic de "restaurat"
  const photoDecisions: BackupPhotoDecision[] = photos
    .filter(p => p.status !== 'pending' || (p.rating ?? 0) > 0)
    .map(p => ({ fileName: p.fileName, capturedAt: p.capturedAt, status: p.status, rating: p.rating }));
  return { version: BACKUP_VERSION, exportedAt: Date.now(), persons, contextModels, photoDecisions };
}

export async function parseBackupFile(file: File): Promise<BackupData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Fisierul ales nu este un JSON valid.');
  }
  if (
    !parsed || typeof parsed !== 'object' ||
    (parsed as BackupData).version !== BACKUP_VERSION ||
    !Array.isArray((parsed as BackupData).persons) ||
    !Array.isArray((parsed as BackupData).contextModels) ||
    !Array.isArray((parsed as BackupData).photoDecisions)
  ) {
    throw new Error('Fisier de backup nerecunoscut sau dintr-o versiune incompatibila.');
  }
  return parsed as BackupData;
}

export interface RestoreResult {
  personsRestored: number;
  modelsRestored: number;
  decisionsMatched: number;
  decisionsTotal: number;
}

/** amprenta unei poze pentru potrivire intre sesiuni — id-ul (UUID) nu supravietuieste unui reimport. */
function fingerprint(p: { fileName: string; capturedAt?: number }): string {
  return `${p.fileName}|${p.capturedAt ?? 0}`;
}

export async function restoreBackup(data: BackupData): Promise<RestoreResult> {
  await Promise.all([
    data.persons.length ? db.persons.bulkPut(data.persons) : Promise.resolve(),
    data.contextModels.length ? db.contextModels.bulkPut(data.contextModels) : Promise.resolve()
  ]);
  // ContextEngine tine modelele in cache, in memorie — fara reload() ar continua
  // sa foloseasca (si sa suprascrie la urmatoarea corectie) versiunea veche
  await contextEngine.reload();
  if (analysisPool.isReady) {
    await analysisPool.setKnownPersons(await db.persons.toArray()).catch(() => {});
  }

  const currentPhotos = await db.photos.toArray();
  const byFingerprint = new Map(currentPhotos.map(p => [fingerprint(p), p]));
  let decisionsMatched = 0;
  for (const d of data.photoDecisions) {
    const match = byFingerprint.get(fingerprint(d));
    if (!match) continue;
    if (match.status === d.status && (match.rating ?? 0) === (d.rating ?? 0)) continue;
    await db.photos.update(match.id, { status: d.status, rating: d.rating });
    decisionsMatched++;
  }

  return {
    personsRestored: data.persons.length,
    modelsRestored: data.contextModels.length,
    decisionsMatched,
    decisionsTotal: data.photoDecisions.length
  };
}
