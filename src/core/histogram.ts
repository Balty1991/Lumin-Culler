/**
 * core/histogram.ts
 * Histograma imaginii — cate pixeli sunt la fiecare nivel de luminozitate.
 *
 * E instrumentul cel mai vechi si cel mai folosit din orice editor serios, si
 * singurul care raspunde la o intrebare pe care ochiul n-o poate rezolva pe un
 * ecran de telefon, in soare: mai am detaliu in lumini, sau am ars deja?
 * Un slider de expunere fara histograma se regleaza dupa impresie.
 *
 * Deliberat pe 64 de trepte, nu pe 256: la o latime de cateva sute de pixeli pe
 * ecran, 256 de coloane nu se pot desena distinct oricum, iar 64 dau o silueta
 * mai lizibila si de patru ori mai putina munca.
 *
 * Fara DOM: primeste pixeli, intoarce numere.
 */

export const BUCKETS = 64;

export interface Histogram {
  /** Cate esantioane au cazut in fiecare treapta, pe canal si pe luminanta. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Cel mai mare varf, pentru scalarea desenului. */
  peak: number;
  /** Fractiunea de pixeli lipiti de capete — negrul inecat si albul ars. */
  clippedShadows: number;
  clippedHighlights: number;
}

/** Sub cat se socoteste "negru inecat" si peste cat "alb ars", pe 0..255. */
const BLACK_LEVEL = 2;
const WHITE_LEVEL = 253;

/**
 * @param stride cati pixeli se sar intre doua esantioane. Histograma e o
 *   SILUETA, nu o numaratoare exacta: un esantion din patru da acelasi contur
 *   si costa un sfert. Apelantul o recalculeaza la fiecare miscare de slider.
 */
export function computeHistogram(img: ImageData, stride = 4): Histogram {
  const r = new Uint32Array(BUCKETS);
  const g = new Uint32Array(BUCKETS);
  const b = new Uint32Array(BUCKETS);
  const luma = new Uint32Array(BUCKETS);
  const d = img.data;
  const step = Math.max(1, Math.floor(stride)) * 4;

  let total = 0, dark = 0, bright = 0;
  for (let i = 0; i < d.length; i += step) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    r[(R * BUCKETS) >> 8]++;
    g[(G * BUCKETS) >> 8]++;
    b[(B * BUCKETS) >> 8]++;
    // aceiasi coeficienti de luminanta ca in restul aplicatiei
    const L = (R * 299 + G * 587 + B * 114) / 1000;
    luma[Math.min(BUCKETS - 1, (L * BUCKETS) >> 8)]++;
    total++;
    // "Lipit de capat" se judeca pe canale, nu pe luminanta: un rosu ars intr-un
    // apus e pierdere de informatie chiar daca luminanta totala pare cuminte.
    if (R <= BLACK_LEVEL && G <= BLACK_LEVEL && B <= BLACK_LEVEL) dark++;
    if (R >= WHITE_LEVEL || G >= WHITE_LEVEL || B >= WHITE_LEVEL) bright++;
  }

  let peak = 0;
  for (let i = 0; i < BUCKETS; i++) {
    if (r[i] > peak) peak = r[i];
    if (g[i] > peak) peak = g[i];
    if (b[i] > peak) peak = b[i];
  }
  return {
    r, g, b, luma, peak,
    clippedShadows: total ? dark / total : 0,
    clippedHighlights: total ? bright / total : 0
  };
}

/**
 * Silueta unui canal ca traseu SVG, pe o cutie de latime x inaltime.
 *
 * Se inchide pe linia de baza, ca sa poata fi umpluta: o histograma conturata
 * doar cu linia de sus se citeste mult mai greu pe un ecran mic.
 */
export function histogramPath(values: Uint32Array, peak: number, width: number, height: number): string {
  if (!peak) return '';
  const n = values.length;
  const dx = width / (n - 1);
  let path = `M 0 ${height}`;
  for (let i = 0; i < n; i++) {
    // radacina patrata: fara ea, un varf urias (cerul unei poze) turteste tot
    // restul siluetei intr-o linie plata lipita de baza
    const h = Math.sqrt(values[i] / peak) * height;
    path += ` L ${(i * dx).toFixed(1)} ${(height - h).toFixed(1)}`;
  }
  return path + ` L ${width} ${height} Z`;
}
