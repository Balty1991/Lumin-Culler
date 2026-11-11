/**
 * lumin/yearShare.ts
 * Face și trimite cardul „Anul meu în poze” (vezi yearStats.ts, shareCards.renderYearCard).
 */
import { useStore, type PhotoView } from '../state/store';
import { getDisplayUrl } from '../core/previewUrlCache';
import { intlTag, t, type Locale } from '../i18n';
import { renderYearCard, shareCard } from './shareCards';
import { yearStats, type YearStats } from './yearStats';

export function yearLines(s: YearStats, locale: Locale): string[] {
  const tr = (k: string, p?: Record<string, string | number>) => t(locale, k, p);
  const out = [tr('lx.year.line.photos', { total: s.total, kept: s.kept }), tr('lx.year.line.days', { count: s.days })];
  if (s.topMonth !== null) out.push(tr('lx.year.line.month', { month: new Date(s.year, s.topMonth, 1).toLocaleDateString(intlTag(locale), { month: 'long' }) }));
  if (s.topPerson) out.push(tr('lx.year.line.person', { name: s.topPerson }));
  return out;
}

/** Întoarce `false` când anul are prea puține poze sau cardul nu s-a putut face. */
export async function shareYear(photos: readonly PhotoView[], year: number): Promise<boolean> {
  const locale = useStore.getState().locale;
  const s = yearStats(photos, year);
  if (!s) return false;
  const urls = (await Promise.all(s.best.map(p => getDisplayUrl(p.id).catch(() => null)))).filter((u): u is string => !!u);
  const title = t(locale, 'lx.year.title');
  const blob = await renderYearCard(urls, year, title, yearLines(s, locale), t(locale, 'lx.share.cta'));
  if (!blob) return false;
  await shareCard(blob, `cherrypic-${year}.jpg`, `${title} ${year}`, t(locale, 'lx.share.cta'));
  return true;
}
