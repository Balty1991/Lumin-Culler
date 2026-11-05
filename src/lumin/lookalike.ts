import { db } from '../core/db';
import { cosine } from './faceIdentity';

/**
 * lumin/lookalike.ts
 * „Cu cine semeni?”: cât de mult seamănă fața unui om (de obicei un copil) cu
 * a altor oameni din familie, din amprentele fețelor deja calculate pe telefon
 * (aceleași care recunosc oamenii). Nu e la întâmplare: fiecare față are o amprentă
 * de măsurători (vectorul modelului de recunoaștere), comparată prin similaritate
 * cosinus între toate perechile de fețe; contează media celor mai bune potriviri.
 * Aceleași poze dau mereu același rezultat. Pentru distracție: o comparație de
 * trăsături, nu un test genetic.
 */
export interface FaceRef { photoId: string; box: [number, number, number, number]; embedding: number[] }
export interface LookalikeResult {
  name: string;
  /** Asemănarea brută (0..1) și partea din total (procent, toate dau 100). */
  score: number;
  percent: number;
  /** Perechea de fețe cea mai asemănătoare: a omului comparat și a acestui om. */
  best: { child: FaceRef; other: FaceRef } | null;
  /** Câte fețe ale acestui om au intrat în comparație. */
  faces: number;
}

const MAX_FACES = 40;

/** Fețele cu amprentă ale unui om, cele mai mari întâi (cele mai clare). */
export async function facesOf(name: string): Promise<FaceRef[]> {
  const out: (FaceRef & { area: number })[] = [];
  await db.analyses.each(a => {
    for (const f of a.faces) {
      if (f.personName !== name || !f.embedding?.length) continue;
      out.push({ photoId: a.photoId, box: f.box, embedding: f.embedding, area: f.box[2] * f.box[3] });
    }
  });
  return out.sort((x, y) => y.area - x.area).slice(0, MAX_FACES).map(({ area: _a, ...f }) => f);
}

/** Media celor mai bune potriviri (nu doar una: o singură poză norocoasă nu decide). */
function affinity(a: FaceRef[], b: FaceRef[]): { score: number; best: { child: FaceRef; other: FaceRef } | null } {
  const sims: { s: number; child: FaceRef; other: FaceRef }[] = [];
  for (const x of a) for (const y of b) if (x.embedding.length === y.embedding.length) sims.push({ s: cosine(x.embedding, y.embedding), child: x, other: y });
  if (!sims.length) return { score: 0, best: null };
  sims.sort((p, q) => q.s - p.s);
  const top = sims.slice(0, Math.max(3, Math.round(sims.length * 0.1)));
  return { score: top.reduce((t, p) => t + p.s, 0) / top.length, best: { child: sims[0].child, other: sims[0].other } };
}

/**
 * Procentele: împărțite între cei comparați după asemănare (cu o pantă, ca
 * diferențele mici să se vadă), rotunjite să dea exact 100.
 */
export function shares(scores: number[], k = 14): number[] {
  if (!scores.length) return [];
  const m = Math.max(...scores);
  const e = scores.map(s => Math.exp(k * (s - m)));
  const sum = e.reduce((a, b) => a + b, 0);
  const raw = e.map(v => (v / sum) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

export async function lookalike(name: string, others: string[]): Promise<{ results: LookalikeResult[]; enough: boolean; faces: number; dims: number }> {
  const mine = await facesOf(name);
  const scored = await Promise.all(others.map(async o => { const f = await facesOf(o); return { name: o, faces: f.length, ...affinity(mine, f) }; }));
  const valid = scored.filter(s => s.best);
  const pct = shares(valid.map(v => v.score));
  const results = valid.map((v, i) => ({ name: v.name, score: v.score, percent: pct[i], best: v.best, faces: v.faces }))
    .sort((a, b) => b.percent - a.percent);
  // Câte fețe au intrat în comparație și câte măsurători are amprenta (pentru explicația de pe card).
  return { results, enough: mine.length > 0 && results.length > 0, faces: mine.length + results.reduce((t, r) => t + r.faces, 0), dims: mine[0]?.embedding.length ?? 0 };
}
