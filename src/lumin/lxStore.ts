import { create } from 'zustand';

/**
 * lumin/lxStore.ts
 * Starea interfeței Lumin AI (navigarea), separată de motorul aplicației
 * (state/store.ts), care rămâne același: analiză, învățare, decizii.
 */
export type LxTab = 'today' | 'days' | 'brain' | 'settings';
export type GalleryView = 'wall' | 'days' | 'months' | 'people' | 'aside';

interface LxState {
  tab: LxTab;
  setTab: (tab: LxTab) => void;
  /** Pozele din sortarea deschisă (pachetul de carduri); null = închisă. */
  sortIds: string[] | null;
  sortTitle: string | null;
  openSort: (ids: string[], title?: string) => void;
  closeSort: () => void;
  /** Ziua deschisă în „Zile” (început de zi, ms); null = lista. */
  openDay: number | null;
  setOpenDay: (day: number | null) => void;
  galleryView: GalleryView;
  setGalleryView: (view: GalleryView) => void;
}

export const useLx = create<LxState>(set => ({
  tab: 'today',
  setTab: tab => set({ tab, openDay: null }),
  sortIds: null,
  sortTitle: null,
  openSort: (ids, title) => set({ sortIds: ids, sortTitle: title ?? null }),
  closeSort: () => set({ sortIds: null, sortTitle: null }),
  openDay: null,
  setOpenDay: day => set({ openDay: day }),
  galleryView: 'wall',
  setGalleryView: view => set({ galleryView: view })
}));
