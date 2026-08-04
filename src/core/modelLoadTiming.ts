/**
 * core/modelLoadTiming.ts
 * Retine cat a durat ultima incarcare REUSITA a modelelor AI pe acest device
 * (workerPool.ts, AnalysisPool.init()) — nu putem calcula o estimare reala
 * (nu exista un "N din M" pentru descarcare+warmup GPU/CPU, spre deosebire de
 * analiza per-poza care are un contor natural), dar putem spune utilizatorului
 * "de obicei dureaza ~Xs pe acest device" din urma sa, folosit de AiBootScreen.
 * Absent la prima incarcare vreodata (nimic de comparat inca).
 */
const STORAGE_KEY = 'lumin-model-load-ms';

export function readLastModelLoadMs(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

export function writeLastModelLoadMs(ms: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(ms)));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — pur si simplu nu vom avea estimare data viitoare
  }
}
