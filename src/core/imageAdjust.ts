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
