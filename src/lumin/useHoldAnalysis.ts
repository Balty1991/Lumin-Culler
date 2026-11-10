import { useEffect } from 'react';
import { analysisPool } from '../core/workerPool';

/**
 * lumin/useHoldAnalysis.ts
 * Ecranele grele (editorul, guma, filmele, tunelul 3D, sortarea) opresc lucrul din
 * fundal cât sunt deschise: citirea galeriei, pregătirea pozelor, CLIP și fețele
 * așteaptă între două poze, ca atingerea să răspundă imediat. Raportat: „rulează
 * greu când încarcă pozele din galerie; dacă intri în editor, merge sacadat”.
 */
export function useHoldAnalysis(): void {
  useEffect(() => analysisPool.holdForUi(), []);
}
