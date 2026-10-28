import { useEffect, useState } from 'react';
import { db, type KnownPerson } from '../core/db';
import { findUnrecognizedFaceClusters, type FaceCluster } from '../core/faceClustering';

export interface PersonFace {
  name: string;
  /** O poză în care apare, și unde e fața în ea — pentru miniatura rotundă. */
  photoId: string;
  box: [number, number, number, number];
  photoIds: string[];
}

/**
 * lumin/faces.ts
 * Fețele din bibliotecă: o miniatură pentru fiecare om cunoscut și grupurile
 * de fețe încă fără nume. Citite din analize, unde stă și cutia feței.
 */
/** O față găsită într-o poză, încă fără nume și fără amprentă (vezi mai jos). */
export interface LooseFace {
  photoId: string;
  box: [number, number, number, number];
}

const REPS_KEY = 'lumin-person-faces';

/** Ce poză a folosit omul ca să numească pe cineva — miniatura lui până îl găsim în alte poze. */
export function rememberPersonFace(name: string, face: LooseFace): void {
  try {
    const all = JSON.parse(localStorage.getItem(REPS_KEY) ?? '{}');
    all[name] = face;
    localStorage.setItem(REPS_KEY, JSON.stringify(all));
  } catch { /* fără stocare: doar miniatura lipsește */ }
}

function readPersonFaces(): Record<string, LooseFace> {
  try { return JSON.parse(localStorage.getItem(REPS_KEY) ?? '{}'); } catch { return {}; }
}

/**
 * Fețele primesc amprentă (embedding) doar după ce e numită cel puțin o
 * persoană, deci la început nu există grupuri de fețe de numit — raportat:
 * „Oameni” gol, deși pozele au fețe. Până atunci se arată fețele așa cum sunt,
 * câte una pe poză (cea mai mare), de pe zile diferite.
 */
function looseFaces(analyses: { photoId: string; faces?: { personId: string | null; box: [number, number, number, number] }[] }[], limit = 12): LooseFace[] {
  const out: LooseFace[] = [];
  for (const a of analyses) {
    const faces = (a.faces ?? []).filter(f => !f.personId);
    if (!faces.length) continue;
    const big = [...faces].sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3])[0];
    if (big.box[2] * big.box[3] < 0.004) continue; // fețe prea mici ca să le recunoască omul
    out.push({ photoId: a.photoId, box: big.box });
  }
  return out.sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3]).slice(0, limit);
}

export function usePeopleFaces(persons: readonly KnownPerson[], refresh: number): { people: PersonFace[]; unknown: FaceCluster[]; loose: LooseFace[] } {
  const [state, setState] = useState<{ people: PersonFace[]; unknown: FaceCluster[]; loose: LooseFace[] }>({ people: [], unknown: [], loose: [] });
  useEffect(() => {
    let alive = true;
    void Promise.all([db.photos.toArray(), db.analyses.toArray()]).then(([rows, analyses]) => {
      if (!alive) return;
      const byId = new Map(analyses.map(a => [a.photoId, a]));
      const people: PersonFace[] = [];
      for (const person of persons) {
        const photoIds: string[] = [];
        let first: { photoId: string; box: [number, number, number, number] } | null = null;
        for (const a of analyses) {
          const f = (a.faces ?? []).find(x => x.personId === person.id);
          if (!f) continue;
          photoIds.push(a.photoId);
          if (!first) first = { photoId: a.photoId, box: f.box };
        }
        const rep = first ?? readPersonFaces()[person.name];
        if (rep) people.push({ name: person.name, photoId: rep.photoId, box: rep.box, photoIds });
      }
      const unknown = findUnrecognizedFaceClusters(rows.map(p => ({
        id: p.id,
        fileName: p.fileName,
        faces: (byId.get(p.id)?.faces ?? []).map(f => ({ personId: f.personId, embedding: f.embedding, box: f.box }))
      }))).slice(0, 8);
      setState({ people: people.sort((a, b) => b.photoIds.length - a.photoIds.length), unknown, loose: unknown.length ? [] : looseFaces(analyses) });
    }).catch(() => {});
    return () => { alive = false; };
  }, [persons, refresh]);
  return state;
}

/** Fața dintr-o poză, decupată larg, ca fișier — pentru a numi pe cineva din ea (addPerson). */
export async function faceFile(face: LooseFace, url: string): Promise<File | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try { await img.decode(); } catch { return null; }
  const [bx, by, bw, bh] = face.box;
  const pad = 0.6;
  const x = Math.max(0, (bx - bw * pad) * img.naturalWidth);
  const y = Math.max(0, (by - bh * pad) * img.naturalHeight);
  const w = Math.min(img.naturalWidth - x, bw * (1 + pad * 2) * img.naturalWidth);
  const h = Math.min(img.naturalHeight - y, bh * (1 + pad * 2) * img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  canvas.getContext('2d')?.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92));
  return blob ? new File([blob], 'face.jpg', { type: 'image/jpeg' }) : null;
}
