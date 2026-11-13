import { flushSync } from 'react-dom';

/**
 * lumin/viewTransition.ts
 * Poza „zboară” din grilă până pe tot ecranul și înapoi (View Transitions,
 * WebView-ul Chromium din Android). Elementul atins primește numele
 * „lx-photo”, iar poza mare îl poartă din CSS (.lx-viewer-photo); browserul
 * animă singur drumul dintre ele.
 *
 * Unde nu se poate (WebView vechi, „Reducere animații” pornit), schimbarea se
 * face direct, ca înainte.
 */
const NAME = 'lx-photo';
let tapped: { el: HTMLElement; at: number } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', e => {
    const el = (e.target as Element | null)?.closest?.('img, .lx-thumb-empty') as HTMLElement | null;
    tapped = el ? { el, at: Date.now() } : null;
  }, { capture: true, passive: true });
}

type Transition = { finished: Promise<void>; skipTransition?: () => void };
type Doc = Document & { startViewTransition?: (cb: () => void) => Transition };

/**
 * O tranziție nu are voie să rămână pe ecran: cât ține, poza „zburătoare” stă peste tot
 * (raportat cu video: rămânea secunde întregi peste titlul lunii, cât citea galeria).
 */
function capped(t: Transition): Transition {
  const timer = setTimeout(() => { try { t.skipTransition?.(); } catch { /* deja gata */ } }, 650);
  void t.finished.finally(() => clearTimeout(timer)).catch(() => {});
  return t;
}

function canAnimate(): boolean {
  const doc = document as Doc;
  if (typeof doc.startViewTransition !== 'function') return false;
  try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

/** Dala e întreagă pe ecran, sub titlul lunii lipit sus (altfel poza zboară peste el). */
function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.top >= 56 && r.bottom <= innerHeight - 70;
}

/** Deschide poza mare pornind de la dala atinsă (sau `from`, dacă e dat). */
export function openWithTransition(update: () => void, from?: HTMLElement | null): void {
  const src = from ?? (tapped && Date.now() - tapped.at < 1500 ? tapped.el : null);
  if (!src || !canAnimate() || !visible(src)) { update(); return; }
  src.style.viewTransitionName = NAME;
  capped((document as Doc).startViewTransition!(() => {
    src.style.viewTransitionName = '';
    flushSync(update);
  }));
}

/** Închide poza mare, cu poza întorcându-se în dala ei (dacă dala e pe ecran). */
export function closeWithTransition(update: () => void, photoId?: string): void {
  if (!photoId || !canAnimate()) { update(); return; }
  let target: HTMLElement | null = null;
  const t = capped((document as Doc).startViewTransition!(() => {
    flushSync(update);
    const el = document.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(photoId)}"]`);
    if (el && visible(el)) { el.style.viewTransitionName = NAME; target = el; }
  }));
  void t.finished.finally(() => { if (target) target.style.viewTransitionName = ''; });
}
