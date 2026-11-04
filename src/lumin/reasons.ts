/**
 * lumin/reasons.ts
 * De ce a ales AI-ul așa, în cuvinte scurte: ce se vede pe poză (clară,
 * mișcată, ochi închiși, zâmbet), nu un scor. Primele 3 motive, cele bune
 * și cele rele separat colorate.
 */
export interface ReasonInput {
  sharpness: number;
  exposure: number;
  faceCount: number;
  allEyesOpen: boolean;
  bestSmile: number;
  groupId?: string;
  goldenHourDetected?: boolean;
  aside?: string;
  capturedAt?: number;
}

export interface Reason {
  key: string;
  tone: 'good' | 'bad' | 'info';
}

export function reasonsFor(p: ReasonInput): Reason[] {
  const out: Reason[] = [];
  if (p.aside) out.push({ key: `lx.reason.aside.${p.aside}`, tone: 'info' });
  if (p.faceCount > 0 && !p.allEyesOpen) out.push({ key: 'lx.reason.eyesClosed', tone: 'bad' });
  if (p.sharpness < 40) out.push({ key: 'lx.reason.blurry', tone: 'bad' });
  if (p.exposure < 28) out.push({ key: 'lx.reason.dark', tone: 'bad' });
  else if (p.exposure > 78) out.push({ key: 'lx.reason.bright', tone: 'bad' });
  if (p.faceCount > 0 && p.bestSmile >= 0.6) out.push({ key: 'lx.reason.smile', tone: 'good' });
  if (p.faceCount > 1 && p.allEyesOpen) out.push({ key: 'lx.reason.eyesAll', tone: 'good' });
  else if (p.faceCount > 0 && p.allEyesOpen) out.push({ key: 'lx.reason.eyesOpen', tone: 'good' });
  if (p.sharpness >= 70) out.push({ key: 'lx.reason.sharp', tone: 'good' });
  if (p.goldenHourDetected && nearSunriseOrSunset(p.capturedAt)) out.push({ key: 'lx.reason.goldenHour', tone: 'good' });
  if (p.groupId) out.push({ key: 'lx.reason.series', tone: 'info' });
  return out.slice(0, 3);
}

/**
 * „Lumină de apus” doar la ora potrivită (raportat: apărea pe poze făcute la prânz,
 * când culorile erau doar calde). Răsăritul și apusul aproximative pentru România,
 * pe lună; fără oră cunoscută, semnalul din analiză rămâne.
 */
const SUNRISE = [7.8, 7.3, 6.6, 6.7, 6.0, 5.5, 5.6, 6.1, 6.8, 7.4, 7.1, 7.7];
const SUNSET = [16.9, 17.6, 18.4, 20.0, 20.6, 21.0, 21.0, 20.4, 19.5, 18.4, 16.9, 16.5];
export function nearSunriseOrSunset(at?: number): boolean {
  if (!at) return true;
  const d = new Date(at);
  const h = d.getHours() + d.getMinutes() / 60;
  const m = d.getMonth();
  return (h >= SUNRISE[m] - 0.5 && h <= SUNRISE[m] + 1.5) || (h >= SUNSET[m] - 1.5 && h <= SUNSET[m] + 0.5);
}
