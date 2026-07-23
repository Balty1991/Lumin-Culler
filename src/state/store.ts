/**
 * state/store.ts
 * Managementul starii (Zustand) — separat de UI. Include fluxul de comparare
 * a seriilor: alegi cea mai buna poza dintr-un grup de cadre similare.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson } from '../core/db';
import { importFiles, originalFiles, type ImportProgress } from '../core/importPipeline';
import { exportOriginalFiles } from '../core/exportPhotos';
import { exportXMPSidecars } from '../core/export/xmpGenerator';
import { analysisPool } from '../core/workerPool';
import { contextEngine, deriveContextKey } from '../core/learning/ContextEngine';
import { pickBestInGroup } from '../core/groupSelection';
import { pushHistory, popHistory, MAX_HISTORY, type HistoryEvent } from './history';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent } from './batchOps';
import { readStoredTheme, applyTheme, type Theme } from './theme';

export interface PhotoView {
  id: string;
  fileName: string;
  status: PhotoRecord['status'];
  aiScore: number;
  sceneType: AnalysisRecord['sceneType'];
  contextKey: string;
  faceCount: number;
  knownFaceCount: number;
  strangerCount: number;
  bestSmile: number;
  allEyesOpen: boolean;
  sharpness: number;
  exposure: number;
  ruleOfThirds: number;
  headroom: number;
  groupEyesOpenRatio?: number;
  groupSmileRatio?: number;
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
  aiFactors: { feature: string; contribution: number }[];
  personNames: string[];
  groupId?: string;
  capturedAt?: number;
  goldenHourDetected?: boolean;
  dominantColors?: string[];
}

export type FilterKey = 'all' | 'selected' | 'review' | 'rejected' | 'series' | 'blinks';

interface AppState {
  photos: PhotoView[];
  persons: KnownPerson[];
  progress: ImportProgress | null;
  filter: FilterKey;
  detailId: string | null;
  compareGroupId: string | null;
  personsOpen: boolean;
  menuOpen: boolean;
  insightsOpen: boolean;
  workspaceMode: boolean;
  batchOpsOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  booted: boolean;
  /** false daca dispozitivul nu a putut incarca WebGL/WASM — analiza continua dar fara fete reale. */
  aiDegraded: boolean;
  aiBackend: string;
  /**
   * Ultimele decizii manuale (Selecteaza/Respinge), pentru undo — NU include
   * actiunile de grup (keepOnlyInGroup), scop deliberat restrans la interactia
   * cea mai frecventa/predispusa la greseli (un swipe/tap accidental).
   */
  history: HistoryEvent[];

  boot: () => Promise<void>;
  runImport: (files: File[]) => Promise<void>;
  setStatus: (id: string, status: PhotoRecord['status']) => Promise<void>;
  undo: () => Promise<void>;
  keepOnlyInGroup: (groupId: string, keepId: string) => Promise<void>;
  /**
   * Recomandarea AI pentru "cea mai buna" poza dintr-o serie — ierarhie de
   * criterii (claritate > expunere > compozitie > expresii faciale > contact
   * vizual) pe AnalysisRecord complet, nu doar scorul AI brut (vezi
   * core/groupSelection.ts). Nu schimba nimic in DB — doar raspunde cu id-ul
   * recomandat, pentru afisare in UI (GroupCompare).
   */
  selectBestPhotoInGroup: (groupId: string) => Promise<string | null>;
  /** Respinge in bloc pozele nedecise (nu selectate/respinse deja) cu scor sub prag. */
  bulkRejectBelow: (threshold: number) => Promise<{ affected: number }>;
  /** Rezolva TOATE seriile deodata: cea mai buna poza din fiecare ramane, restul se resping. */
  resolveAllSeries: () => Promise<{ groupsResolved: number }>;
  /** Auto-Cull: pastreaza cele mai bune X% (dupa scor) din pozele nedecise, respinge restul. */
  autoCullTopPercent: (percent: number) => Promise<{ selected: number; rejected: number }>;
  setFilter: (f: FilterKey) => void;
  openDetail: (id: string | null) => void;
  openCompare: (groupId: string | null) => void;
  stepDetail: (dir: 1 | -1) => void;
  addPerson: (name: string, files: File[]) => Promise<{ ok: boolean; message: string }>;
  removePerson: (id: string) => Promise<void>;
  setPersonsOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setInsightsOpen: (open: boolean) => void;
  setWorkspaceMode: (on: boolean) => void;
  setBatchOpsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  clearAll: () => Promise<void>;
  /** toast general de stare: rezultat export, avertisment de stocare etc. */
  notice: string | null;
  clearNotice: () => void;
  exportSelection: () => Promise<void>;
  exportManifest: () => Promise<void>;
  exportXMP: () => Promise<void>;
  filtered: () => PhotoView[];
  groupOf: (groupId: string) => PhotoView[];
}

function toView(photo: PhotoRecord, analysis: AnalysisRecord | undefined): PhotoView {
  return {
    id: photo.id,
    fileName: photo.fileName,
    status: photo.status,
    aiScore: analysis?.aiScore ?? 0,
    sceneType: analysis?.sceneType ?? 'detail',
    contextKey: analysis ? deriveContextKey(analysis) : 'detail',
    faceCount: analysis?.faceCount ?? 0,
    knownFaceCount: analysis?.knownFaceCount ?? 0,
    strangerCount: analysis?.strangerCount ?? 0,
    bestSmile: analysis?.bestSmile ?? 0,
    allEyesOpen: analysis?.allEyesOpen ?? true,
    sharpness: analysis?.sharpness ?? 0,
    exposure: analysis?.exposure ?? 0,
    ruleOfThirds: analysis?.ruleOfThirds ?? 0.5,
    headroom: analysis?.headroom ?? 0.5,
    groupEyesOpenRatio: analysis?.groupEyesOpenRatio,
    groupSmileRatio: analysis?.groupSmileRatio,
    iso: analysis?.iso,
    fNumber: analysis?.fNumber,
    exposureTime: analysis?.exposureTime,
    focalLength: analysis?.focalLength,
    aiFactors: analysis?.aiFactors ?? [],
    personNames: analysis
      ? Array.from(new Set(analysis.faces.map(f => f.personName).filter((n): n is string => !!n)))
      : [],
    groupId: photo.groupId,
    capturedAt: photo.capturedAt,
    goldenHourDetected: analysis?.goldenHourDetected,
    dominantColors: analysis?.dominantColors
  };
}

async function train(id: string, userDecision: boolean): Promise<void> {
  const analysis = await db.analyses.get(id);
  if (!analysis) return;
  const aiDecision = analysis.aiScore >= 65;
  await contextEngine.recordCorrection({ photoId: id, analysis, aiDecision, userDecision });
}

/**
 * Pastreaza fisierul original in IndexedDB doar cat timp poza e SELECTATA —
 * altfel exportul "format original" depinde de un File tinut in memorie care
 * dispare la orice reload de tab (frecvent pe mobil, cand browserul descarca
 * tab-urile din fundal ca sa economiseasca RAM). La deselectare, il stergem
 * la loc ca sa nu dublam spatiul ocupat de intregul import.
 */
async function syncOriginal(id: string, status: PhotoRecord['status']): Promise<{ quotaError: boolean }> {
  if (status === 'selected') {
    const file = originalFiles.get(id);
    if (file) {
      try {
        await db.originals.put({ photoId: id, blob: file, fileName: file.name, type: file.type });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') return { quotaError: true };
        throw err;
      }
    }
  } else {
    await db.originals.delete(id);
  }
  return { quotaError: false };
}

const QUOTA_NOTICE = 'Spatiu de stocare plin — fotografia a fost marcata, dar originalul nu a putut fi ' +
  'salvat pentru export. Elibereaza spatiu (Goleste sesiunea sau exporta ce ai deja) si reincearca.';

const STATUS_LABELS: Record<PhotoRecord['status'], string> = {
  pending: 'în așteptare',
  selected: 'selectată',
  rejected: 'respinsă',
  review: 'de verificat'
};

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  persons: [],
  progress: null,
  filter: 'all',
  detailId: null,
  compareGroupId: null,
  personsOpen: false,
  menuOpen: false,
  insightsOpen: false,
  // implicit Workspace (lupa + filmstrip) e ecranul principal la pornire —
  // grila ramane accesibila (buton dedicat), dar nu mai e ce vede utilizatorul
  // intai; ramane fals doar daca utilizatorul comuta explicit inapoi la grila.
  workspaceMode: true,
  batchOpsOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,
  theme: readStoredTheme(),
  setTheme: theme => { applyTheme(theme); set({ theme }); },
  booted: false,
  aiDegraded: false,
  aiBackend: '',
  notice: null,
  history: [],

  boot: async () => {
    if (get().booted) return;
    const [photos, analyses, persons, history] = await Promise.all([
      db.photos.toArray(),
      db.analyses.toArray(),
      db.persons.toArray(),
      db.history.orderBy('ts').toArray()
    ]);
    const byId = new Map(analyses.map(a => [a.photoId, a]));
    const views = photos
      .map(p => toView(p, byId.get(p.id)))
      .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
    set({ photos: views, persons, history, booted: true });
  },

  runImport: async (files: File[]) => {
    set({ progress: { done: 0, total: files.length, fileName: '', phase: 'incarcare' } });
    let warning: string | undefined;
    try {
      await importFiles(
        files,
        progress => { warning = progress.warning; set({ progress: { ...progress } }); },
        item => set(state => ({ photos: [...state.photos, toView(item.photo, item.analysis)] }))
      );
    } catch (err) {
      // fara asta, o promisiune respinsa (ex. retea slaba la incarcarea modelelor AI)
      // lasa bara de progres blocata la "0/N" pentru totdeauna, fara nicio eroare vizibila
      set({
        progress: null,
        notice: 'Import esuat: ' + (err instanceof Error ? err.message : String(err)) + ' — incearca din nou.'
      });
      return;
    }
    // reincarca statusurile si groupId-urile persistate dupa gruparea seriilor
    const fresh = await db.photos.toArray();
    const byId = new Map(fresh.map(p => [p.id, p]));
    const aiDegraded = !analysisPool.isAccelerated;
    set(state => ({
      progress: null,
      notice: warning ?? state.notice,
      aiDegraded,
      aiBackend: analysisPool.detectedBackend,
      photos: state.photos.map(p => {
        const rec = byId.get(p.id);
        return rec ? { ...p, status: rec.status, groupId: rec.groupId } : p;
      })
    }));
  },

  setStatus: async (id, status) => {
    const previousStatus = get().photos.find(p => p.id === id)?.status;
    await db.photos.update(id, { status });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, status } : p)) }));
    const { quotaError } = await syncOriginal(id, status);
    if (quotaError) set({ notice: QUOTA_NOTICE });
    if (status === 'selected' || status === 'rejected') await train(id, status === 'selected');
    if (previousStatus && previousStatus !== status) {
      const event: HistoryEvent = { photoId: id, previousStatus, newStatus: status, ts: Date.now() };
      set(state => ({ history: pushHistory(state.history, event) }));
      await db.history.add(event);
      // pastram doar ultimele MAX_HISTORY si in DB, ca sa nu creasca la nesfarsit
      const all = await db.history.orderBy('ts').toArray();
      if (all.length > MAX_HISTORY) {
        await db.history.bulkDelete(all.slice(0, all.length - MAX_HISTORY).map(r => r.id!));
      }
    }
  },

  /**
   * Anuleaza ultima decizie manuala (pana la MAX_HISTORY in urma). Reverta
   * DOAR statusul pozei (si sincronizarea originalului pentru export) — NU
   * incearca sa "de-antreneze" ContextEngine, care a invatat deja din acea
   * decizie: a inversa curat un pas de gradient online nu e o operatie
   * sigura, iar impactul unui singur pas e oricum mic (regularizare L2 +
   * normalizare Welford). Undo aici inseamna "arata-mi poza ca inainte",
   * nu "sterge ce a invatat modelul".
   */
  undo: async () => {
    const { event, rest } = popHistory(get().history);
    if (!event) { set({ notice: 'Nimic de anulat.' }); return; }
    set({ history: rest });
    await db.photos.update(event.photoId, { status: event.previousStatus });
    set(state => ({
      photos: state.photos.map(p => (p.id === event.photoId ? { ...p, status: event.previousStatus } : p))
    }));
    await syncOriginal(event.photoId, event.previousStatus);
    const lastPersisted = await db.history.orderBy('ts').last();
    if (lastPersisted?.id !== undefined) await db.history.delete(lastPersisted.id);
    const fileName = get().photos.find(p => p.id === event.photoId)?.fileName ?? event.photoId;
    set({ notice: `Anulat: "${fileName}" înapoi la ${STATUS_LABELS[event.previousStatus]}.` });
  },

  /** Fluxul principal de serie: pastreaza o singura poza, respinge restul grupului. */
  keepOnlyInGroup: async (groupId, keepId) => {
    const members = get().photos.filter(p => p.groupId === groupId);
    let quotaError = false;
    for (const m of members) {
      const status = m.id === keepId ? 'selected' : 'rejected';
      await db.photos.update(m.id, { status });
      const res = await syncOriginal(m.id, status);
      if (res.quotaError) quotaError = true;
      await train(m.id, m.id === keepId);
    }
    set(state => ({
      photos: state.photos.map(p =>
        p.groupId === groupId ? { ...p, status: p.id === keepId ? 'selected' : 'rejected' } : p
      ),
      compareGroupId: null,
      notice: quotaError ? QUOTA_NOTICE : state.notice
    }));
  },

  selectBestPhotoInGroup: async groupId => {
    const members = get().photos.filter(p => p.groupId === groupId);
    if (!members.length) return null;
    const analyses = await Promise.all(members.map(m => db.analyses.get(m.id)));
    return pickBestInGroup(members.map((m, i) => {
      const a = analyses[i];
      return {
        id: m.id,
        sharpness: a?.sharpness ?? m.sharpness,
        exposure: a?.exposure ?? m.exposure,
        compositionScore: a?.compositionScore,
        faceCount: m.faceCount,
        bestSmile: m.bestSmile,
        groupSmileRatio: m.groupSmileRatio,
        allEyesOpen: m.allEyesOpen,
        groupEyesOpenRatio: m.groupEyesOpenRatio,
        avgEyeContact: a?.avgEyeContact
      };
    }));
  },

  /**
   * Ca si keepOnlyInGroup, NU genereaza istoric de undo per-poza (ar inunda
   * stiva de 10 la un lot mare) — actiunea are propria confirmare explicita
   * in UI (BatchOpsPanel), cu numarul exact afisat inainte de aplicare.
   */
  bulkRejectBelow: async (threshold) => {
    const targets = selectBulkRejectTargets(get().photos, threshold);
    let quotaError = false;
    for (const p of targets) {
      await db.photos.update(p.id, { status: 'rejected' });
      const res = await syncOriginal(p.id, 'rejected');
      if (res.quotaError) quotaError = true;
      await train(p.id, false);
    }
    const ids = new Set(targets.map(p => p.id));
    set(state => ({
      photos: state.photos.map(p => (ids.has(p.id) ? { ...p, status: 'rejected' } : p)),
      notice: quotaError ? QUOTA_NOTICE : `${targets.length} poze respinse (scor sub ${threshold}).`
    }));
    return { affected: targets.length };
  },

  resolveAllSeries: async () => {
    const resolutions = resolveGroups(get().photos);
    let quotaError = false;
    for (const g of resolutions) {
      const current = get().photos.find(p => p.id === g.keepId);
      if (current?.status !== 'selected') {
        await db.photos.update(g.keepId, { status: 'selected' });
        const res = await syncOriginal(g.keepId, 'selected');
        if (res.quotaError) quotaError = true;
        await train(g.keepId, true);
      }
      for (const rejectId of g.rejectIds) {
        const rec = get().photos.find(p => p.id === rejectId);
        if (rec?.status === 'rejected') continue; // deja rezolvat, sarim (evita re-antrenare redundanta)
        await db.photos.update(rejectId, { status: 'rejected' });
        const res = await syncOriginal(rejectId, 'rejected');
        if (res.quotaError) quotaError = true;
        await train(rejectId, false);
      }
    }
    const keepIds = new Set(resolutions.map(g => g.keepId));
    const rejectIds = new Set(resolutions.flatMap(g => g.rejectIds));
    set(state => ({
      photos: state.photos.map(p => {
        if (keepIds.has(p.id)) return { ...p, status: 'selected' };
        if (rejectIds.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      notice: quotaError ? QUOTA_NOTICE : `${resolutions.length} serii rezolvate.`
    }));
    return { groupsResolved: resolutions.length };
  },

  /** Ca si celelalte operatii in masa, fara istoric per-poza (confirmare proprie in UI). */
  autoCullTopPercent: async (percent) => {
    const { selectIds, rejectIds } = selectTopPercent(get().photos, percent);
    let quotaError = false;
    for (const id of selectIds) {
      await db.photos.update(id, { status: 'selected' });
      const res = await syncOriginal(id, 'selected');
      if (res.quotaError) quotaError = true;
      await train(id, true);
    }
    for (const id of rejectIds) {
      await db.photos.update(id, { status: 'rejected' });
      const res = await syncOriginal(id, 'rejected');
      if (res.quotaError) quotaError = true;
      await train(id, false);
    }
    const selectSet = new Set(selectIds);
    const rejectSet = new Set(rejectIds);
    set(state => ({
      photos: state.photos.map(p => {
        if (selectSet.has(p.id)) return { ...p, status: 'selected' };
        if (rejectSet.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      notice: quotaError ? QUOTA_NOTICE : `Auto-Cull: ${selectIds.length} selectate, ${rejectIds.length} respinse.`
    }));
    return { selected: selectIds.length, rejected: rejectIds.length };
  },

  setFilter: f => set({ filter: f }),
  openDetail: id => set({ detailId: id }),
  openCompare: groupId => set({ compareGroupId: groupId }),

  stepDetail: dir => {
    const { detailId } = get();
    const list = get().filtered();
    if (!detailId || !list.length) return;
    const idx = list.findIndex(p => p.id === detailId);
    const next = list[(idx + dir + list.length) % list.length];
    set({ detailId: next.id });
  },

  addPerson: async (name, files) => {
    await analysisPool.init();
    const embeddings: number[][] = [];
    for (const file of files.slice(0, 4)) {
      try {
        const bitmap = await createImageBitmap(file, { resizeWidth: 1024 } as ImageBitmapOptions);
        const emb = await analysisPool.computeEnrollmentEmbedding(bitmap);
        if (emb && emb.length) embeddings.push(emb);
      } catch (err) {
        console.error('Inrolare esuata:', err);
      }
    }
    if (!embeddings.length) {
      return { ok: false, message: 'Nicio fata detectata in pozele de referinta. Alege poze clare, frontale.' };
    }
    const person: KnownPerson = { id: crypto.randomUUID(), name, embeddings, updatedAt: Date.now() };
    await db.persons.put(person);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons);
    set({ persons });
    return { ok: true, message: name + ': ' + embeddings.length + ' referinte salvate.' };
  },

  removePerson: async id => {
    await db.persons.delete(id);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons });
  },

  setPersonsOpen: open => set({ personsOpen: open }),
  setMenuOpen: open => set({ menuOpen: open }),
  setInsightsOpen: open => set({ insightsOpen: open }),
  setWorkspaceMode: on => set({ workspaceMode: on, detailId: on ? get().detailId : null }),
  setBatchOpsOpen: open => set({ batchOpsOpen: open }),
  setPaletteOpen: open => set({ paletteOpen: open }),
  setShortcutsOpen: open => set({ shortcutsOpen: open }),
  clearNotice: () => set({ notice: null }),

  clearAll: async () => {
    await Promise.all([
      db.photos.clear(), db.thumbnails.clear(), db.previews.clear(), db.originals.clear(),
      db.analyses.clear(), db.history.clear()
    ]);
    originalFiles.clear();
    set({ photos: [], detailId: null, compareGroupId: null, history: [] });
  },

  /** Exporta pozele selectate ca fisiere reale, in formatul original (JPEG/PNG/etc), grupate pe subfoldere. */
  exportSelection: async () => {
    const selected = get().photos.filter(p => p.status === 'selected');
    if (!selected.length) return;
    try {
      const result = await exportOriginalFiles(selected.map(p => ({
        id: p.id,
        fileName: p.fileName,
        personNames: p.personNames,
        faceCount: p.faceCount,
        strangerCount: p.strangerCount,
        sceneType: p.sceneType
      })));
      if (result.cancelled) return;
      const parts = [
        result.exported
          ? `${result.exported} poze exportate` + (
              result.method === 'folder' ? ' in subfoldere (persoane/scenă), în folderul ales.'
              : ' (descărcări individuale, denumite cu prefix de grup — subfolderele reale depind de suportul browserului).'
            )
          : 'Nicio poza nu a putut fi exportata in format original.'
      ];
      if (result.missing.length) {
        parts.push(`${result.missing.length} nu mai erau disponibile (importate inainte de ultima actualizare) — reimporta-le pentru export.`);
      }
      set({ notice: parts.join(' ') });
    } catch (err) {
      set({ notice: 'Export esuat: ' + String(err) });
    }
  },

  /** Lista JSON cu numele fisierelor selectate — util pentru selectie-dupa-nume in Lightroom. */
  exportManifest: async () => {
    const selected = get().photos.filter(p => p.status === 'selected');
    const payload = {
      exportedAt: new Date().toISOString(),
      count: selected.length,
      files: selected.map(p => p.fileName)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selectie-lumin-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    // NU revocam imediat — pe Android managerul de descarcari citeste blob:
    // URL-ul asincron, in fundal; o revocare instant poate rupe transferul
    // cu "Eroare de retea" (bug real gasit la exportul de poze/XMP, acelasi
    // tipar). Lasam browserul sa curete URL-ul natural la reincarcare.
  },

  /**
   * Exporta sidecar-uri XMP (rating + eticheta de culoare) pentru TOATE pozele
   * decise (selectate/respinse/de verificat) — nu doar selectia, spre deosebire
   * de exportSelection. Nu copiaza nicio poza: fisierele .xmp trebuie asezate
   * langa originalele deja existente pe disc (acelasi nume, alta extensie) ca
   * Lightroom/Bridge sa le asocieze automat.
   */
  exportXMP: async () => {
    const decided = get().photos.filter(p => p.status !== 'pending');
    if (!decided.length) { set({ notice: 'Nicio poza cu decizie luata inca — Selecteaza/Respinge cel putin una.' }); return; }
    try {
      const result = await exportXMPSidecars(decided.map(p => ({ fileName: p.fileName, status: p.status })));
      if (result.cancelled) return;
      const msg = result.exported
        ? `${result.exported} sidecar-uri XMP exportate` + (
            result.method === 'folder' ? ' in folderul ales — copiaza-le langa pozele originale ca Lightroom sa le vada.'
            : ' (descarcari individuale) — muta-le langa pozele originale ca Lightroom sa le vada.'
          )
        : 'Niciun sidecar XMP nu a putut fi exportat.';
      set({ notice: msg });
    } catch (err) {
      set({ notice: 'Export XMP esuat: ' + String(err) });
    }
  },

  filtered: () => {
    const { photos, filter } = get();
    switch (filter) {
      case 'selected': return photos.filter(p => p.status === 'selected');
      case 'review': return photos.filter(p => p.status === 'review');
      case 'rejected': return photos.filter(p => p.status === 'rejected');
      case 'blinks': return photos.filter(p => p.faceCount > 0 && !p.allEyesOpen);
      case 'series': {
        const withGroup = photos.filter(p => p.groupId);
        return withGroup.sort((a, b) =>
          a.groupId === b.groupId ? b.aiScore - a.aiScore : (a.groupId! < b.groupId! ? -1 : 1)
        );
      }
      default: return photos;
    }
  },

  groupOf: groupId =>
    get().photos.filter(p => p.groupId === groupId).sort((a, b) => b.aiScore - a.aiScore)
}));
