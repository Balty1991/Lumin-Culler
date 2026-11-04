/**
 * lumin/bestTake.ts
 * „Poza perfectă din serie”: în poza aleasă, fiecare față cu ochii închiși (sau
 * fără zâmbet, când există variantă mai bună) e înlocuită cu fața aceluiași om
 * dintr-un alt cadru al seriei, unde iese mai bine. Pe telefon, fără server.
 *
 * Același om = amprenta feței (SFace) cea mai apropiată, altfel fața cea mai
 * apropiată ca poziție. Fața nouă se așază pe cutia celei vechi, cu margine
 * moale (elipsă estompată), ca să nu se vadă tăietura.
 */
import { db, type FaceInsight } from '../core/db';
import { loadImage } from './collage';

export interface BestTakeFix { faceIndex: number; fromId: string }

function cos(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
const center = (f: FaceInsight) => [f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] / 2];
const quality = (f: FaceInsight) => (f.isBlinking ? 0 : 1) + (f.eyesOpen.left + f.eyesOpen.right) / 4 + f.smile * 0.6;

/** Pentru fiecare față din bază, cel mai bun înlocuitor din celelalte cadre (dacă e vizibil mai bun). */
export async function planBestTake(baseId: string, groupIds: string[]): Promise<BestTakeFix[]> {
  const rows = await db.analyses.bulkGet([baseId, ...groupIds.filter(id => id !== baseId)]);
  const base = rows[0];
  if (!base?.faces.length) return [];
  const fixes: BestTakeFix[] = [];
  base.faces.forEach((f, i) => {
    let best: { id: string; q: number } | null = null;
    for (const other of rows.slice(1)) {
      if (!other) continue;
      // Același om: amprentă, altfel poziția în cadru (rafalele se mișcă puțin).
      const match = other.faces
        .map(g => ({ g, s: f.embedding && g.embedding ? cos(f.embedding, g.embedding) : 1 - Math.hypot(center(f)[0] - center(g)[0], center(f)[1] - center(g)[1]) * 3 }))
        .sort((a, b) => b.s - a.s)[0];
      if (!match || match.s < 0.45) continue;
      const q = quality(match.g);
      if (!best || q > best.q) best = { id: other.photoId, q };
    }
    if (best && best.q > quality(f) + 0.4) fixes.push({ faceIndex: i, fromId: best.id });
  });
  return fixes;
}

/** Compune poza: baza + fețele mai bune, cu margini moi. Întoarce un JPEG. */
export async function renderBestTake(baseId: string, fixes: BestTakeFix[]): Promise<Blob | null> {
  const base = await db.analyses.get(baseId);
  const img = await loadImage(baseId);
  if (!base || !img) return null;
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  for (const fix of fixes) {
    const other = await db.analyses.get(fix.fromId);
    const src = await loadImage(fix.fromId);
    const f = base.faces[fix.faceIndex];
    if (!other || !src || !f) continue;
    const g = other.faces
      .map(x => ({ x, s: f.embedding && x.embedding ? cos(f.embedding, x.embedding) : -Math.hypot(center(f)[0] - center(x)[0], center(f)[1] - center(x)[1]) }))
      .sort((a, b) => b.s - a.s)[0]?.x;
    if (!g) continue;
    // Cutiile, puțin lărgite (fruntea și bărbia intră în trecere).
    const grow = 1.25;
    const dst = { x: (f.box[0] + f.box[2] / 2) * W, y: (f.box[1] + f.box[3] / 2) * H, w: f.box[2] * W * grow, h: f.box[3] * H * grow };
    const sw = src.naturalWidth, sh = src.naturalHeight;
    const from = { x: (g.box[0] + g.box[2] / 2) * sw, y: (g.box[1] + g.box[3] / 2) * sh, w: g.box[2] * sw * grow, h: g.box[3] * sh * grow };
    const patch = document.createElement('canvas');
    patch.width = Math.max(1, Math.round(dst.w)); patch.height = Math.max(1, Math.round(dst.h));
    const pc = patch.getContext('2d')!;
    pc.drawImage(src, from.x - from.w / 2, from.y - from.h / 2, from.w, from.h, 0, 0, patch.width, patch.height);
    // Mască eliptică cu margine moale.
    const mask = document.createElement('canvas');
    mask.width = patch.width; mask.height = patch.height;
    const mc = mask.getContext('2d')!;
    const pw = patch.width, ph = patch.height;
    mc.save();
    mc.scale(1, ph / pw); // un cerc într-un pătrat pw×pw devine elipsa pw×ph
    const grad = mc.createRadialGradient(pw / 2, pw / 2, pw * 0.32, pw / 2, pw / 2, pw * 0.5);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    mc.fillStyle = grad;
    mc.fillRect(0, 0, pw, pw);
    mc.restore();
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(mask, 0, 0);
    ctx.drawImage(patch, dst.x - dst.w / 2, dst.y - dst.h / 2);
  }
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.94));
}
