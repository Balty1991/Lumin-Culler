export const INTRO_KEY = 'lumin-rescue-intro';
export const LOCALE_KEY = 'lumin-locale';

export const SCREENS = [
  'intro1', 'intro2', 'intro3', 'scan', 'home',
  'review', 'swipe', 'trash', 'freed', 'settings', 'paywall'
] as const;

export type ScreenId = (typeof SCREENS)[number];

export interface BootState {
  screen: ScreenId;
  /** False for a held preview (?screen=) so screenshots do not race the timer. */
  liveScan: boolean;
}

export function readBoot(search: string, introSeen: boolean): BootState {
  const requested = new URLSearchParams(search).get('screen');
  if (requested && (SCREENS as readonly string[]).includes(requested)) {
    return { screen: requested as ScreenId, liveScan: false };
  }
  if (!introSeen) return { screen: 'intro1', liveScan: false };
  return { screen: 'scan', liveScan: true };
}

export function readRescueLocale(stored: string | null, languages: readonly string[]): 'ro' | 'en' {
  if (stored === 'ro' || stored === 'en') return stored;
  return languages.some(tag => tag.toLowerCase().startsWith('ro')) ? 'ro' : 'en';
}
