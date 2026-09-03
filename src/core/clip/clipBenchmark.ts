/**
 * core/clip/clipBenchmark.ts
 * Cat costa CLIP pe TELEFONUL TAU — masurat acolo, nu estimat aici.
 *
 * DE CE EXISTA, si e o chestiune de onestitate, nu de curiozitate tehnica.
 * Codul acestei integrari a fost scris intr-un mediu fara telefon si fara
 * modelul propriu-zis (nu se comite in git, il aduce CI-ul). Deci nimeni nu
 * stie inca daca o poza dureaza 15 ms sau 400 ms pe un Android de 600 de lei —
 * iar diferenta hotaraste daca functia merita sa existe.
 *
 * Aplicatia are deja regula ca nu afirma cifre pe care nu le-a masurat (vezi
 * core/decisionPace.ts, core/sessionOutcome.ts). Asta e acelasi principiu, mutat
 * asupra propriei implementari: inainte sa pornim functia pentru cineva, o
 * masuram pe dispozitivul lui si aratam ce a iesit.
 *
 * MEDIANA, nu media, si din acelasi motiv ca la ritmul deciziilor: prima poza
 * plateste incalzirea nucleelor GPU si compilarea shaderelor, si e de cateva ori
 * mai lenta decat restul. O medie trasa de ea ar descrie un cost pe care nu-l
 * mai plateste nicio poza urmatoare.
 */

export interface ClipBenchmarkResult {
  backend: 'webgpu' | 'wasm';
  /** Cat a durat pregatirea modelului (descarcare + sesiune), in ms. */
  loadMs: number;
  /** Cate poze au fost masurate efectiv. */
  samples: number;
  /** Mediana pe poza, in ms — cifra care conteaza pentru un import de o mie de poze. */
  medianMs: number;
  /** Cea mai lenta poza, in ms — de obicei prima, cu incalzirea inclusa. */
  slowestMs: number;
  /** Estimarea pentru un lot obisnuit, in secunde: mediana x 1000 de poze. */
  thousandPhotosSeconds: number;
}

/** Cate poze se masoara. Destule cat mediana sa insemne ceva, putine cat sa nu tina omul in loc. */
export const BENCHMARK_SAMPLES = 12;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compune rezultatul din masuratorile brute. Separat de rulare ca sa poata fi
 * verificat cu numere scrise de mana — partea care aduna si imparte e exact
 * partea in care o eroare ar trece neobservata, fiindca rezultatul ar arata
 * oricum plauzibil.
 */
export function summarizeBenchmark(
  backend: 'webgpu' | 'wasm',
  loadMs: number,
  perPhotoMs: readonly number[]
): ClipBenchmarkResult | null {
  if (perPhotoMs.length === 0) return null;
  const med = median(perPhotoMs);
  return {
    backend,
    loadMs,
    samples: perPhotoMs.length,
    medianMs: med,
    slowestMs: Math.max(...perPhotoMs),
    // Rotunjit la secunda: o zecimala aici ar sugera o precizie pe care o
    // masuratoare de doisprezece poze n-o are.
    thousandPhotosSeconds: Math.round((med * 1000) / 1000)
  };
}
