/**
 * state/store.ts
 * Managementul starii (Zustand) — separat de UI. Include fluxul de comparare
 * a seriilor: alegi cea mai buna poza dintr-un grup de cadre similare.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson } from '../core/db';
import { importFiles, originalFiles, type ImportProgress } from '../core/importPipeline';
import { exportOriginalFiles } from '../core/exportPhotos';
import { analysisPool } from '../core/workerPool';
import { contextEngine, deriveContextKey } from '../core/learning/ContextEngine';

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
  personNames: string[];
  groupId?: string;
  capturedAt?: number;
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
  booted: boolean;

  boot: () => Promise<void>;
  runImport: (files: File[]) => Promise<void>;
  setStatus: (id: string, status: PhotoRecord['status']) => Promise<void>;
  keepOnlyInGroup: (groupId: string, keepId: string) => Promise<void>;
  setFilter: (f: FilterKey) => void;
  openDetail: (id: string | null) => void;
  openCompare: (groupId: string | null) => void;
  stepDetail: (dir: 1 | -1) => void;
  addPerson: (name: string, files: File[]) => Promise<{ ok: boolean; message: string }>;
  removePerson: (id: string) => Promise<void>;
  setPersonsOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setInsightsOpen: (open: boolean) => void;
  clearAll: () => Promise<void>;
  exportMessage: string | null;
  exportSelection: () => Promise<void>;
  exportManifest: () => Promise<void>;
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
    personNames: analysis
      ? Array.from(new Set(analysis.faces.map(f => f.personName).filter((n): n is string => !!n)))
      : [],
    groupId: photo.groupId,
    capturedAt: photo.capturedAt
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
async function syncOriginal(id: string, status: PhotoRecord['status']): Promise<void> {
  if (status === 'selected') {
    const file = originalFiles.get(id);
    if (file) await db.originals.put({ photoId: id, blob: file, fileName: file.name, type: file.type });
  } else {
    await db.originals.delete(id);
  }
}

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
  booted: false,
  exportMessage: null,

  boot: async () => {
    if (get().booted) return;
    const [photos, analyses, persons] = await Promise.all([
      db.photos.toArray(),
      db.analyses.toArray(),
      db.persons.toArray()
    ]);
    const byId = new Map(analyses.map(a => [a.photoId, a]));
    const views = photos
      .map(p => toView(p, byId.get(p.id)))
      .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
    set({ photos: views, persons, booted: true });
  },

  runImport: async (files: File[]) => {
    set({ progress: { done: 0, total: files.length, fileName: '', phase: 'analiza' } });
    await importFiles(
      files,
      progress => set({ progress: { ...progress } }),
      item => set(state => ({ photos: [...state.photos, toView(item.photo, item.analysis)] }))
    );
    // reincarca statusurile si groupId-urile persistate dupa gruparea seriilor
    const fresh = await db.photos.toArray();
    const byId = new Map(fresh.map(p => [p.id, p]));
    set(state => ({
      progress: null,
      photos: state.photos.map(p => {
        const rec = byId.get(p.id);
        return rec ? { ...p, status: rec.status, groupId: rec.groupId } : p;
      })
    }));
  },

  setStatus: async (id, status) => {
    await db.photos.update(id, { status });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, status } : p)) }));
    await syncOriginal(id, status);
    if (status === 'selected' || status === 'rejected') await train(id, status === 'selected');
  },

  /** Fluxul principal de serie: pastreaza o singura poza, respinge restul grupului. */
  keepOnlyInGroup: async (groupId, keepId) => {
    const members = get().photos.filter(p => p.groupId === groupId);
    for (const m of members) {
      const status = m.id === keepId ? 'selected' : 'rejected';
      await db.photos.update(m.id, { status });
      await syncOriginal(m.id, status);
      await train(m.id, m.id === keepId);
    }
    set(state => ({
      photos: state.photos.map(p =>
        p.groupId === groupId ? { ...p, status: p.id === keepId ? 'selected' : 'rejected' } : p
      ),
      compareGroupId: null
    }));
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

  clearAll: async () => {
    await Promise.all([
      db.photos.clear(), db.thumbnails.clear(), db.previews.clear(), db.originals.clear(), db.analyses.clear()
    ]);
    originalFiles.clear();
    set({ photos: [], detailId: null, compareGroupId: null });
  },

  /** Exporta pozele selectate ca fisiere reale, in formatul original (JPEG/PNG/etc). */
  exportSelection: async () => {
    const selected = get().photos.filter(p => p.status === 'selected');
    if (!selected.length) return;
    try {
      const result = await exportOriginalFiles(selected.map(p => ({ id: p.id, fileName: p.fileName })));
      if (result.cancelled) return;
      const parts = [
        result.exported
          ? `${result.exported} poze exportate` + (result.method === 'folder' ? ' in folderul ales.' : ' (descarcari individuale).')
          : 'Nicio poza nu a putut fi exportata in format original.'
      ];
      if (result.missing.length) {
        parts.push(`${result.missing.length} nu mai erau disponibile (importate inainte de ultima actualizare) — reimporta-le pentru export.`);
      }
      set({ exportMessage: parts.join(' ') });
    } catch (err) {
      set({ exportMessage: 'Export esuat: ' + String(err) });
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
    URL.revokeObjectURL(url);
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
