/**
 * state/storageFreed.ts
 * Câți octeți a eliberat omul, pe telefonul ăsta.
 *
 * E recompensa vizibilă a curățării și singurul lucru pe care cardul de
 * partajare îl desenează. Nu pleacă nicăieri: nu e analytics, e un număr în
 * localStorage, adunat doar după o ștergere pe care sistemul a confirmat-o.
 */

const STORAGE_KEY = 'lumin-bytes-freed';
const COUNT_KEY = 'lumin-files-freed';

export function readFreedBytes(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Adaugă octeții și întoarce totalul nou. Un număr nepozitiv nu schimbă nimic. */
export function addFreedBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return readFreedBytes();
  const next = readFreedBytes() + Math.floor(bytes);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // totalul din sesiunea curentă rămâne cel citit; următoarea adunare reîncearcă
  }
  return next;
}

/** Undo: scoate octeții unui cadru pus înapoi. Nu coboară sub zero. */
export function subtractFreedBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return readFreedBytes();
  const next = Math.max(0, readFreedBytes() - Math.floor(bytes));
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // vezi addFreedBytes
  }
  return next;
}

export function readFreedFiles(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Câte fișiere au plecat după o confirmare a sistemului. */
export function addFreedFiles(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return readFreedFiles();
  const next = readFreedFiles() + Math.floor(count);
  try {
    localStorage.setItem(COUNT_KEY, String(next));
  } catch {
    // vezi addFreedBytes
  }
  return next;
}

/** Undo: câte fișiere au revenit. */
export function subtractFreedFiles(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return readFreedFiles();
  const next = Math.max(0, readFreedFiles() - Math.floor(count));
  try {
    localStorage.setItem(COUNT_KEY, String(next));
  } catch {
    // vezi addFreedBytes
  }
  return next;
}
