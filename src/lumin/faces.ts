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
export function usePeopleFaces(persons: readonly KnownPerson[], refresh: number): { people: PersonFace[]; unknown: FaceCluster[] } {
  const [state, setState] = useState<{ people: PersonFace[]; unknown: FaceCluster[] }>({ people: [], unknown: [] });
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
        if (first) people.push({ name: person.name, ...first, photoIds });
      }
      const unknown = findUnrecognizedFaceClusters(rows.map(p => ({
        id: p.id,
        fileName: p.fileName,
        faces: (byId.get(p.id)?.faces ?? []).map(f => ({ personId: f.personId, embedding: f.embedding, box: f.box }))
      }))).slice(0, 8);
      setState({ people: people.sort((a, b) => b.photoIds.length - a.photoIds.length), unknown });
    }).catch(() => {});
    return () => { alive = false; };
  }, [persons, refresh]);
  return state;
}
