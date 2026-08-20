import type { PhotoView } from './store';

/**
 * Suma reala a dimensiunilor de fisier (PhotoView.sizeBytes, din File.size la
 * import — vezi core/importPipeline.ts) — plan modernizare, cardurile de pe
 * Acasa ("X GB ocupate"/"eliberezi Y GB"). Pozele importate INAINTE de acest
 * camp (biblioteci vechi) nu au sizeBytes — le EXCLUDEM din suma (nu le tratam
 * ca 0), ca sa nu subestimam sistematic o biblioteca veche amestecata cu una noua.
 */
export function sumKnownSizeBytes(photos: PhotoView[]): number {
  return photos.reduce((sum, p) => sum + (p.sizeBytes ?? 0), 0);
}

/** "1.2" dintr-un numar de bytes — un singur zecimal, ca in mockup ("1.2 GB"). */
export function formatGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

/**
 * Marime lizibila, cu unitatea potrivita.
 *
 * formatGB de mai sus e bun pentru totalul bibliotecii, unde ordinul de marime
 * e mereu gigabytes. Pentru cifre mai mici — cat ocupa niste copii identice —
 * "0.0 GB" nu spune nimic, desi sunt 40 de MB reali care se pot elibera.
 */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
