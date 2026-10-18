/**
 * Semnalele ieftine ale unei fotografii: claritate, expunere, amprentă.
 *
 * Nu încarcă niciun model. Lucrează pe pixelii deja decodați la câteva sute
 * de pixeli, pe firul care a cerut-o. Coșurile (neclare, capturi, duplicate)
 * se pot umple din atât, fără să aștepte detectarea de fețe.
 */

/** Sub varianța asta, miniatura e mișcată. Aceeași cifră ca la scanarea nativă. */
export const FAST_BLUR_VARIANCE = 80;

/** Latura maximă la care se decodează pasul rapid. 2048 era previzualizarea de studio. */
export const FAST_DECODE_SIDE = 384;

export function laplacianVariance(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const gray = new Float32Array(width * height);
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - width] + gray[i - 1] + gray[i + 1] + gray[i + width] - 4 * gray[i];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sum2 / n - mean * mean);
}

/** 0–100, pe aceeași scară cu DEFECT_SHARPNESS (sub 45 = de coș). */
export function sharpnessFromVariance(variance: number): number {
  if (variance >= FAST_BLUR_VARIANCE) return Math.min(100, Math.round(50 + variance / 40));
  return Math.max(0, Math.round((variance / FAST_BLUR_VARIANCE) * 40));
}

export function exposureFromPixels(data: Uint8ClampedArray): number {
  if (data.length < 4) return 50;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++;
  }
  return Math.max(0, Math.min(100, Math.round((sum / Math.max(1, n) / 255) * 100)));
}

export function looksLikeScreenshot(name: string): boolean {
  return /screenshot|screen[-_ ]?shot|captur[aă]/i.test(name);
}
