import type { AutoSortResult } from './autoSort';
import { create } from 'zustand';
import { closeWithTransition, openWithTransition } from './viewTransition';

/**
 * lumin/lxStore.ts
 * Starea interfeței Lumin AI (navigarea), separată de motorul aplicației
 * (state/store.ts), care rămâne același: analiză, învățare, decizii.
 */
export type LxTab = 'today' | 'days' | 'brain' | 'settings';
export type GalleryView = 'wall' | 'moments' | 'days' | 'months' | 'people' | 'map' | 'aside';

interface LxState {
  tab: LxTab;
  setTab: (tab: LxTab) => void;
  /** Turul aplicației deschis (prima intrare sau din Setări). */
  tourOpen: boolean;
  setTourOpen: (open: boolean) => void;
  /** Pozele din sortarea deschisă (pachetul de carduri); null = închisă. */
  sortIds: string[] | null;
  sortTitle: string | null;
  openSort: (ids: string[], title?: string) => void;
  /** Poza mare, doar de privit (glisezi liber), pornind de la `index`. */
  viewer: { ids: string[]; index: number } | null;
  openViewer: (ids: string[], index?: number) => void;
  closeViewer: () => void;
  closeSort: () => void;
  /** Ziua deschisă în „Zile” (început de zi, ms); null = lista. */
  openDay: number | null;
  setOpenDay: (day: number | null) => void;
  galleryView: GalleryView;
  /** Amprentele fețelor în lucru (lumin/faceIdentity.ts); null = nimic de făcut. */
  faceProgress: { done: number; total: number } | null;
  setFaceProgress: (p: { done: number; total: number } | null) => void;
  /** Crește când s-au schimbat fețele/numele, ca ecranele să recitească. */
  /** „Am ales 4 din 27”: ce a făcut sortarea automată (lumin/autoSort.ts). */
  autoResult: AutoSortResult | null;
  setAutoResult: (r: AutoSortResult | null) => void;
  /** Cititorul galeriei în fundal (lumin/galleryReader.ts); null = nu rulează. */
  reader: { done: number; total: number; paused?: 'battery' | 'import' } | null;
  setReader: (r: { done: number; total: number; paused?: 'battery' | 'import' } | null) => void;
  /** „Am citit toată galeria”, arătat o dată pe Azi. */
  readerResult: { total: number; kept: number; waiting: number } | null;
  setReaderResult: (r: { total: number; kept: number; waiting: number } | null) => void;
  faceVersion: number;
  bumpFaces: () => void;
  /** Crește când cineva cere căutarea (scurtătura „Caută” de pe iconiță): Galeria pune cursorul în ea. */
  searchFocus: number;
  focusSearch: () => void;
  setGalleryView: (view: GalleryView) => void;
}

export const useLx = create<LxState>((set, get) => ({
  tab: 'today',
  setTab: tab => set({ tab, openDay: null }),
  tourOpen: false,
  setTourOpen: open => set({ tourOpen: open }),
  sortIds: null,
  sortTitle: null,
  openSort: (ids, title) => set({ sortIds: ids, sortTitle: title ?? null }),
  viewer: null,
  openViewer: (ids, index = 0) => openWithTransition(() => set({ viewer: ids.length ? { ids, index: Math.max(0, Math.min(ids.length - 1, index)) } : null })),
  closeViewer: () => closeWithTransition(() => set({ viewer: null }), get().viewer ? get().viewer!.ids[get().viewer!.index] : undefined),
  closeSort: () => set({ sortIds: null, sortTitle: null }),
  openDay: null,
  setOpenDay: day => set({ openDay: day }),
  galleryView: 'wall',
  faceProgress: null,
  setFaceProgress: p => set({ faceProgress: p }),
  autoResult: null,
  setAutoResult: r => set({ autoResult: r }),
  reader: null,
  setReader: r => set({ reader: r }),
  readerResult: null,
  setReaderResult: r => set({ readerResult: r }),
  faceVersion: 0,
  bumpFaces: () => set(s => ({ faceVersion: s.faceVersion + 1 })),
  searchFocus: 0,
  focusSearch: () => set(s => ({ tab: 'days', openDay: null, galleryView: 'wall', searchFocus: s.searchFocus + 1 })),
  setGalleryView: view => set({ galleryView: view })
}));
