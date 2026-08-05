/**
 * core/androidBackButton.ts
 * Butonul/gestul hardware Android de "inapoi" nu are niciun echivalent implicit intr-o
 * aplicatie web SPA fara router — bug real gasit de auditul QA: pe pachetul nativ
 * (Capacitor), niciun panou/dialog din aplicatie (Meniu, Persoane, Statistici, Editare,
 * ConfirmDialog, Prezentare, DetailView...) nu reactiona la "inapoi", desi e comportamentul
 * asteptat de orice utilizator Android si o cerinta uzuala de calitate pentru Play Store.
 *
 * Prioritate: inchide DOAR panoul/dialogul cel mai "din fata" (aceeasi ordine ca lista de
 * verificari din DetailView.tsx pentru Escape), apoi Detail/Workspace-ul, apoi selectia in
 * masa; daca nu mai e nimic de inchis, lasa Android sa iasa din aplicatie (App.exitApp() —
 * comportamentul implicit pe care listener-ul il inlocuieste, per documentatia plugin-ului).
 */
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../state/store';

export function initAndroidBackButton(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  const handlePromise = CapacitorApp.addListener('backButton', () => {
    const s = useStore.getState();
    if (s.dialogRequest) { s.resolveDialog(s.dialogRequest.kind === 'confirm' ? false : null); return; }
    if (s.paletteOpen) { s.setPaletteOpen(false); return; }
    if (s.shortcutsOpen) { s.setShortcutsOpen(false); return; }
    if (s.menuOpen) { s.setMenuOpen(false); return; }
    if (s.personsOpen) { s.setPersonsOpen(false); return; }
    if (s.insightsOpen) { s.setInsightsOpen(false); return; }
    if (s.batchOpsOpen) { s.setBatchOpsOpen(false); return; }
    if (s.statsOpen) { s.setStatsOpen(false); return; }
    if (s.projectsOpen) { s.setProjectsOpen(false); return; }
    if (s.contactSheetOpen) { s.setContactSheetOpen(false); return; }
    if (s.presentationOpen) { s.setPresentationOpen(false); return; }
    if (s.collectionsOpen) { s.setCollectionsOpen(false); return; }
    if (s.editingPhotoId) { s.openEdit(null); return; }
    if (s.compareGroupId) { s.openCompare(null); return; }
    if (s.detailId) { s.openDetail(null); return; }
    // Bug real gasit de auditul QA: Workspace (modul de review dedicat, intrat
    // frecvent din "Quick Review"/butonul Focus) nu era verificat aici — cu
    // niciun alt panou deschis, "inapoi" iesea direct din aplicatie in loc sa
    // revina la grila, desi Workspace are propriul buton explicit "inapoi".
    if (s.workspaceMode) { s.setWorkspaceMode(false); return; }
    if (s.multiSelectIds.size || s.selectMode) { s.setSelectMode(false); return; }
    void CapacitorApp.exitApp();
  });

  return () => { void handlePromise.then(h => h.remove()); };
}
