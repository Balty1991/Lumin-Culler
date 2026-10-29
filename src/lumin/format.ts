import { plural, intlTag } from '../i18n';
import type { Day } from './days';

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** „Miercuri, 28 octombrie”: doar prima literă mare (lunile se scriu cu literă mică în română). */
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function dayLabel(start: number, locale: string, month: 'long' | 'short' = 'long'): string {
  return capitalizeFirst(new Date(start).toLocaleDateString(intlTag(locale), { weekday: 'long', day: 'numeric', month }));
}

export function monthLabel(start: number, locale: string): string {
  return capitalizeFirst(new Date(start).toLocaleDateString(intlTag(locale), { month: 'long', year: 'numeric' }));
}

/** „9 poze → 2 păstrate · 3 documente”, cu pluralul corect și documentele separat. */
export function daySummary(d: Day, tr: Tr): string {
  const memories = d.photos.length - d.aside.length;
  const parts: string[] = [];
  if (memories > 0) {
    parts.push(`${tr(plural(memories, 'lx.count.photos.one', 'lx.count.photos'), { count: memories })} → ${tr(plural(d.kept.length, 'lx.count.kept.one', 'lx.count.kept'), { count: d.kept.length })}`);
  }
  if (d.aside.length > 0) parts.push(tr(plural(d.aside.length, 'lx.count.docs.one', 'lx.count.docs'), { count: d.aside.length }));
  if (d.series.length > 0) parts.push(tr(plural(d.series.length, 'lx.count.series.one', 'lx.count.series'), { count: d.series.length }));
  return parts.join(' · ');
}
