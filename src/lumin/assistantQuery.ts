/**
 * lumin/assistantQuery.ts
 * Ce înseamnă o cerere, dincolo de cuvintele căutate: CÂND („ieri”, „săptămâna
 * trecută”, „vara trecută”, „2024”), CARE („păstrate”, „Nu azi”, „neclare”, „cu ochii
 * închiși”, „zâmbind”), CÂTE („ultimele 10”) și CINE (numele scrise cu o greșeală).
 * Raportat: „asistentul trebuie făcut mai inteligent, să înțeleagă ce îi cer”.
 */
import type { PhotoView } from '../state/store';
import { photoTime } from './days';
import { fold } from './textSearch';

export interface ParsedQuery {
  from?: number;
  to?: number;
  status?: 'selected' | 'rejected';
  quality?: 'blurry' | 'eyesClosed' | 'smile' | 'selfie' | 'group';
  limit?: number;
  newest?: boolean;
  /** Ce rămâne de căutat după ce s-au scos timpul, filtrele și numerele. */
  rest: string;
}

const DAY = 86_400_000;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const NUMBERS: Record<string, number> = { unu: 1, una: 1, doua: 2, doi: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, douazeci: 20, cincizeci: 50 };

export function parseQuery(input: string, now = Date.now()): ParsedQuery {
  let q = ' ' + fold(input).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const out: ParsedQuery = { rest: '' };
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = q.match(re);
    if (m) { fn(m); q = q.replace(re, ' '); }
  };
  const today = dayStart(now);
  const d = new Date(now);
  const range = (from: number, to: number) => { out.from = from; out.to = to; };

  // CÂND
  take(/ (azi|astazi|today) /, () => range(today, today + DAY));
  take(/ (alaltaieri|day before yesterday) /, () => range(today - 2 * DAY, today - DAY));
  take(/ (ieri|yesterday) /, () => range(today - DAY, today));
  take(/ (saptamana|week) (asta|aceasta|this) | this week /, () => range(today - ((d.getDay() + 6) % 7) * DAY, today + DAY));
  take(/ (saptamana|week) (trecuta|last) | last week /, () => { const mon = today - ((d.getDay() + 6) % 7) * DAY; range(mon - 7 * DAY, mon); });
  take(/ (luna|month) (asta|aceasta|this) | this month /, () => range(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), today + DAY));
  take(/ (luna|month) (trecuta|last) | last month /, () => range(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime()));
  take(/ (anul|year) (trecut|last) | last year /, () => range(new Date(d.getFullYear() - 1, 0, 1).getTime(), new Date(d.getFullYear(), 0, 1).getTime()));
  take(/ (anul|year) (asta|acesta|this) | this year /, () => range(new Date(d.getFullYear(), 0, 1).getTime(), today + DAY));
  take(/ (ultimele|ultima|last|past) (\d+|doua|trei|patru|cinci|sase|sapte) (zile|days) /, m => range(today - ((Number(m[2]) || NUMBERS[m[2]]) - 1) * DAY, today + DAY));
  // Anotimpurile: „vara trecută” = vara anului trecut dacă vara de anul ăsta n-a venit încă.
  const SEASONS: [string, number, number][] = [['vara|summer', 5, 8], ['toamna|autumn|fall', 8, 11], ['primavara|spring', 2, 5], ['iarna|winter', 11, 14]];
  for (const [words, m0, m1] of SEASONS) {
    take(new RegExp(` (${words}) (trecuta|trecut|last) `), () => {
      // Anotimpul încheiat cel mai recent (iarna trece peste an: dec–feb).
      let y = d.getFullYear();
      if (new Date(y, m1, 1).getTime() > now) y -= 1;
      range(new Date(y, m0, 1).getTime(), new Date(y, m1, 1).getTime());
    });
    take(new RegExp(` (${words}) (asta|aceasta|this) `), () => {
      let y = d.getFullYear();
      if (new Date(y, m0, 1).getTime() > now) y -= 1;
      range(new Date(y, m0, 1).getTime(), new Date(y, m1, 1).getTime());
    });
  }
  take(/ (19|20)(\d\d) /, m => { const y = Number(m[1] + m[2]); range(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()); });

  // CÂTE
  take(/ (ultimele|last|latest) (\d+|doua|trei|patru|cinci|sase|sapte|opt|noua|zece|douazeci|cincizeci) /, m => { out.limit = Number(m[2]) || NUMBERS[m[2]]; out.newest = true; });
  take(/ (primele|first|top) (\d+|doua|trei|patru|cinci|sase|sapte|opt|noua|zece|douazeci|cincizeci) /, m => { out.limit = Number(m[2]) || NUMBERS[m[2]]; });
  take(/ (cele mai noi|ultimele|recente|recent|newest|latest) /, () => { out.newest = true; });

  // CARE
  take(/ (pastrate|pastrat|pastrata|preferate|favorite|kept|favourites?|favorites?) /, () => { out.status = 'selected'; });
  take(/ (nu azi|respinse|respins|rejected|aruncate) /, () => { out.status = 'rejected'; });
  take(/ (neclare|neclara|miscate|miscata|blurate|blurry|blurred|out of focus) /, () => { out.quality = 'blurry'; });
  take(/ (ochii inchisi|ochi inchisi|cu ochii inchisi|clipit|closed eyes|eyes closed|blinking) /, () => { out.quality = 'eyesClosed'; });
  take(/ (de grup|grup|group|toti|toata familia) /, () => { out.quality = 'group'; });

  out.rest = q.trim();
  return out;
}

/** Filtrele din cerere, aplicate pe poze (timpul, statusul, calitatea). */
export function applyFilters(photos: readonly PhotoView[], p: ParsedQuery): PhotoView[] {
  return photos.filter(ph => {
    const t = photoTime(ph);
    if (p.from !== undefined && t < p.from) return false;
    if (p.to !== undefined && t >= p.to) return false;
    if (p.status && ph.status !== p.status) return false;
    if (p.quality === 'blurry' && !(ph.sharpness < 0.3)) return false;
    if (p.quality === 'eyesClosed' && !(ph.faceCount > 0 && !ph.allEyesOpen)) return false;
    if (p.quality === 'group' && !(ph.faceCount >= 3)) return false;
    return true;
  });
}

/** Distanța de editare, mică: „Amy” → „Ami”, „Mya” → „Mia”. */
function close(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] <= 1;
}

/** Numele de persoane scrise cu o greșeală, înlocuite cu numele cunoscut. */
export function fixNames(rest: string, names: readonly string[]): string {
  const known = names.map(n => ({ n, f: fold(n) }));
  return rest.split(' ').map(w => {
    if (w.length < 3 || known.some(k => k.f === w)) return w;
    const hit = known.find(k => k.f.length >= 3 && close(w, k.f));
    return hit ? hit.f : w;
  }).join(' ');
}
