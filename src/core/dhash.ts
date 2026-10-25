/**
 * core/dhash.ts
 * Amprenta perceptuală dHash 9×8, aceeași convenție ca grila din import.
 *
 * 9 coloane × 8 rânduri, câte un bit pe perechea de pixeli vecini pe orizontală:
 * 64 de biți, scriși ca șir de '0' și '1'. Gruparea seriilor (hashCompare.worker)
 * compară exact acest șir. Un al doilea format ar despărți pozele care sunt
 * aceeași rafală.
 */

export function dHashFromRgba(data: ArrayLike<number>, width = 9): string {
  const height = Math.floor(data.length / (width * 4));
  let hash = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const j = (y * width + x + 1) * 4;
      const a = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const b = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      hash += a > b ? '1' : '0';
    }
  }
  return hash;
}

/** Distanța Hamming pe șiruri de biți de aceeași lungime. Lungimi diferite se numără ca nepotriviri. */
export function hamming64(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) distance++;
  return distance;
}

/**
 * Expunere și claritate din aceiași pixeli deja citiți pentru dHash.
 *
 * Nu înlocuiesc măsurătoarea de pe cadrul mare (aceea rămâne la modele, pentru
 * candidați). Pentru o poză singură, fără vecini de rafală, sunt suficiente
 * ca să nu pornim șapte rețele.
 */
export function thumbMetrics(data: ArrayLike<number>, width = 9): { exposure: number; sharpness: number } {
  const height = Math.floor(data.length / (width * 4));
  if (height < 3 || width < 3) return { exposure: 50, sharpness: 0 };
  const gray = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      gray[y * width + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const exposure = Math.max(0, Math.min(100, (sum / gray.length / 255) * 100));
  let acc = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = gray[y * width + x];
      const lap = gray[y * width + x - 1] + gray[y * width + x + 1] + gray[(y - 1) * width + x] + gray[(y + 1) * width + x] - 4 * c;
      acc += lap * lap;
      n++;
    }
  }
  const sharpness = Math.max(0, Math.min(100, Math.sqrt(n ? acc / n : 0) / 2));
  return { exposure, sharpness };
}
