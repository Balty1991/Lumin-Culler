import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore, type PhotoView } from '../state/store';
import { canSharpen, sharpUrl } from './sharp';
import { readAutonomy } from './twin';

/**
 * lumin/cloud.ts
 * Lumi Cloud: a doua părere pentru pozele la care Lumi, pe telefon, nu e sigură.
 *
 * Doar cu acordul omului (oprit implicit). Pleacă doar pozele nesigure,
 * micșorate la 512 px, spre serverul Lumi (server/, Cloudflare Workers AI):
 * un model care vede poza o descrie, unul de text dă verdictul în limba omului.
 * Serverul nu păstrează pozele și Cloudflare nu le folosește la antrenare.
 *
 * Verdictele sigure rezolvă singure pozele nesigure (după autonomia aleasă,
 * fără să fie lecții de gust), iar descrierile intră în căutare.
 */
const URL_BASE = (import.meta.env.VITE_LUMI_CLOUD_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const ENABLED_KEY = 'lumin-cloud';
const VERDICTS_KEY = 'lumin-cloud-verdicts';
const INSTALL_KEY = 'lumin-install-id';
const BATCH = 4;
/** Peste atât, verdictul decide singur (cu autonomia „decid ce e sigur” sau „tot”). */
export const SURE = 0.75;

export interface CloudVerdict { keep: boolean; confidence: number; reason: string; caption: string; tags: string[]; t: number }

export function cloudAvailable(): boolean {
  return !!URL_BASE && Capacitor.isNativePlatform();
}

export function cloudEnabled(): boolean {
  try { return cloudAvailable() && localStorage.getItem(ENABLED_KEY) === 'on'; } catch { return false; }
}

export function setCloudEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off'); } catch { /* fără stocare */ }
}

function installId(): string {
  try {
    let id = localStorage.getItem(INSTALL_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(INSTALL_KEY, id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

export function readVerdicts(): Record<string, CloudVerdict> {
  try { return JSON.parse(localStorage.getItem(VERDICTS_KEY) ?? '{}'); } catch { return {}; }
}

function writeVerdicts(all: Record<string, CloudVerdict>): void {
  const entries = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, 3000);
  try { localStorage.setItem(VERDICTS_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* plin: rămân cele din memorie */ }
}

/** Textul de căutat adăugat de Lumi Cloud la o poză (descriere + etichete). */
export function cloudSearchText(id: string, verdicts = readVerdicts()): string {
  const v = verdicts[id];
  return v ? `${v.caption} ${v.tags.join(' ')}` : '';
}

/** Poza, micșorată la 512 px, ca JPEG în base64 (fără prefix). */
async function smallJpeg(id: string): Promise<string | null> {
  const url = (canSharpen() ? await sharpUrl(id, 768) : null) ?? await getCachedPreviewUrl(id);
  if (!url) return null;
  const img = await new Promise<HTMLImageElement | null>(resolve => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = url;
  });
  if (!img) return null;
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '';
  return data.startsWith('/9j/') ? data : null;
}

/** Ce a măsurat telefonul, pe scurt, în engleză — supervizorul vede doar o poză mică. */
function measured(p: PhotoView): string {
  const out: string[] = [];
  out.push(p.sharpness < 40 ? `blurry (sharpness ${Math.round(p.sharpness)}/100)` : `sharp (sharpness ${Math.round(p.sharpness)}/100)`);
  if (p.exposure < 28) out.push(`too dark (exposure ${Math.round(p.exposure)}/100)`);
  else if (p.exposure > 78) out.push(`too bright (exposure ${Math.round(p.exposure)}/100)`);
  else out.push('well exposed');
  if (p.faceCount > 0) out.push(p.allEyesOpen ? `${p.faceCount} face(s), eyes open` : `${p.faceCount} face(s), someone has eyes closed`);
  if (p.groupId) out.push('part of a burst of similar shots');
  return out.join(', ');
}

let running = false;

/**
 * Trimite pozele nesigure (cel mult `limit`) la Lumi Cloud și aplică verdictele.
 * Întoarce câte poze au primit verdict și câte s-au rezolvat singure.
 */
export async function superviseUnsure(limit = 12): Promise<{ checked: number; decided: number }> {
  if (running || !cloudEnabled()) return { checked: 0, decided: 0 };
  running = true;
  try {
    const store = useStore.getState();
    const verdicts = readVerdicts();
    const todo = store.photos
      .filter(p => p.status === 'review' && !p.aside && !verdicts[p.id])
      .sort((a, b) => (b.capturedAt ?? b.importedAt) - (a.capturedAt ?? a.importedAt))
      .slice(0, limit);
    let checked = 0;
    const decisions: { id: string; status: 'selected' | 'rejected' }[] = [];
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch: PhotoView[] = [];
      const images: string[] = [];
      for (const p of todo.slice(i, i + BATCH)) {
        const jpg = await smallJpeg(p.id).catch(() => null);
        if (jpg) { batch.push(p); images.push(jpg); }
      }
      if (!images.length) continue;
      const res = await CapacitorHttp.post({
        url: `${URL_BASE}/v1/supervise`,
        headers: { 'content-type': 'application/json', 'user-agent': 'LuminAI/3 (Android)' },
        data: { images, scores: batch.map(p => p.aiScore), notes: batch.map(measured), lang: store.locale === 'en' ? 'en' : 'ro', installId: installId() },
        connectTimeout: 20_000,
        readTimeout: 120_000
      });
      if (res.status === 429) break; // limita zilnică: mâine continuă
      if (res.status !== 200 || !Array.isArray(res.data?.items)) break;
      (res.data.items as Omit<CloudVerdict, 't'>[]).forEach((v, k) => {
        const p = batch[k];
        if (!p) return;
        verdicts[p.id] = { ...v, t: Date.now() };
        checked++;
        // Decide singur doar când nu contrazice ce a măsurat telefonul (sau e foarte sigur).
        const agrees = v.keep ? p.aiScore >= 35 : p.aiScore < 65;
        if (v.confidence >= SURE && (agrees || v.confidence >= 0.9)) decisions.push({ id: p.id, status: v.keep ? 'selected' : 'rejected' });
      });
      writeVerdicts(verdicts);
    }
    const decided = readAutonomy() !== 'suggest' && decisions.length ? await store.applyCloudVerdicts(decisions) : 0;
    return { checked, decided };
  } catch {
    return { checked: 0, decided: 0 };
  } finally {
    running = false;
  }
}

/**
 * AI-ul online, și în afară de a doua părere: povestea zilei, texte pentru
 * postare, titluri de album, căutarea cu cuvinte. Raportat: „asistentul online
 * nu îl văd așa implicat”. Același acord (Cherrypic Cloud) acoperă tot; fără el,
 * nu pleacă nimic. Rezultatele se țin minte, ca aceeași cerere să nu plece de două ori.
 */
const WRITES_KEY = 'lumin-cloud-writes';
const ALLOWANCE_KEY = 'lumin-cloud-free';
/** Cât folosește gratuit AI-ul online pe zi (texte: povești, texte de postare, titluri; căutări). */
export const FREE_DAILY = { write: 3, search: 5, magic: 2 } as const;

/** Mai are omul voie azi? Cu Pro (sau fără plată disponibilă), mereu da. Numără folosirea. */
function takeFreeAllowance(kind: keyof typeof FREE_DAILY): boolean {
  if (!useStore.getState().premiumLocked) return true;
  const day = new Date().toDateString();
  let used: { day: string; write: number; search: number; magic: number } = { day, write: 0, search: 0, magic: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(ALLOWANCE_KEY) ?? 'null');
    if (raw?.day === day) used = { ...used, ...raw };
  } catch { /* nimic salvat */ }
  if (used[kind] >= FREE_DAILY[kind]) return false;
  used[kind]++;
  try { localStorage.setItem(ALLOWANCE_KEY, JSON.stringify(used)); } catch { /* fără stocare */ }
  return true;
}
export type WriteKind = 'story' | 'caption' | 'describe';

function readWrites(): Record<string, { t: number; data: Record<string, unknown> }> {
  try { return JSON.parse(localStorage.getItem(WRITES_KEY) ?? '{}'); } catch { return {}; }
}

export function cachedWrite(kind: WriteKind, ids: readonly string[]): Record<string, unknown> | null {
  return readWrites()[`${kind}:${ids.join(',')}`]?.data ?? null;
}

/** Cere AI-ului online un text pentru pozele date (cel mult 4). null = n-a mers (fără acord, limită, rețea). */
export async function cloudWrite(kind: WriteKind, ids: readonly string[], context: string, byUser = false): Promise<Record<string, unknown> | null> {
  if (!cloudEnabled() || !ids.length) return null;
  const key = `${kind}:${ids.join(',')}`;
  const hit = readWrites()[key];
  if (hit) return hit.data;
  // Gratuit: câteva texte pe zi; cu Pro, cât permite serverul. Cele cerute de om
  // deschid abonamentul la limită; cele automate (titluri, poveste) doar se opresc.
  if (!takeFreeAllowance('write')) {
    if (byUser) useStore.getState().gatePremium('cloud');
    return null;
  }
  const images = (await Promise.all(ids.slice(0, 4).map(id => smallJpeg(id).catch(() => null)))).filter((x): x is string => !!x);
  if (!images.length) return null;
  try {
    const res = await CapacitorHttp.post({
      url: `${URL_BASE}/v1/describe`,
      headers: { 'content-type': 'application/json', 'user-agent': 'Cherrypic/3 (Android)' },
      data: { kind, images, context: context.slice(0, 300), lang: useStore.getState().locale === 'en' ? 'en' : 'ro', installId: installId() },
      connectTimeout: 20_000,
      readTimeout: 90_000
    });
    if (res.status !== 200 || !res.data || typeof res.data !== 'object') return null;
    const all = readWrites();
    all[key] = { t: Date.now(), data: res.data as Record<string, unknown> };
    const keep = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, 300);
    try { localStorage.setItem(WRITES_KEY, JSON.stringify(Object.fromEntries(keep))); } catch { /* plin */ }
    return res.data as Record<string, unknown>;
  } catch { return null; }
}

/** Căutarea cu cuvinte: ce înseamnă „tort” sau „la mare” din etichetele pe care telefonul le știe. */
export async function cloudConcepts(query: string, vocab: readonly string[]): Promise<string[]> {
  if (!cloudEnabled() || query.trim().length < 2 || !vocab.length) return [];
  if (!takeFreeAllowance('search')) return [];
  try {
    const res = await CapacitorHttp.post({
      url: `${URL_BASE}/v1/concepts`,
      headers: { 'content-type': 'application/json', 'user-agent': 'Cherrypic/3 (Android)' },
      data: { query: query.trim().slice(0, 80), vocab: vocab.slice(0, 600), installId: installId() },
      connectTimeout: 15_000,
      readTimeout: 30_000
    });
    return res.status === 200 && Array.isArray(res.data?.concepts) ? (res.data.concepts as string[]) : [];
  } catch { return []; }
}

/** Pornește Cherrypic Cloud cu acordul omului (același text ca în Setări). */
export async function ensureCloud(askConfirm: (msg: string, o?: { confirmLabel?: string }) => Promise<boolean>, tr: (k: string) => string): Promise<boolean> {
  if (cloudEnabled()) return true;
  if (!cloudAvailable()) return false;
  if (!await askConfirm(tr('lx.cloud.consentAll'), { confirmLabel: tr('lx.cloud.enable') })) return false;
  setCloudEnabled(true);
  void superviseUnsure();
  return true;
}

export type InpaintMode = 'erase' | 'sky-blue' | 'sky-sunset';
export type InpaintResult = { ok: true; image: Blob } | { ok: false; reason: 'consent' | 'limit' | 'failed' };

/**
 * Guma AI / cerul nou: trimite bucata de poză (micșorată) și masca, primește
 * zona redesenată. Gratuit de două ori pe zi; cu Pro, cât permite serverul.
 */
export async function cloudInpaint(mode: InpaintMode, image: Blob, mask: Blob, width: number, height: number): Promise<InpaintResult> {
  if (!cloudEnabled()) return { ok: false, reason: 'consent' };
  if (!takeFreeAllowance('magic')) { useStore.getState().gatePremium('cloud'); return { ok: false, reason: 'limit' }; }
  const b64 = async (b: Blob) => {
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  };
  try {
    const res = await CapacitorHttp.post({
      url: `${URL_BASE}/v1/inpaint`,
      headers: { 'content-type': 'application/json', 'user-agent': 'Cherrypic/3 (Android)' },
      data: { mode, image: await b64(image), mask: await b64(mask), width, height, installId: installId() },
      connectTimeout: 20_000,
      readTimeout: 120_000
    });
    if (res.status === 429) return { ok: false, reason: 'limit' };
    const data = res.data as { image?: string; mime?: string } | undefined;
    if (res.status !== 200 || !data?.image) return { ok: false, reason: 'failed' };
    const bytes = Uint8Array.from(atob(data.image), c => c.charCodeAt(0));
    return { ok: true, image: new Blob([bytes], { type: data.mime ?? 'image/png' }) };
  } catch { return { ok: false, reason: 'failed' }; }
}

/**
 * „Auto AI” în editor: AI-ul online se uită la varianta corectată (micșorată,
 * 512 px) și spune ce reglaje i-ar mai trebui. Cu acordul pentru AI-ul online;
 * gratuit în limita zilnică a textelor, cu Pro cât permite serverul.
 */
export async function cloudGrade(jpegBase64: string): Promise<{ values: Record<string, number>; reason: string } | null> {
  if (!cloudEnabled()) return null;
  if (!takeFreeAllowance('write')) { useStore.getState().gatePremium('cloud'); return null; }
  try {
    const res = await CapacitorHttp.post({
      url: `${URL_BASE}/v1/grade`,
      headers: { 'content-type': 'application/json', 'user-agent': 'Cherrypic/3 (Android)' },
      data: { image: jpegBase64, lang: useStore.getState().locale === 'en' ? 'en' : 'ro', installId: installId() },
      connectTimeout: 20_000,
      readTimeout: 60_000
    });
    const d = res.data as { values?: Record<string, number>; reason?: string } | undefined;
    if (res.status !== 200 || !d?.values) return null;
    return { values: d.values, reason: typeof d.reason === 'string' ? d.reason : '' };
  } catch { return null; }
}
