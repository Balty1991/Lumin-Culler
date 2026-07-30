/**
 * core/imageAdjust.ts
 * Ajustari de baza non-destructive (expunere/contrast/saturatie/temperatura/
 * tinta/highlights/shadows) — nu modifica niciodata blob-ul original sau
 * preview-ul stocat, doar re-deseneaza pe un canvas la cerere (DetailView,
 * export). Valorile se salveaza pe PhotoRecord.edits (core/db.ts) si se pot
 * reseta oricand fara pierdere de calitate, exact ca develop module-ul dintr-un
 * soft de catalogare (Lightroom/Capture One), dar mult mai restrans in scop.
 */

export interface EditAdjustments {
  exposure: number;    // -100..100
  contrast: number;    // -100..100
  saturation: number;  // -100..100
  temperature: number; // -100..100 (rece <-> cald)
  tint: number;        // -100..100 (verde <-> magenta)
  highlights: number;  // -100..100
  shadows: number;     // -100..100
}

export const NEUTRAL_ADJUSTMENTS: EditAdjustments = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0
};

export const ADJUSTMENT_KEYS = Object.keys(NEUTRAL_ADJUSTMENTS) as (keyof EditAdjustments)[];

/** true daca nu exista nicio ajustare (absent SAU toate valorile 0) — folosit pentru badge-ul "editat" si starea butonului Reseteaza. */
export function isNeutral(a: EditAdjustments | undefined): boolean {
  if (!a) return true;
  return ADJUSTMENT_KEYS.every(k => a[k] === 0);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Deseneaza `source` pe canvas-ul lui `ctx` (dimensiune width x height) cu
 * ajustarile aplicate. Expunerea/contrastul/saturatia trec prin ctx.filter
 * (accelerat de browser); temperatura/tinta/highlights/shadows necesita un
 * pixel-pass suplimentar (getImageData/putImageData), sarit complet cand
 * sunt toate neutre — cazul cel mai comun (doar primele 3 ajustate) ramane
 * la fel de rapid ca un simplu drawImage.
 */
export function drawAdjusted(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  a: EditAdjustments
): void {
  const brightness = 1 + a.exposure / 100;
  const contrast = 1 + a.contrast / 100;
  const saturate = 1 + a.saturation / 100;
  ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.filter = 'none';

  if (a.temperature === 0 && a.tint === 0 && a.highlights === 0 && a.shadows === 0) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  const tempShift = (a.temperature / 100) * 40;  // pana la ±40 pe canalele R/B (cald/rece)
  const tintShift = (a.tint / 100) * 40;         // pana la ±40 pe G vs R+B (verde/magenta)
  const highlightAmt = (a.highlights / 100) * 60;
  const shadowAmt = (a.shadows / 100) * 60;
  const hasToneShift = highlightAmt !== 0 || shadowAmt !== 0;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    r += tempShift - tintShift / 2;
    b -= tempShift + tintShift / 2;
    g += tintShift;

    if (hasToneShift) {
      // luminanta inainte de shift-ul de temperatura/tinta ar fi mai corecta, dar
      // diferenta e imperceptibila la magnitudinea shift-urilor de mai sus —
      // preferam un singur pass peste pixel in loc de doua
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const hiWeight = Math.max(0, (lum - 128) / 127);
      const shWeight = Math.max(0, (128 - lum) / 128);
      const delta = highlightAmt * hiWeight + shadowAmt * shWeight;
      r += delta; g += delta; b += delta;
    }

    d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
  }
  ctx.putImageData(imgData, 0, 0);
}

function clampRange(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const AUTO_CLIP_HIGH_LUM = 250; // aceeasi convertie ca faceAnalysis.worker.ts (clippingScores)
const AUTO_CLIP_LOW_LUM = 5;

/**
 * "Editor AI automat": deriva o singura data valorile pentru toti cei 7
 * sliders, direct din statisticile de pixel ale imaginii NEEDITATE (histograma
 * de luminanta + medii pe canal) — nu un model ML, ci aceleasi euristici clasice
 * de auto-enhance (auto-nivele, gray-world pentru balansul de alb, recuperare
 * highlights/shadows din fractiunea de pixeli "arsi"). Rezultatul e doar un
 * PUNCT DE PORNIRE rezonabil — utilizatorul poate regla oricare slider dupa,
 * exact ca dupa o editare manuala (nimic destructiv, EditPanel salveaza
 * oricum doar valorile, nu pixeli).
 *
 * Deliberat conservator (damping + clamp sub maximul de 100 al fiecarui
 * slider): scopul e o corectie utila fara sa transforme o poza "creativ"
 * subexpusa/supraexpusa/cu dominanta de culoare intentionata intr-o versiune
 * plata, "normalizata la forta".
 */
export function computeAutoAdjustmentsFromImageData(img: ImageData): EditAdjustments {
  const { data } = img;
  const step = 16; // esantionaj identic cu exposureScore/clippingScores din faceAnalysis.worker.ts
  let sumR = 0, sumG = 0, sumB = 0, sumLum = 0, count = 0;
  let highClip = 0, lowClip = 0;
  const hist = new Uint32Array(256);

  for (let i = 0; i < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sumR += r; sumG += g; sumB += b;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    sumLum += lum;
    hist[Math.round(clampRange(lum, 0, 255))]++;
    if (lum >= AUTO_CLIP_HIGH_LUM) highClip++;
    else if (lum <= AUTO_CLIP_LOW_LUM) lowClip++;
    count++;
  }
  if (!count) return { ...NEUTRAL_ADJUSTMENTS };

  const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
  const meanLum = sumLum / count;
  const avgGray = (avgR + avgG + avgB) / 3;

  // expunere: tinta luminanta medie ~128 (mijlocul scalei 0..255), damped ca sa
  // nu supra-corecteze poze intentionat inchise/luminoase (low-key/high-key)
  const exposureRatio = clampRange(128 / Math.max(meanLum, 1), 0.5, 2.2);
  const exposure = Math.round(clampRange((exposureRatio - 1) * 100 * 0.6, -35, 35));

  // contrast: intinde histograma intre percentila 2% si 98%, spre un interval
  // "sanatos" de ~200 din 255 — nu scade niciodata contrastul (doar creste, cand chiar lipseste)
  let cum = 0, p2 = 0, p98 = 255;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum / count >= 0.02) { p2 = v; break; } }
  cum = 0;
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum / count >= 0.02) { p98 = v; break; } }
  const rawRange = p98 - p2;
  // interval 0 (imagine perfect plata, fara nicio textura) -> nimic de intins;
  // altfel formula de stretch ar "inventa" contrast dintr-o singura valoare
  const contrast = rawRange <= 0 ? 0 : Math.round(clampRange((clampRange(200 / rawRange, 1, 1.6) - 1) * 100, 0, 35));

  // balans de alb (ipoteza "gray world"): media R/G/B a unei scene tipice ar
  // trebui sa fie neutra — orice abatere e tratata ca o dominanta de culoare de
  // corectat. Deriva temperatura/tinta prin inversarea shift-urilor aplicate de
  // drawAdjusted() mai jos (r += temp - tint/2; b -= temp + tint/2; g += tint).
  const dR = avgGray - avgR, dG = avgGray - avgG, dB = avgGray - avgB;
  const tintShift = dG;
  const tempShift = (dR - dB) / 2;
  const tint = Math.round(clampRange(tintShift * 2.5, -30, 30));
  const temperature = Math.round(clampRange(tempShift * 2.5, -30, 30));

  // recuperare highlights/shadows, proportionala cu fractiunea de pixeli "arsi"
  // (acelasi prag ca clippingScores) — shadows pozitiv LUMINEAZA umbrele (recupereaza
  // negru inecat), highlights negativ INTUNECA highlights-urile (recupereaza alb ars)
  const highFrac = highClip / count, lowFrac = lowClip / count;
  const shadows = Math.round(clampRange(lowFrac * 400, 0, 40));
  const highlights = Math.round(clampRange(-(highFrac * 400), -40, 0)) || 0; // normalizeaza -0 la 0

  return { exposure, contrast, saturation: 0, temperature, tint, highlights, shadows };
}

/**
 * Wrapper de conveninta pentru UI (EditPanel): deseneaza sursa pe un canvas
 * offscreen, redus la max ~360px pe latura mare (statisticile nu au nevoie de
 * rezolutie completa, doar viteza — evita blocarea thread-ului principal la
 * apasarea butonului "Auto" pe o poza de zeci de MP), apoi extrage ImageData.
 */
export function computeAutoAdjustments(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): EditAdjustments {
  const MAX_DIM = 360;
  const scale = Math.min(1, MAX_DIM / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ...NEUTRAL_ADJUSTMENTS };
  ctx.drawImage(source, 0, 0, w, h);
  return computeAutoAdjustmentsFromImageData(ctx.getImageData(0, 0, w, h));
}

/**
 * Randeaza ajustarile pe un blob (ex. miniatura din galeria pentru client) si
 * intoarce un JPEG nou — folosit doar acolo unde utilizatorul alege EXPLICIT
 * sa "coaca" editarile intr-un export (nu modifica blob-ul original din
 * IndexedDB). `blob` neschimbat daca nu exista nicio ajustare reala, ca sa nu
 * piarda calitate printr-un re-encode inutil.
 */
export async function applyAdjustmentsToBlob(blob: Blob, adjustments: EditAdjustments, quality = 0.85): Promise<Blob> {
  if (isNeutral(adjustments)) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    drawAdjusted(ctx, bitmap, canvas.width, canvas.height, adjustments);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
    );
  } finally {
    bitmap.close();
  }
}
