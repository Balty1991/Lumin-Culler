import { useEffect, useState } from 'react';
import { db, type KnownPerson } from '../core/db';
import type { FaceCluster } from '../core/faceClustering';
import { clusterFaces, MODEL as SFACE, type FaceRef } from './faceIdentity';

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
  /** Poziția feței în analiza pozei — ca s-o putem eticheta exact pe ea. */
  faceIndex: number;
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
function looseFaces(analyses: { photoId: string; faces?: { personId: string | null; box: [number, number, number, number] }[] }[], limit = 60): LooseFace[] {
  const out: LooseFace[] = [];
  for (const a of analyses) {
    (a.faces ?? []).forEach((f, faceIndex) => {
      if (f.personId) return;
      if (f.box[2] * f.box[3] < 0.004) return; // fețe prea mici ca să le recunoască omul
      out.push({ photoId: a.photoId, faceIndex, box: f.box });
    });
  }
  return out.sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3]).slice(0, limit);
}

export function usePeopleFaces(persons: readonly KnownPerson[], refresh: number): { people: PersonFace[]; unknown: FaceCluster[]; loose: LooseFace[] } {
  const [state, setState] = useState<{ people: PersonFace[]; unknown: FaceCluster[]; loose: LooseFace[] }>({ people: [], unknown: [], loose: [] });
  useEffect(() => {
    let alive = true;
    void db.analyses.toArray().then(analyses => {
      if (!alive) return;
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
      // Fețele cu amprentă SFace se grupează după asemănare (lumin/faceIdentity.ts):
      // grupurile de 2+ sunt „Cine e? (N poze)”, restul rămân de ales cu mâna.
      type F = { personId: string | null; box: [number, number, number, number]; embedding?: number[]; embeddingModel?: string };
      const isSface = (f: F) => !f.personId && f.embeddingModel === SFACE && !!f.embedding?.length;
      const sface: FaceRef[] = [];
      const plain = analyses.map(a => {
        const faces = (a.faces ?? []) as F[];
        faces.forEach((f, faceIndex) => { if (isSface(f)) sface.push({ photoId: a.photoId, faceIndex, box: f.box, embedding: f.embedding! }); });
        // cele grupate nu mai apar și ca fețe de ales cu mâna
        return { photoId: a.photoId, faces: faces.map(f => (isSface(f) ? { ...f, personId: '__grouped' } : f)) };
      });
      const groups = clusterFaces(sface);
      const unknown: FaceCluster[] = groups.filter(g => g.length >= 2).slice(0, 12).map(g => ({
        members: g.map(f => ({ photoId: f.photoId, fileName: '', faceIndex: f.faceIndex, box: f.box, embedding: f.embedding }))
      }));
      const singles: LooseFace[] = groups.filter(g => g.length === 1).map(g => ({ photoId: g[0].photoId, faceIndex: g[0].faceIndex, box: g[0].box }));
      setState({
        people: people.sort((a, b) => b.photoIds.length - a.photoIds.length),
        unknown,
        loose: [...singles, ...looseFaces(plain)].slice(0, 60)
      });
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
