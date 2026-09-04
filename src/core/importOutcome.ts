/**
 * core/importOutcome.ts
 *
 * Ce s-a intamplat la ultimele importuri, dupa ce dispare notificarea.
 *
 * Pipeline-ul raporteaza deja corect esecurile: "40 din 800 de poze nu au putut
 * fi procesate", cu primele doua motive reale. Problema nu e ca informatia
 * lipseste, ci ca e TRECATOARE — un toast de cateva secunde, in timpul unui
 * import lung, cand utilizatorul probabil nici nu se uita la ecran. Dupa ce
 * dispare, nu mai exista nicaieri: nu poti afla nici cate poze au esuat, nici
 * de ce, nici daca se repeta de la un import la altul.
 *
 * Modulul pastreaza ultimele cateva importuri. Asta transforma un incident
 * invizibil intr-un tipar vizibil: "de fiecare data esueaza cam 5%" e o
 * informatie cu care se poate face ceva, spre deosebire de un mesaj vazut o
 * data si uitat.
 *
 * CE SE PASTREAZA: numere si mesajul de eroare al motorului. Fara nume de
 * fisier, fara cai, fara continut. Totul local, sters dintr-o apasare.
 */

const KEY = 'lumin-import-outcomes';
/** Cate importuri tinem minte. Destul ca sa se vada un tipar, prea putin ca sa devina arhiva. */
export const MAX_OUTCOMES = 10;

export interface ImportOutcome {
  /** Momentul terminarii (epoch ms). */
  ts: number;
  /** Cate fisiere au intrat in analiza. */
  total: number;
  /** Cate au ajuns efectiv in biblioteca. */
  imported: number;
  /** Cate au esuat in analiza. */
  failed: number;
  /** Cate au fost sarite inainte de analiza (video, format nesuportat). */
  skipped: number;
  /** Primele motive de esec, deja agregate de pipeline. Fara nume de fisier. */
  reasons?: string;
  /**
   * Cat a durat importul, in ms. Optional: inregistrarile scrise inainte de
   * acest camp n-au cum sa-l aiba.
   *
   * DE CE E AICI. Fara el, "motorul nou ar adauga 106 ms pe poza" e o cifra
   * fara numitor — 106 ms peste ce? Cu el, ecranul de masurare poate spune
   * cate procente inseamna asta din ce te costa deja un import, pe telefonul
   * tau. Aceeasi regula ca peste tot: cifra masurata bate cifra argumentata.
   */
  durationMs?: number;
}

/**
 * Cat a costat, in medie, o poza la ultimele importuri — ms pe poza. `null`
 * cand inca nu exista nicio inregistrare cu durata.
 *
 * Se aduna toate importurile care AU durata, nu doar ultimul: un singur lot de
 * trei poze e dominat de pornirea modelelor si n-ar descrie deloc un import
 * obisnuit.
 */
export function measuredMsPerPhoto(outcomes = readImportOutcomes()): number | null {
  const cuDurata = outcomes.filter(o => typeof o.durationMs === 'number' && o.durationMs > 0 && o.imported > 0);
  if (!cuDurata.length) return null;
  const ms = cuDurata.reduce((n, o) => n + (o.durationMs ?? 0), 0);
  const poze = cuDurata.reduce((n, o) => n + o.imported, 0);
  return poze > 0 ? ms / poze : null;
}

/**
 * Scoate din motiv orice ar putea fi un nume de fisier.
 *
 * Motivul vine de la pipeline, unde e util sa contina si numele fisierului
 * pentru diagnosticare pe loc — dar aici informatia se PASTREAZA, si un jurnal
 * pe termen lung cu nume de fisiere e altceva decat un mesaj de o secunda.
 * Curatarea se face la granita de scriere, singurul loc care poate garanta
 * asta indiferent de cine cheama.
 */
function sanitiseReason(reason: string): string {
  return reason
    // segmentul "[fisier real: png, etichetat "IMG_1234.HEIC"]" adaugat de pipeline
    .replace(/\s*\[fisier real:[^\]]*\]/g, '')
    // orice a mai ramas si arata a nume de fisier
    .replace(/\S+\.(jpe?g|png|webp|avif|heic|heif|cr2|cr3|nef|arw|dng|rw2|orf|raf|tiff?)\b/gi, '<fisier>')
    .trim();
}

function isOutcome(v: unknown): v is ImportOutcome {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<ImportOutcome>;
  return ['ts', 'total', 'imported', 'failed', 'skipped']
    .every(k => typeof (o as Record<string, unknown>)[k] === 'number' && Number.isFinite((o as Record<string, number>)[k]));
}

export function readImportOutcomes(): ImportOutcome[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOutcome) : [];
  } catch {
    return [];
  }
}

/** Inregistreaza rezultatul unui import. Importurile fara niciun fisier nu se retin — n-au ce spune. */
export function recordImportOutcome(outcome: ImportOutcome): ImportOutcome[] {
  if (outcome.total <= 0 && outcome.skipped <= 0) return readImportOutcomes();
  const clean: ImportOutcome = outcome.reasons
    ? { ...outcome, reasons: sanitiseReason(outcome.reasons) || undefined }
    : outcome;
  const next = [...readImportOutcomes(), clean].slice(-MAX_OUTCOMES);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {
    // stocare plina — pierdem jurnalul, nu importul
  }
  return next;
}

export function resetImportOutcomes(): void {
  try { localStorage.removeItem(KEY); } catch {
    // vezi recordImportOutcome
  }
}

export interface OutcomeSummary {
  imports: number;
  totalPhotos: number;
  totalFailed: number;
  totalSkipped: number;
  /** Procentul de esec peste toate importurile retinute, 0..100. */
  failureRate: number;
  /** Cel mai recent motiv raportat, daca exista. */
  lastReason?: string;
}

/** `null` cand nu s-a retinut niciun import — nu e nimic de aratat. */
export function summariseOutcomes(outcomes = readImportOutcomes()): OutcomeSummary | null {
  if (!outcomes.length) return null;
  const totalPhotos = outcomes.reduce((n, o) => n + o.total, 0);
  const totalFailed = outcomes.reduce((n, o) => n + o.failed, 0);
  const totalSkipped = outcomes.reduce((n, o) => n + o.skipped, 0);
  const lastWithReason = [...outcomes].reverse().find(o => o.reasons);
  return {
    imports: outcomes.length,
    totalPhotos,
    totalFailed,
    totalSkipped,
    failureRate: totalPhotos > 0 ? Math.round((totalFailed / totalPhotos) * 100) : 0,
    lastReason: lastWithReason?.reasons
  };
}
