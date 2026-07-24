/**
 * state/watermarkText.ts
 * Ultimul text de watermark folosit la exportul galeriei client (core/export/
 * watermark.ts) — persistat local ca fotograful sa nu retasteze numele
 * studioului la fiecare export. Gol/absent = galeria se genereaza fara
 * watermark (comportamentul dinainte de aceasta functie).
 */
const STORAGE_KEY = 'lumin-watermark-text';

export function readStoredWatermarkText(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeWatermarkText(text: string): void {
  try {
    if (text) localStorage.setItem(STORAGE_KEY, text);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — watermark-ul tot se aplica pentru sesiunea curenta
  }
}
