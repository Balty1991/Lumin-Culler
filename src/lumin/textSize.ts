/**
 * lumin/textSize.ts
 * „Text mare”: toată aplicația mărită (text și butoane), pentru cine citește greu
 * de pe telefon. Telefonul plafonează mărimea fontului la 130% (MainActivity),
 * iar o mare parte din textele aplicației erau sub 13 px (auditul pe persoane).
 */
const KEY = 'cp.textScale';
export const TEXT_SCALES = [1, 1.15, 1.3] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export function readTextScale(): TextScale {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (TEXT_SCALES as readonly number[]).includes(v) ? (v as TextScale) : 1;
  } catch { return 1; }
}

export function applyTextScale(scale: TextScale = readTextScale()): void {
  if (typeof document === 'undefined') return;
  // `zoom` mărește și butoanele, nu doar literele: ecranul rămâne proporționat.
  document.documentElement.style.setProperty('zoom', scale === 1 ? '' : String(scale));
}

export function setTextScale(scale: TextScale): void {
  try { localStorage.setItem(KEY, String(scale)); } catch { /* fără stocare: rămâne până la repornire */ }
  applyTextScale(scale);
}
