/**
 * state/searchDateWords.ts
 * Formele in care cineva ar SCRIE data unei poze in casuta de cautare.
 *
 * Cautarea acopera deja numele fisierului, persoanele inrolate, aparatul,
 * IPTC-ul, proiectul, etichetele de scena si conceptele invecinate (vezi
 * matchesSearch in store.ts). Data lipsea, desi e printre primele lucruri dupa
 * care cauta cineva: "iulie", "2026", "29 iul".
 *
 * Cache pe (moment, limba): cautarea trece prin toata biblioteca la fiecare
 * litera tastata, iar formatarea unei date nu e gratuita. Cheia e chiar
 * momentul capturii, deci pozele din aceeasi zi impart o singura intrare.
 */
import type { Locale } from '../i18n';

const cache = new Map<string, string>();
/** Peste atatea intrari golim cache-ul: o biblioteca mare are multe momente
 *  distincte, si nu vrem o harta care creste la nesfarsit intr-o sesiune lunga. */
const MAX_ENTRIES = 5000;

function intlLocale(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'ro-RO';
}

/**
 * Anul, luna intreaga, luna scurta si data compusa, toate deodata si deja
 * normalizate pentru comparatie (minuscule, fara diacritice) — nu putem sti
 * care dintre forme o sa fie tastata.
 *
 * Sir gol cand poza n-are data capturii sau are una invalida.
 */
export function dateSearchWords(capturedAt: number | undefined, locale: Locale): string {
  if (capturedAt === undefined || !Number.isFinite(capturedAt)) return '';
  const key = `${locale}|${capturedAt}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const d = new Date(capturedAt);
  if (Number.isNaN(d.getTime())) return '';
  const li = intlLocale(locale);
  let words = String(d.getFullYear());
  try {
    words += ' ' + d.toLocaleDateString(li, { month: 'long' })
      + ' ' + d.toLocaleDateString(li, { month: 'short' })
      + ' ' + d.toLocaleDateString(li, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    // motor Intl fara locala ceruta — anul singur ramane cautabil
  }
  const normalized = words.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, normalized);
  return normalized;
}
