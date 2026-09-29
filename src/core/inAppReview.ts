/**
 * core/inAppReview.ts
 * Punte catre plugin-ul local InAppReview (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/InAppReviewPlugin.kt).
 *
 * Doar mecanica. CAND se cere sta in state/reviewPrompt.ts.
 *
 * Nimic de aici n-are voie sa arunce: o fereastra de recenzie care nu apare nu
 * e o eroare pentru om, si nimic din aplicatie nu depinde de ea.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface InAppReviewApi {
  request(): Promise<{ launched: boolean }>;
}

const InAppReview = registerPlugin<InAppReviewApi>('InAppReview');

export function isInAppReviewAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InAppReview');
}

/**
 * Cere fereastra. `true` inseamna doar ca cererea a ajuns la Play — Google nu
 * spune, intentionat, daca a aratat-o (are o cota proprie per utilizator).
 */
export async function requestInAppReview(): Promise<boolean> {
  if (!isInAppReviewAvailable()) return false;
  try {
    return (await InAppReview.request()).launched === true;
  } catch {
    return false;
  }
}
