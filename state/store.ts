/**
 * state/store.ts
 * Managementul starii (Zustand) — complet separat de componentele UI.
 * Componentele doar citesc starea si apeleaza actiuni; toata logica e aici
 * sau in serviciile din core/.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson } from '../core/db';
import { importFiles, type ImportProgress } from '../core/importPipeline';
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

export type FilterKey = 'all' | 'selected' | 'rejected' | 'review' | 'known' | 'strangers' | 'blinks';

interface AppState {
  photos: PhotoView[];
  persons: KnownPerson[];
  progress: ImportProgress | null;
  filter: FilterKey;
  detailId: string | null;
  personsOpen: boolean;
  booted: boolean;

  boot: () => Promise<void>;
  runImport: (files: File[]) => Promise<void>;
  setStatus: (id: string, status: PhotoRecord['status']) => Promise<void>;
  setFilter: (f: FilterKey) => void;
  openDetail: (id: string | null) => void;
  stepDetail: (dir: 1 | -1) => void;
  addPerson: (name: string, files: File[]) => Promise<{ ok: boolean; message: string }>;
  removePerson: (id: string) => Promise<void>;
  setPersonsOpen: (open: boolean) => void;
  clearAll: () => Promise<void>;
  exportSelection: () => Promise<void>;
  filtered: () => PhotoView[];
}

function toView(photo: PhotoRecord, analysis: AnalysisRecord | undefined, groupId?: string): PhotoView {
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
    groupId,
    capturedAt: photo.capturedAt
  };
}

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  persons: [],
  progress: null,
  filter: 'all',
  detailId: null,
  personsOpen: false,
  booted: false,

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
    const added: PhotoView[] = [];
    const groups = await importFiles(
      files,
      progress => set({ progress: { ...progress } }),
      item => {
        added.push(toView(item.photo, item.analysis));
        set(state => ({ photos: [...state.photos, toView(item.photo, item.analysis)] }));
      }
    );
    // aplica groupId + statusurile actualizate dupa gruparea duplicatelor
    const fresh = await db.photos.toArray();
    const statusById = new Map(fresh.map(p => [p.id, p.status]));
    set(state => ({
      progress: null,
      photos: state.photos.map(p => ({
        ...p,
        groupId: groups.get(p.id) ?? p.groupId,
        status: statusById.get(p.id) ?? p.status
      }))
    }));
  },

  setStatus: async (id, status) => {
    const analysis = await db.analyses.get(id);
    const photo = await db.photos.get(id);
    if (!photo) return;
    const previous = photo.status;
    await db.photos.update(id, { status });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, status } : p)) }));

    // Invatare: orice decizie manuala select/reject antreneaza ContextEngine
    if (analysis && (status === 'selected' || status === 'rejected')) {
      const aiDecision = analysis.aiScore >= 65;
      const userDecision = status === 'selected';
      await contextEngine.recordCorrection({ photoId: id, analysis, aiDecision, userDecision });
      void previous;
    }
  },

  setFilter: f => set({ filter: f }),
  openDetail: id => set({ detailId: id }),

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
    return { ok: true, message: name + ': ' + embeddings.length + ' referinte salvate. Pozele viitoare vor fi recunoscute.' };
  },

  removePerson: async id => {
    await db.persons.delete(id);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons });
  },

  setPersonsOpen: open => set({ personsOpen: open }),

  clearAll: async () => {
    await Promise.all([db.photos.clear(), db.thumbnails.clear(), db.analyses.clear()]);
    set({ photos: [], detailId: null });
  },

  exportSelection: async () => {
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
      case 'rejected': return photos.filter(p => p.status === 'rejected');
      case 'review': return photos.filter(p => p.status === 'review');
      case 'known': return photos.filter(p => p.knownFaceCount > 0);
      case 'strangers': return photos.filter(p => p.strangerCount > 0);
      case 'blinks': return photos.filter(p => p.faceCount > 0 && !p.allEyesOpen);
      default: return photos;
    }
  }
}));
