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
 *
 * `settings` (v2) acopera preferintele de UI/organizare care traiesc in
 * localStorage (deci sunt izolate per-browser, spre deosebire de Dexie care
 * e cel putin per-profil): sortarea grilei, presetarile de culling, genul
 * activ etc. Fara ele, doi fotografi care lucreaza alternativ din Brave si
 * Chrome (sau doua profiluri) vedeau ordini de sortare si praguri de
 * Auto-Cull diferite, desi modelul AI si persoanele erau restaurate corect —
 * acesta e motivul principal pentru care rezultatele de culling pareau sa
 * difere intre browsere (modelul ContextEngine, cold-start intr-un browser
 * nou, scoreaza altfel decat unul deja antrenat in celalalt).
 */
import { db, type KnownPerson, type ContextModelRecord, type PhotoRecord, type EmbeddingMemoryRecord, type TagMemoryRecord } from './db';
import { contextEngine } from './learning/ContextEngine';
import { analysisPool } from './workerPool';
import { readGridSort, writeGridSort, type GridSort } from '../state/gridSort';
import { readGridDensity, writeGridDensity, type GridDensity } from '../state/gridDensity';
import { readStoredGenre, writeStoredGenre } from '../state/genre';
import { listCullingPresets, type CullingPreset } from '../state/cullingPresets';
import { readApplyEditsInGallery, writeApplyEditsInGallery } from '../state/applyEditsPreference';
import { readStoredWatermarkText, writeWatermarkText } from '../state/watermarkText';
import { readStoredProjectName, writeProjectName } from '../state/projectName';
import { readStoredRenameTemplate, writeStoredRenameTemplate } from './renameTemplate';
import { type ProjectMetadata } from '../state/projectMetadata';

const BACKUP_VERSION = 2;

const CULLING_PRESETS_KEY = 'lumin-culling-presets';
const PROJECT_METADATA_KEY = 'lumin-project-metadata';

export interface BackupPhotoDecision {
  fileName: string;
  capturedAt?: number;
  status: PhotoRecord['status'];
  rating?: number;
}

/**
 * Preferinte de UI/organizare, altfel izolate per-browser (localStorage).
 * Toate campurile sunt optionale: un backup restaurat partial (ex. utilizatorul
 * a sters manual una din chei) nu trebuie sa strice restul restaurarii.
 */
export interface BackupSettings {
  gridSort?: GridSort;
  gridDensity?: GridDensity;
  genre?: string;
  cullingPresets?: CullingPreset[];
  applyEditsInGallery?: boolean;
  watermarkText?: string;
  projectName?: string;
  renameTemplate?: string;
  projectMetadata?: Record<string, ProjectMetadata>;
}

export interface BackupData {
  version: 1 | 2;
  exportedAt: number;
  persons: KnownPerson[];
  contextModels: ContextModelRecord[];
  photoDecisions: BackupPhotoDecision[];
  /**
   * Memoria de continut ("cu ce seamana pozele pe care le pastrezi", vezi
   * learning/embeddingMemory.ts) — tot preferinta invatata, deci apartine
   * backup-ului alaturi de ponderi. Absenta pe backup-uri facute inainte sa
   * existe: restaurarea o sare pur si simplu, nu esueaza.
   */
  embeddingMemory?: EmbeddingMemoryRecord;
  /** Memoria de subiecte (learning/tagMemory.ts) — acelasi rationament ca mai sus. */
  tagMemory?: TagMemoryRecord;
  /** Absent pe backup-uri v1 (compatibilitate cu fisiere exportate inainte de acest camp). */
  settings?: BackupSettings;
}

function readProjectMetadataAll(): Record<string, ProjectMetadata> {
  try {
    const raw = localStorage.getItem(PROJECT_METADATA_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeProjectMetadataAll(all: Record<string, ProjectMetadata>): void {
  try {
    localStorage.setItem(PROJECT_METADATA_KEY, JSON.stringify(all));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — se aplica doar pentru sesiunea curenta
  }
}

function buildSettings(): BackupSettings {
  return {
    gridSort: readGridSort(),
    gridDensity: readGridDensity(),
    genre: readStoredGenre() || undefined,
    cullingPresets: listCullingPresets(),
    applyEditsInGallery: readApplyEditsInGallery(),
    watermarkText: readStoredWatermarkText() || undefined,
    projectName: readStoredProjectName() || undefined,
    renameTemplate: readStoredRenameTemplate() || undefined,
    projectMetadata: readProjectMetadataAll()
  };
}

/** Scrie setarile restaurate direct in localStorage — apelantul (store.ts) le re-citeste apoi in starea Zustand. */
function applySettings(settings: BackupSettings): void {
  if (settings.gridSort) writeGridSort(settings.gridSort);
  if (settings.gridDensity) writeGridDensity(settings.gridDensity);
  if (settings.genre !== undefined) writeStoredGenre(settings.genre);
  if (settings.cullingPresets) {
    try {
      localStorage.setItem(CULLING_PRESETS_KEY, JSON.stringify(settings.cullingPresets));
    } catch {
      // stocare indisponibila (mod privat strict etc.) — restul backup-ului tot se restaureaza
    }
  }
  if (settings.applyEditsInGallery !== undefined) writeApplyEditsInGallery(settings.applyEditsInGallery);
  if (settings.watermarkText !== undefined) writeWatermarkText(settings.watermarkText);
  if (settings.projectName !== undefined) writeProjectName(settings.projectName);
  if (settings.renameTemplate !== undefined) writeStoredRenameTemplate(settings.renameTemplate);
  if (settings.projectMetadata) writeProjectMetadataAll(settings.projectMetadata);
}

export function backupFileName(): string {
  return `lumin-culler-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function buildBackup(): Promise<BackupData> {
  const [persons, contextModels, photos, embeddingMemory, tagMemory] = await Promise.all([
    db.persons.toArray(),
    db.contextModels.toArray(),
    db.photos.toArray(),
    db.embeddingMemory.get('current'),
    db.tagMemory.get('current')
  ]);
  // doar pozele cu o decizie reala (status diferit de "pending") sau cu rating —
  // restul (poze inca nedecise) nu au nimic de "restaurat"
  const photoDecisions: BackupPhotoDecision[] = photos
    .filter(p => p.status !== 'pending' || (p.rating ?? 0) > 0)
    .map(p => ({ fileName: p.fileName, capturedAt: p.capturedAt, status: p.status, rating: p.rating }));
  return {
    version: BACKUP_VERSION, exportedAt: Date.now(), persons, contextModels, photoDecisions,
    settings: buildSettings(),
    ...(embeddingMemory ? { embeddingMemory } : {}),
    ...(tagMemory ? { tagMemory } : {})
  };
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
    // v1 (fara `settings`) si v2 sunt ambele acceptate la import — un backup mai
    // vechi tot restaureaza persoanele/modelele/deciziile, doar fara setari de UI.
    ((parsed as BackupData).version !== 1 && (parsed as BackupData).version !== BACKUP_VERSION) ||
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
  settingsRestored: boolean;
}

/** amprenta unei poze pentru potrivire intre sesiuni — id-ul (UUID) nu supravietuieste unui reimport. */
function fingerprint(p: { fileName: string; capturedAt?: number }): string {
  return `${p.fileName}|${p.capturedAt ?? 0}`;
}

/**
 * Bug real gasit de auditul QA (atomicitate): scrierile de mai jos (persons +
 * contextModels + bucla de decizii per-poza) rulau in afara oricarei
 * tranzactii Dexie — o intrerupere la mijloc (tab inchis, eroare
 * QuotaExceededError neasteptata, care lipsea complet din acest fisier spre
 * deosebire de importPipeline.ts/store.ts syncOriginal) putea lasa persons
 * restaurate dar contextModels nu (sau invers), si/sau doar unele decizii
 * aplicate — stare partiala, fara rollback. `db.transaction` face toate
 * scrierile din interior atomice: ori toate reusesc, ori (la orice eroare)
 * niciuna nu se aplica.
 */
export async function restoreBackup(data: BackupData): Promise<RestoreResult> {
  let decisionsMatched = 0;
  await db.transaction('rw', [db.persons, db.contextModels, db.photos, db.embeddingMemory, db.tagMemory], async () => {
    if (data.persons.length) await db.persons.bulkPut(data.persons);
    if (data.contextModels.length) await db.contextModels.bulkPut(data.contextModels);
    if (data.embeddingMemory) await db.embeddingMemory.put(data.embeddingMemory);
    if (data.tagMemory) await db.tagMemory.put(data.tagMemory);

    // Bug real gasit de auditul QA (coliziuni de amprenta): daca doua poze
    // CURENTE au acelasi nume+data capturii (plauzibil la unirea mai multor
    // carduri de memorie cu suprapunere de nume/timp de burst), un Map cheie
    // unica pastra doar ultima — cealalta nu primea niciodata decizia
    // restaurata, silentios. Acum tinem TOATE potrivirile per amprenta si
    // aplicam decizia restaurata identic pe fiecare — conservator (nu putem
    // distinge cert intre ele din amprenta), dar niciuna nu mai e ignorata.
    const currentPhotos = await db.photos.toArray();
    const byFingerprint = new Map<string, PhotoRecord[]>();
    for (const p of currentPhotos) {
      const key = fingerprint(p);
      const bucket = byFingerprint.get(key);
      if (bucket) bucket.push(p); else byFingerprint.set(key, [p]);
    }
    for (const d of data.photoDecisions) {
      const matches = byFingerprint.get(fingerprint(d));
      if (!matches) continue;
      for (const match of matches) {
        if (match.status === d.status && (match.rating ?? 0) === (d.rating ?? 0)) continue;
        await db.photos.update(match.id, { status: d.status, rating: d.rating });
        decisionsMatched++;
      }
    }
  });

  // ContextEngine tine modelele in cache, in memorie — fara reload() ar continua
  // sa foloseasca (si sa suprascrie la urmatoarea corectie) versiunea veche
  await contextEngine.reload();
  if (analysisPool.isReady) {
    await analysisPool.setKnownPersons(await db.persons.toArray()).catch(() => {});
  }

  if (data.settings) applySettings(data.settings);

  return {
    personsRestored: data.persons.length,
    modelsRestored: data.contextModels.length,
    decisionsMatched,
    decisionsTotal: data.photoDecisions.length,
    settingsRestored: !!data.settings
  };
}
