/**
 * lumin/growth.ts
 * „Cum a crescut”: o poză pe an din albumul unei persoane — pe vârstă când știm ziua
 * de naștere (1 an, 2 ani…), altfel pe anul calendaristic. Din fiecare an: o poză
 * păstrată de om, cu un singur chip în cadru (portret, nu grup), cea mai reușită.
 */
import type { PhotoView } from '../state/store';
import { ageAt, type Birthday } from './birthdays';
import { photoTime } from './days';
import { beautyScore } from './beauty';

export interface GrowthStep { key: number; label: { years: number } | { year: number }; photo: PhotoView }

function score(p: PhotoView): number {
  return (p.status === 'selected' ? 1000 : 0) + (p.faceCount === 1 ? 300 : 0) + (p.allEyesOpen ? 50 : 0) + beautyScore(p) * 10;
}

export function growthTimeline(list: readonly PhotoView[], birthday?: Birthday): GrowthStep[] {
  const groups = new Map<number, PhotoView[]>();
  const byAge = !!birthday?.year;
  for (const p of list) {
    if (p.status === 'rejected') continue;
    const t = photoTime(p);
    let key: number;
    if (byAge) {
      const a = ageAt(birthday!, t);
      if (!a) continue;
      key = a.years;
    } else key = new Date(t).getFullYear();
    const g = groups.get(key);
    if (g) g.push(p); else groups.set(key, [p]);
  }
  const steps = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([key, ps]) => ({
    key,
    label: byAge ? { years: key } : { year: key },
    photo: [...ps].sort((a, b) => score(b) - score(a))[0]
  }));
  return steps.length >= 2 ? steps : [];
}
