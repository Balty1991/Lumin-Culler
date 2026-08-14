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
  /**
   * Cate inregistrari au fost SARITE fiindca nu aveau forma asteptata — vezi
   * validatoarele de mai jos. Optionale: apelantii existenti (store.ts) le pot
   * ignora, dar exista ca restaurarea sa nu poata minti tacut despre ce a scris.
   */
  personsSkipped?: number;
  modelsSkipped?: number;
  decisionsSkipped?: number;
}

/**
 * Bug real gasit de auditul QA, si cel mai grav din acest fisier: pana aici,
 * SINGURA verificare facuta pe un fisier de backup era `Array.isArray` pe cele
 * trei liste (parseBackupFile) — continutul lor ajungea NEVALIDAT direct in
 * `db.persons.bulkPut` / `db.contextModels.bulkPut` / `db.photos.update`.
 *
 * Reprodus, nu presupus:
 *  - un `contextModels: [{ contextKey: 'landscape' }]` (intrare fara `weights`/
 *    `featureStats` — exact ce produce un fisier trunchiat la descarcare, un
 *    backup dintr-un format mai vechi, sau unul deschis si re-salvat de un
 *    editor) se restaura "cu succes", iar de la urmatoarea poza scorata
 *    ContextEngine.predict() arunca `TypeError: Cannot read properties of
 *    undefined (reading 'sharpness')`. Inregistrarea stricata e PERSISTATA in
 *    IndexedDB, deci eroarea supravietuieste oricarui reload: scorarea AI
 *    ramane moarta definitiv pentru acel context, fara nicio cale de reparare
 *    din interfata (nici macar reimportul pozelor);
 *  - un `persons: [{ id, name }]` fara `embeddings` se restaura la fel de
 *    tacut, iar setKnownPersons il trimitea asa in worker-ul de recunoastere;
 *  - un `photoDecisions: [{ status: 'GUNOI', rating: 'x' }]` scria literal
 *    `status: 'GUNOI'` pe PhotoRecord — o poza care nu mai apare in niciun
 *    filtru (nici pending, nici selected/rejected/review) si care nu mai poate
 *    fi readusa la o stare valida decat prin reimport.
 *
 * Politica aleasa e cea deja declarata pentru BackupSettings mai sus ("un
 * backup restaurat partial nu trebuie sa strice restul restaurarii"): fiecare
 * inregistrare invalida e SARITA si numarata, restul se restaureaza normal.
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Un dictionar plat de numere finite (weights, si valorile numerice din featureStats). */
function isNumberRecord(v: unknown): v is Record<string, number> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v as Record<string, unknown>).every(isFiniteNumber);
}

function isValidFeatureStats(v: unknown): v is ContextModelRecord['featureStats'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    s => !!s && typeof s === 'object' && isFiniteNumber((s as { mean?: unknown }).mean)
      && isFiniteNumber((s as { m2?: unknown }).m2) && isFiniteNumber((s as { n?: unknown }).n)
  );
}

function isValidContextModel(v: unknown): v is ContextModelRecord {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.contextKey === 'string' && m.contextKey.length > 0
    && isNumberRecord(m.weights) && isValidFeatureStats(m.featureStats)
    && isFiniteNumber(m.bias) && isFiniteNumber(m.sampleCount) && m.sampleCount >= 0;
}

function isValidPerson(v: unknown): v is KnownPerson {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && p.id.length > 0 && typeof p.name === 'string'
    // `length > 0`: un profil inrolat FARA nicio referinta faciala nu poate
    // potrivi nimic niciodata — e o intrare stricata, nu una goala legitima.
    && Array.isArray(p.embeddings) && p.embeddings.length > 0
    && p.embeddings.every(e => Array.isArray(e) && e.length > 0 && e.every(isFiniteNumber));
}

const VALID_STATUSES: readonly PhotoRecord['status'][] = ['pending', 'selected', 'rejected', 'review'];

function isValidDecision(v: unknown): v is BackupPhotoDecision {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return typeof d.fileName === 'string'
    && (d.capturedAt === undefined || isFiniteNumber(d.capturedAt))
    && (VALID_STATUSES as readonly unknown[]).includes(d.status)
    && (d.rating === undefined || isFiniteNumber(d.rating));
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
  // Vezi isValidContextModel/isValidPerson/isValidDecision mai sus pentru ce
  // anume strica o singura inregistrare nevalidata ajunsa in IndexedDB.
  const persons = data.persons.filter(isValidPerson);
  const contextModels = data.contextModels.filter(isValidContextModel);
  const decisions = data.photoDecisions.filter(isValidDecision);

  await db.transaction('rw', [db.persons, db.contextModels, db.photos, db.embeddingMemory, db.tagMemory], async () => {
    if (persons.length) await db.persons.bulkPut(persons);
    if (contextModels.length) await db.contextModels.bulkPut(contextModels);
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
    for (const d of decisions) {
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
    // Numarul REAL scris, nu lungimea listei din fisier — altfel notice-ul din
    // store.ts ar raporta "N persoane restaurate" inclusiv pentru intrari sarite.
    personsRestored: persons.length,
    modelsRestored: contextModels.length,
    decisionsMatched,
    decisionsTotal: decisions.length,
    settingsRestored: !!data.settings,
    personsSkipped: data.persons.length - persons.length,
    modelsSkipped: data.contextModels.length - contextModels.length,
    decisionsSkipped: data.photoDecisions.length - decisions.length
  };
}
