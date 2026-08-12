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
