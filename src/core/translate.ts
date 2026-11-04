/**
 * core/translate.ts
 * Descrierea AI (Florence-2, în engleză) tradusă în limba aplicației, pe
 * telefon (TranslatePlugin.kt, OPUS-MT). Doar dacă motorul limbii e descărcat.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface TranslateApi {
  translate(o: { lang: string; texts: string[] }): Promise<{ texts: string[] }>;
  release(): Promise<void>;
}
const Native = registerPlugin<TranslateApi>('Translate');

export const TRANSLATE_LANGS = ['ro', 'de', 'it', 'es', 'fr'] as const;

export function translateLangFor(locale: string): string | null {
  const b = locale.slice(0, 2);
  return (TRANSLATE_LANGS as readonly string[]).includes(b) ? b : null;
}

export async function translateTexts(lang: string, texts: string[]): Promise<string[] | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Translate') || !texts.length) return null;
  try { return (await Native.translate({ lang, texts })).texts; } catch { return null; }
}

export async function releaseTranslator(): Promise<void> {
  try { await Native.release(); } catch { /* nimic */ }
}
