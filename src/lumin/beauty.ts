/**
 * lumin/beauty.ts
 * „Cât de frumoasă e poza pentru omul ăsta”, pe scara 1–10: scorul estetic din CLIP, mutat de
 * gustul personal când modelul lui e validat (±1,5). Folosit oriunde aplicația alege
 * „cele mai frumoase” (amintiri, colaje, raportul de dimineață, anul).
 */
export interface BeautyInput { aesthetic?: number; aiScore: number; tasteP?: number }

export function beautyScore(p: BeautyInput): number {
  const base = p.aesthetic ?? p.aiScore / 12;
  return p.tasteP === undefined ? base : base + 3 * (p.tasteP - 0.5);
}
