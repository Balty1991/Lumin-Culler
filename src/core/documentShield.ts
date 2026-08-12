/**
 * core/documentShield.ts
 * "Protectie documente/coduri sensibile" (plan modernizare, ecran m-shield din
 * mockup) — conecteaza in sfarsit AnalysisRecord.textCoverage (OCR nativ
 * Android, calculat deja de nativeAnalysis.ts, dar pana acum NECONECTAT la
 * nimic vizibil utilizatorului, doar folosit intern de importPipeline.ts ca
 * sa nu auto-selecteze documente/capturi de ecran) la un flux real: gaseste
 * pozele care par documente si propune mutarea lor in Dosarul privat
 * (core/vault.ts), fara sa oblige la nimic.
 *
 * Absent pe web/PWA (textCoverage nu exista acolo — fara OCR in pipeline-ul
 * JS) — isSensitiveDocument devine mereu false, deci fara efect, exact ca
 * hasNoRecognizableSubject in importPipeline.ts.
 */
import type { PhotoView } from '../state/store';
import { TEXT_DOMINANT_THRESHOLD } from './importPipeline';

export function isSensitiveDocument(photo: Pick<PhotoView, 'textCoverage'>): boolean {
  return photo.textCoverage !== undefined && photo.textCoverage >= TEXT_DOMINANT_THRESHOLD;
}

const DISMISSED_KEY = 'lumin-shield-dismissed-ids';

function readDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — promptul poate reaparea la urmatoarea vizita
  }
}

/** "Las-o unde e" — nu mai propune ACEEASI poza a doua oara (nu si "nu mai propune nimic niciodata"). */
export function dismissSensitiveDocument(photoId: string): void {
  const ids = readDismissedIds();
  ids.add(photoId);
  writeDismissedIds(ids);
}

/**
 * Coada de revizuit: documente/capturi sensibile, nici mutate in Dosarul
 * privat (privateIds), nici respinse explicit ("las-o unde e") anterior.
 * Functie pura generica (pastreaza tipul complet al elementelor primite —
 * DocumentShieldPanel.tsx o apeleaza cu PhotoView[] complet, nu doar cele
 * doua campuri stricte necesare filtrarii), testabila separat de
 * localStorage/store.
 */
export function selectPendingShieldReview<T extends Pick<PhotoView, 'id' | 'textCoverage'>>(
  photos: T[],
  privateIds: ReadonlySet<string>,
  dismissedIds: ReadonlySet<string>
): T[] {
  return photos.filter(p => isSensitiveDocument(p) && !privateIds.has(p.id) && !dismissedIds.has(p.id));
}

export { readDismissedIds as readShieldDismissedIds };
