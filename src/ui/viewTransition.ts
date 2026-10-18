import { motionAllowed } from './haptics';

/**
 * Tranziție între ecrane acolo unde browserul o are. Altfel, starea se
 * schimbă în același cadru. Mișcarea redusă nu pornește animația.
 */
export function withViewTransition(apply: () => void): void {
  if (typeof document === 'undefined' || !motionAllowed()) {
    apply();
    return;
  }
  const start = (document as Document & { startViewTransition?: (cb: () => void) => void }).startViewTransition;
  if (typeof start !== 'function') {
    apply();
    return;
  }
  start.call(document, apply);
}
