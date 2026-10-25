/**
 * core/scanSummary.ts
 * Propoziția pe care o citește proprietarul pe telefon, după un import.
 *
 * 2.1.2 arăta același import doar în Statistici, ca „N poze în 48.0s (25.8
 * poze/secundă)”. Durata e ceasul de perete de la pornirea importului până la
 * revenire — include încărcarea modelelor, nu doar inferența. „s/poză” de aici
 * e inversul acelei rate, pe ACELAȘI ceas, ca să se poată compara cifră cu cifră.
 *
 * Treptele sunt ceasuri de perete ale celor două treceri (amprentă, apoi
 * modele), nu sume per poză: pozele rulează în paralel, iar o sumă ar număra
 * același timp de mai multe ori.
 */
import { necesitaDe } from '../i18n';

const KEY = 'lumin-last-scan';

export interface LastScan {
  count: number;
  /** Ceasul de perete al importului, același cu lastImportStats.durationMs din 2.1.2. */
  durationMs: number;
  stage1Ms: number;
  stage2Ms: number;
  prepMs?: number;
  dbMs?: number;
  at: number;
}

/** Durata din Statistici, 2.1.2: sub un minut cu o zecimală lipită de „s”, altfel minute. */
export function formatLegacyDuration(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Rata din Statistici, 2.1.2: o zecimală, punct zecimal, „poze/secundă”. */
export function formatLegacyRate(durationMs: number, count: number): string {
  if (durationMs <= 0 || count <= 0) return '—';
  return (count / (durationMs / 1000)).toFixed(1);
}

function grouped(n: number): string {
  return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(Math.round(n));
}

/** „48 s”, „0,4 s”, „1 min 12 s”. Sub 10 secunde păstrează o zecimală. */
export function formatScanSeconds(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  if (seconds >= 60) {
    const whole = Math.round(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m} min ${s} s`;
  }
  if (seconds < 10) {
    const text = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(seconds);
    return `${text} s`;
  }
  return `${grouped(seconds)} s`;
}

export function formatPerPhoto(durationMs: number, count: number): string {
  if (count <= 0 || durationMs <= 0) return '0';
  const value = durationMs / 1000 / count;
  const digits = value < 10 ? 2 : 1;
  return new Intl.NumberFormat('ro-RO', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function photoPhrase(count: number, groupedDigits: boolean): string {
  if (count === 1) return '1 poză';
  const n = groupedDigits ? grouped(count) : String(count);
  return necesitaDe(count) ? `${n} de poze` : `${n} poze`;
}

function phaseLine(scan: LastScan, locale: 'ro' | 'en'): string {
  const prep = formatScanSeconds(scan.prepMs ?? 0);
  const s1 = formatScanSeconds(scan.stage1Ms);
  const s2 = formatScanSeconds(scan.stage2Ms);
  const db = formatScanSeconds(scan.dbMs ?? 0);
  if (locale === 'en') return `prep ${prep} · stage 1 ${s1} · stage 2 ${s2} · disk ${db}`;
  return `pregătire ${prep} · treapta 1 ${s1} · treapta 2 ${s2} · disc ${db}`;
}

/** Două rânduri: durata totală, apoi pregătirea, treptele și discul. */
export function formatScanLine(scan: LastScan, locale: 'ro' | 'en' = 'ro'): string {
  if (locale === 'en') {
    const photos = scan.count === 1 ? '1 photo' : `${scan.count.toLocaleString('en-US')} photos`;
    const per = scan.count > 0 && scan.durationMs > 0
      ? (scan.durationMs / 1000 / scan.count).toFixed(2)
      : '0';
    return `Analyzed ${photos} in ${formatScanSeconds(scan.durationMs)} (${per} s/photo)\n${phaseLine(scan, 'en')}`;
  }
  const photos = photoPhrase(scan.count, true);
  return `Analizat ${photos} în ${formatScanSeconds(scan.durationMs)} (${formatPerPhoto(scan.durationMs, scan.count)} s/poză)\n${phaseLine(scan, 'ro')}`;
}

/**
 * Ce arăta 2.1.2 pentru același import. Fără separator de mii și cu „48.0s”,
 * ca textul din Statistici → Ultimul import.
 */
export function formatLegacyLine(scan: LastScan, locale: 'ro' | 'en' = 'ro'): string {
  const duration = formatLegacyDuration(scan.durationMs);
  const rate = formatLegacyRate(scan.durationMs, scan.count);
  if (locale === 'en') {
    const photos = scan.count === 1 ? '1 photo' : `${scan.count} photos`;
    return `In 2.1.2, Statistics showed “${photos} in ${duration} (${rate} photos/second)”, with no stages. “photos/second” is the inverse of “s/photo”, on the same clock.`;
  }
  const photos = photoPhrase(scan.count, false);
  return `În 2.1.2, Statistici arăta „${photos} în ${duration} (${rate} poze/secundă)”, fără trepte. „poze/secundă” e inversul lui „s/poză”, pe același ceas.`;
}

/** Build-ul de debug (și `npm run dev`) arată propoziția la final. Release-ul o ține doar în Despre. */
export function scanSummaryOnFinish(): boolean {
  const env = import.meta.env as { DEV?: boolean; VITE_SCAN_SUMMARY?: string };
  return env.DEV === true || env.VITE_SCAN_SUMMARY === '1';
}

export function readLastScan(): LastScan | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastScan>;
    if (typeof parsed.count !== 'number' || typeof parsed.durationMs !== 'number') return null;
    return {
      count: parsed.count,
      durationMs: parsed.durationMs,
      stage1Ms: typeof parsed.stage1Ms === 'number' ? parsed.stage1Ms : 0,
      stage2Ms: typeof parsed.stage2Ms === 'number' ? parsed.stage2Ms : 0,
      prepMs: typeof parsed.prepMs === 'number' ? parsed.prepMs : 0,
      dbMs: typeof parsed.dbMs === 'number' ? parsed.dbMs : 0,
      at: typeof parsed.at === 'number' ? parsed.at : 0
    };
  } catch {
    return null;
  }
}

export function writeLastScan(scan: LastScan): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(scan));
  } catch {
    // linia din Despre lipsește până la următorul import; scanarea nu cade din cauza asta
  }
}
