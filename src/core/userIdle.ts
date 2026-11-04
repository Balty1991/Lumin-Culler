/**
 * core/userIdle.ts
 * Lucrul din fundal (CLIP, descrieri, expresii) cedează cât omul atinge sau
 * derulează: raportat „merge sacadat uneori”. După ~1,2 s fără atingeri,
 * continuă; cel mult `maxWaitMs`, ca să nu stea la nesfârșit.
 */
let last = 0;
let installed = false;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const mark = () => { last = performance.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'scroll', 'touchmove', 'keydown']) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
}

export function userActive(withinMs = 1200): boolean {
  install();
  return performance.now() - last < withinMs;
}

export async function waitForUserIdle(maxWaitMs = 8000): Promise<void> {
  install();
  if (document.visibilityState !== 'visible') return;
  const start = performance.now();
  while (userActive() && performance.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 250));
  }
}
