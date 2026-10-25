/**
 * src/shims/humanStub.ts
 * Înlocuitorul lui @vladmandic/human în build-ul Android.
 *
 * Pachetul nativ nu mai copiază modelele Human.js și nu mai trage TensorFlow.js
 * în bundle. Analiza feței pe telefon e MediaPipe Face Landmarker (GPU, cu
 * rezervă pe CPU). Dacă ceva tot încearcă să construiască Human, eșuează
 * vizibil, nu în tăcere cu un 404 de model.
 *
 * TODO(identitate): nu includem greutăți de embedding facial fără o licență
 * confirmată pentru aplicație comercială. Recunoașterea „cine e” rămâne oprită
 * pe Android până există un astfel de model.
 */

export class Human {
  constructor(_config?: unknown) {}
  async load(): Promise<void> {
    throw new Error('Human.js nu este inclus în pachetul Android.');
  }
  async detect(): Promise<{ face: unknown[]; body: unknown[]; hand: unknown[]; gesture: unknown[]; object: unknown[] }> {
    throw new Error('Human.js nu este inclus în pachetul Android.');
  }
}

export type Config = Record<string, unknown>;
export type FaceResult = Record<string, unknown>;
export type ObjectResult = Record<string, unknown>;
export type BackendEnum = string;
