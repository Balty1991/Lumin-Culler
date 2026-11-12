import { create } from 'zustand';

/**
 * lumin/selection.ts
 * Selecția multiplă din Galerie: ții apăsat pe o poză, apoi atingi și altele.
 * Cu ele: Trimite, Colaj, Reel (cerut din auditul pe persoane: „nu pot alege
 * eu pozele pentru un colaj sau pentru WhatsApp”).
 */
interface SelectionState {
  ids: string[];
  active: boolean;
  start: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
}

export const useSelection = create<SelectionState>(set => ({
  ids: [],
  active: false,
  start: id => set(s => (s.active ? s : { active: true, ids: [id] })),
  toggle: id => set(s => {
    const ids = s.ids.includes(id) ? s.ids.filter(x => x !== id) : [...s.ids, id];
    return { ids, active: ids.length > 0 };
  }),
  clear: () => set({ ids: [], active: false })
}));
