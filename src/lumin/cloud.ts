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
